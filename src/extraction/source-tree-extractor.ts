import { z } from "zod";
import type { GenerateObject, PerformanceReport, TokenUsage } from "../core/types";
import type { ModelBudgetResolution } from "../core/model-budget";
import { safeGenerateObject } from "../core/safe-generate";
import type { InsuranceDocument } from "../schemas/document";
import type {
  DocumentSourceNode,
  DocumentSourceNodeKind,
  PolicyOperationalProfile,
  SourceChunk,
  SourceSpan,
} from "../source";
import {
  buildDeterministicOperationalProfile,
  buildDocumentSourceTree,
  chunkSourceSpans,
  mergeOperationalProfile,
  normalizeDocumentSourceTreePaths,
  normalizeSourceSpans,
} from "../source";

const ORGANIZABLE_KINDS = [
  "page_group",
  "form",
  "endorsement",
  "section",
  "schedule",
  "clause",
] as const;

const ORGANIZATION_TOP_LEVEL_BATCH_SIZE = 80;
const ORGANIZATION_CHILD_CONTEXT_LIMIT = 4;

const SourceTreeOrganizationSchema = z.object({
  labels: z.array(z.object({
    nodeId: z.string(),
    kind: z.enum([
      "document",
      "page_group",
      "page",
      "form",
      "endorsement",
      "section",
      "schedule",
      "clause",
      "table",
      "table_row",
      "table_cell",
      "text",
    ]).optional(),
    title: z.string().optional(),
    description: z.string().optional(),
  })),
  groups: z.array(z.object({
    kind: z.enum(ORGANIZABLE_KINDS),
    title: z.string(),
    description: z.string().optional(),
    childNodeIds: z.array(z.string()).min(1),
  })),
});

const SourceBackedValueForPromptSchema = z.object({
  value: z.string(),
  normalizedValue: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const OperationalProfilePromptSchema = z.object({
  documentType: z.enum(["policy", "quote"]).optional(),
  policyTypes: z.array(z.string()).optional(),
  policyNumber: SourceBackedValueForPromptSchema.optional(),
  namedInsured: SourceBackedValueForPromptSchema.optional(),
  insurer: SourceBackedValueForPromptSchema.optional(),
  broker: SourceBackedValueForPromptSchema.optional(),
  effectiveDate: SourceBackedValueForPromptSchema.optional(),
  expirationDate: SourceBackedValueForPromptSchema.optional(),
  retroactiveDate: SourceBackedValueForPromptSchema.optional(),
  premium: SourceBackedValueForPromptSchema.optional(),
  coverageTypes: z.array(z.string()).optional(),
  coverages: z.array(z.object({
    name: z.string(),
    coverageCode: z.string().optional(),
    limit: z.string().optional(),
    deductible: z.string().optional(),
    premium: z.string().optional(),
    formNumber: z.string().optional(),
    sectionRef: z.string().optional(),
    sourceNodeIds: z.array(z.string()),
    sourceSpanIds: z.array(z.string()),
  })).optional(),
  sourceNodeIds: z.array(z.string()).optional(),
  sourceSpanIds: z.array(z.string()).optional(),
});

export type ExtractionV3Result = {
  sourceTree: DocumentSourceNode[];
  sourceSpans: SourceSpan[];
  sourceChunks: SourceChunk[];
  operationalProfile: PolicyOperationalProfile;
  document: InsuranceDocument;
  chunks: [];
  warnings: string[];
  tokenUsage: TokenUsage;
  usageReporting: {
    modelCalls: number;
    callsWithUsage: number;
    callsMissingUsage: number;
  };
  performanceReport: PerformanceReport;
};

type TrackUsage = (
  usage?: TokenUsage,
  report?: {
    taskKind: "extraction_source_tree" | "extraction_operational_profile" | "extraction_classify";
    label?: string;
    maxTokens?: number;
    durationMs?: number;
  },
) => void;

type SourceTreeOrganization = z.infer<typeof SourceTreeOrganizationSchema>;
type OrganizationBatch = {
  label: string;
  topLevelNodeIds: string[];
  nodes: DocumentSourceNode[];
};

function cleanText(value: string | undefined, fallback: string): string {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || fallback;
}

function simplifyOrganizerTitle(value: string | undefined, fallback: string, kind?: DocumentSourceNodeKind): string {
  const title = cleanText(value, fallback);
  if (/^declarations\b/i.test(title)) return "Declarations";
  if (/^policy\s+form\b/i.test(title)) return "Policy Form";
  if (/^definitions\b/i.test(title)) return "Definitions";
  if (kind === "page_group" && /^endorsements?\b/i.test(title)) return "Endorsements";

  const endorsementNumber = title.match(/^endorsement\s+(?:no\.?|number|#)?\s*([A-Z0-9][A-Z0-9.-]*)\b/i)?.[1];
  if (endorsementNumber) return `Endorsement No. ${endorsementNumber}`;

  if (kind === "endorsement" && /^endorsements?\s+\d+\s*[–-]\s*\d+\b/i.test(title)) {
    return title.replace(/[–—]/g, "-").replace(/\s*\(.*/, "").trim();
  }

  return title;
}

function endorsementReference(value: string | undefined): string | undefined {
  const text = cleanText(value, "");
  const explicit = text
    .match(/\bendorsement\s+(?:no\.?|number|#)?\s*([A-Z0-9][A-Z0-9.-]*)\b/i)?.[1]
    ?.toUpperCase();
  if (explicit) return explicit;
  return text
    .match(/\b(?:[A-Z]{2,}-)?END\s+0*([0-9]{1,4})\b/i)?.[1]
    ?.toUpperCase();
}

function endorsementTitle(value: string | undefined): string | undefined {
  const text = cleanText(value, "");
  const explicit = text
    .match(/\bendorsement\s+(?:no\.?|number|#)\s*([A-Z0-9][A-Z0-9.-]*)\b/i)?.[1]
    ?.toUpperCase();
  const number = explicit ?? text
    .match(/\b(?:[A-Z]{2,}-)?END\s+0*([0-9]{1,4})\b/i)?.[1]
    ?.toUpperCase();
  return number ? `Endorsement No. ${number}` : undefined;
}

function sourceNodeText(node: DocumentSourceNode): string {
  return cleanText([node.title, node.description, node.textExcerpt].filter(Boolean).join(" "), "");
}

function looksLikeEndorsementStart(node: DocumentSourceNode): boolean {
  const title = cleanText(node.title, "");
  const body = cleanText([node.textExcerpt, node.description].filter(Boolean).join(" "), "");
  const start = body.slice(0, 260);
  if (/\bthis endorsement changes the policy\b/i.test(start) && endorsementReference(start)) return true;
  if (/^(?:[A-Z]{2,}-)?END\s+0*[0-9]{1,4}\b/i.test(start)) return true;
  if (/^endorsement\s+(?:no\.?|number|#)\s*[A-Z0-9][A-Z0-9.-]*\b/i.test(start)) return true;
  return /^endorsement\s+(?:no\.?|number|#)\s*[A-Z0-9][A-Z0-9.-]*\b/i.test(title) &&
    /\bthis endorsement changes the policy\b/i.test(body);
}

function endorsementStartTitle(node: DocumentSourceNode): string | undefined {
  return looksLikeEndorsementStart(node) ? endorsementTitle(sourceNodeText(node)) : undefined;
}

function semanticGroupNodeId(documentId: string, kind: string, title: string, childNodeIds: string[]): string {
  return [
    documentId.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    "source_node",
    kind,
    title.replace(/[^a-zA-Z0-9_.:-]/g, "_").toLowerCase().slice(0, 48),
    childNodeIds.join("_").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80),
  ].join(":");
}

function looksLikeDeclarationsStart(node: DocumentSourceNode): boolean {
  return /\bdeclarations?\s+(page|schedule)\b/i.test(sourceNodeText(node));
}

function looksLikeDeclarationsContinuation(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  return looksLikeDeclarationsStart(node) ||
    /\b(item\s+\d+\.|coverage part|each claim limit|aggregate limit|retroactive date|self-insured retention|premium|payment plan|producer|broker|forms? and endorsements?|extended reporting period|discovery period)\b/i.test(text);
}

function looksLikePolicyFormStart(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  return /\bpolicy form\b/i.test(node.title) ||
    (/\btechnology errors?\s*&?\s*omissions\b/i.test(text) && /\bplease read this entire policy carefully\b/i.test(text)) ||
    /\bform\s+[A-Z]{2,}-[A-Z0-9-]+\s+\d{2}\s+\d{2}\b/i.test(text);
}

function looksLikePolicyFormContinuation(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  if (looksLikePolicyFormStart(node)) return true;
  return /\b(insuring agreement|definitions?|exclusions?|conditions?|claim means|insured means|wrongful act means|limits of liability|notice of claim|cancellation by|action against the company)\b/i.test(text);
}

function groupAdjacentChildren(params: {
  sourceTree: DocumentSourceNode[];
  children: DocumentSourceNode[];
  childIds: string[];
  kind: DocumentSourceNodeKind;
  title: string;
  description: string;
  organizer: string;
}): DocumentSourceNode[] {
  if (params.childIds.length < 2) return params.sourceTree;
  const children = params.childIds
    .map((id) => params.children.find((child) => child.id === id))
    .filter((child): child is DocumentSourceNode => Boolean(child));
  if (children.length < 2) return params.sourceTree;
  const parentId = children[0].parentId;
  if (!children.every((child) => child.parentId === parentId)) return params.sourceTree;
  const documentId = children[0].documentId;
  const id = semanticGroupNodeId(documentId, params.kind, params.title, children.map((child) => child.id));
  if (params.sourceTree.some((node) => node.id === id)) return params.sourceTree;
  const pageStarts = children.map((child) => child.pageStart).filter((page): page is number => typeof page === "number");
  const pageEnds = children.map((child) => child.pageEnd ?? child.pageStart).filter((page): page is number => typeof page === "number");
  const sourceSpanIds = [...new Set(children.flatMap((child) => child.sourceSpanIds))];
  const order = Math.min(...children.map((child) => child.order));
  const groupNode: DocumentSourceNode = {
    id,
    documentId,
    parentId,
    kind: params.kind,
    title: params.title,
    description: params.description,
    textExcerpt: children.map((child) => child.textExcerpt ?? child.description).filter(Boolean).join("\n\n").slice(0, 1600),
    sourceSpanIds,
    pageStart: pageStarts.length ? Math.min(...pageStarts) : undefined,
    pageEnd: pageEnds.length ? Math.max(...pageEnds) : undefined,
    bbox: children.flatMap((child) => child.bbox ?? []).slice(0, 12),
    order,
    path: "",
    metadata: { sourceTreeVersion: "v3", organizer: params.organizer },
  };
  const wanted = new Set(children.map((child) => child.id));
  return [
    ...params.sourceTree.map((node) =>
      wanted.has(node.id)
        ? { ...node, parentId: id, order: node.order + 0.001 }
        : node,
    ),
    groupNode,
  ];
}

function applySemanticPageGrouping(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const relabeled = sourceTree.map((node) => {
    if (node.kind === "document" || node.kind === "page_group") return node;
    const endorsement = endorsementStartTitle(node);
    if (endorsement && node.kind === "page") {
      return {
        ...node,
        kind: "endorsement" as const,
        title: endorsement,
        description: cleanText([endorsement, "endorsement", node.pageStart ? `page ${node.pageStart}` : undefined, node.textExcerpt].filter(Boolean).join(" | "), endorsement),
        metadata: { ...node.metadata, organizerRepair: "semantic_page_grouping" },
      };
    }
    if (node.kind === "page" && looksLikeDeclarationsStart(node)) {
      return {
        ...node,
        title: "Declarations",
        description: cleanText([node.description, "Declarations"].join(" "), "Declarations"),
        metadata: { ...node.metadata, organizerRepair: "semantic_page_grouping" },
      };
    }
    if (node.kind === "page" && looksLikePolicyFormStart(node)) {
      return {
        ...node,
        title: "Policy Form",
        description: cleanText([node.description, "Policy Form"].join(" "), "Policy Form"),
        metadata: { ...node.metadata, organizerRepair: "semantic_page_grouping" },
      };
    }
    return node;
  });

  const rootId = sourceTreeRootId(relabeled);
  const children = (nodesByParent(relabeled).get(rootId) ?? [])
    .filter((node) => node.kind !== "document")
    .sort((left, right) => left.order - right.order);
  let nextTree = relabeled;

  const declarationsStartIndex = children.findIndex(looksLikeDeclarationsStart);
  if (declarationsStartIndex >= 0) {
    const declarationIds: string[] = [];
    for (let index = declarationsStartIndex; index < children.length; index += 1) {
      const child = children[index];
      if (index > declarationsStartIndex && (looksLikePolicyFormStart(child) || looksLikeEndorsementStart(child))) break;
      if (!looksLikeDeclarationsContinuation(child)) break;
      declarationIds.push(child.id);
    }
    nextTree = groupAdjacentChildren({
      sourceTree: nextTree,
      children,
      childIds: declarationIds,
      kind: "page_group",
      title: "Declarations",
      description: "Declarations pages and schedules grouped by source order",
      organizer: "semantic_declarations_grouping",
    });
  }

  const policyStartIndex = children.findIndex(looksLikePolicyFormStart);
  if (policyStartIndex >= 0) {
    const policyIds: string[] = [];
    for (let index = policyStartIndex; index < children.length; index += 1) {
      const child = children[index];
      if (index > policyStartIndex && looksLikeEndorsementStart(child)) break;
      if (!looksLikePolicyFormContinuation(child)) break;
      policyIds.push(child.id);
    }
    nextTree = groupAdjacentChildren({
      sourceTree: nextTree,
      children,
      childIds: policyIds,
      kind: "form",
      title: "Policy Form",
      description: "Policy form pages grouped by source order",
      organizer: "semantic_policy_form_grouping",
    });
  }

  return applyEndorsementGrouping(normalizeDocumentSourceTreePaths(nextTree));
}

function rejectsOrganizerGroup(group: SourceTreeOrganization["groups"][number], children: DocumentSourceNode[]): boolean {
  if (/^endorsements?\b/i.test(group.title) && group.kind !== "page_group") return true;
  if (group.kind !== "endorsement") return false;
  if (/^endorsements?\s+\d+\s*[–-]\s*\d+\b/i.test(group.title)) return true;

  const childNumbers = new Set(
    children
      .map((child) => endorsementReference([child.title, child.description, child.textExcerpt].filter(Boolean).join(" ")))
      .filter((value): value is string => Boolean(value)),
  );
  return childNumbers.size > 1;
}

function isEndorsementGroup(node: DocumentSourceNode): boolean {
  return node.kind === "page_group" && /^endorsements?\b/i.test(node.title);
}

function endorsementGroupNodeId(documentId: string, parentId: string | undefined): string {
  return [
    documentId.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    "source_node",
    "page_group",
    "endorsements",
    parentId?.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 48) ?? "root",
  ].join(":");
}

function applyEndorsementGrouping(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const relabeledTree = sourceTree.map((node) => {
    if (node.kind === "document" || isEndorsementGroup(node)) return node;
    const title = endorsementStartTitle(node);
    if (!title && node.kind === "endorsement") {
      return {
        ...node,
        kind: "page" as const,
        title: node.pageStart ? `Page ${node.pageStart}` : cleanText(node.title, "Page"),
        metadata: {
          ...node.metadata,
          organizerRepair: "demote_incidental_endorsement_reference",
        },
      };
    }
    if (!title) return node;
    return {
      ...node,
      kind: "endorsement" as const,
      title,
      description: cleanText(
        [title, "endorsement", node.pageStart ? `page ${node.pageStart}` : undefined, node.textExcerpt].filter(Boolean).join(" | "),
        title,
      ),
      metadata: {
        ...node.metadata,
        organizerRepair: "normalize_endorsement_grouping",
      },
    };
  });
  const byParent = nodesByParent(relabeledTree);
  const groupsByParent = new Map<string | undefined, DocumentSourceNode>();
  const endorsementGroupIds = new Set(
    relabeledTree.filter(isEndorsementGroup).map((node) => node.id),
  );
  let nextTree = relabeledTree.map((node) => {
    if (!isEndorsementGroup(node)) return node;
    const normalized = {
      ...node,
      kind: "page_group" as const,
      title: "Endorsements",
      description: cleanText(node.description, "Endorsement forms grouped by source order"),
      metadata: {
        ...node.metadata,
        sourceTreeVersion: "v3",
        organizer: node.metadata?.organizer ?? "endorsement_grouping",
      },
    };
    groupsByParent.set(node.parentId, normalized);
    endorsementGroupIds.add(node.id);
    return normalized;
  });

  nextTree = nextTree.map((node) => {
    if (!endorsementGroupIds.has(node.parentId ?? "")) return node;
    const title = endorsementStartTitle(node);
    if (!title) return node;
    return {
      ...node,
      kind: "endorsement",
      title,
      description: cleanText(
        [title, "endorsement", node.pageStart ? `page ${node.pageStart}` : undefined, node.textExcerpt].filter(Boolean).join(" | "),
        title,
      ),
      metadata: {
        ...node.metadata,
        organizerRepair: "normalize_endorsement_grouping",
      },
    };
  });

  for (const [parentId, children] of byParent) {
    if (endorsementGroupIds.has(parentId ?? "")) continue;
    const endorsementChildren = children.filter((child) => child.kind === "endorsement" && !isEndorsementGroup(child));
    if (endorsementChildren.length < 2) continue;
    const documentId = endorsementChildren[0].documentId;
    const pageStarts = endorsementChildren.map((child) => child.pageStart).filter((page): page is number => typeof page === "number");
    const pageEnds = endorsementChildren.map((child) => child.pageEnd ?? child.pageStart).filter((page): page is number => typeof page === "number");
    const order = Math.min(...endorsementChildren.map((child) => child.order));
    const existingGroup = groupsByParent.get(parentId);
    const groupId = existingGroup?.id ?? endorsementGroupNodeId(documentId, parentId);
    const groupNode: DocumentSourceNode = existingGroup ?? {
      id: groupId,
      documentId,
      parentId,
      kind: "page_group",
      title: "Endorsements",
      description: "Endorsement forms grouped by source order",
      textExcerpt: undefined,
      sourceSpanIds: [],
      pageStart: pageStarts.length ? Math.min(...pageStarts) : undefined,
      pageEnd: pageEnds.length ? Math.max(...pageEnds) : undefined,
      bbox: endorsementChildren.flatMap((child) => child.bbox ?? []).slice(0, 12),
      order,
      path: "",
      metadata: { sourceTreeVersion: "v3", organizer: "endorsement_grouping" },
    };
    const childSpanIds = [...new Set(endorsementChildren.flatMap((child) => child.sourceSpanIds))];
    const normalizedGroup = {
      ...groupNode,
      sourceSpanIds: groupNode.sourceSpanIds.length ? groupNode.sourceSpanIds : childSpanIds,
      pageStart: groupNode.pageStart ?? (pageStarts.length ? Math.min(...pageStarts) : undefined),
      pageEnd: groupNode.pageEnd ?? (pageEnds.length ? Math.max(...pageEnds) : undefined),
      order,
    };
    groupsByParent.set(parentId, normalizedGroup);
    if (!existingGroup) nextTree.push(normalizedGroup);
    else nextTree = nextTree.map((node) => node.id === normalizedGroup.id ? normalizedGroup : node);
    nextTree = nextTree.map((node) =>
      endorsementChildren.some((child) => child.id === node.id)
        ? { ...node, parentId: groupId, order: node.order + 0.001 }
        : node,
    );
  }

  return normalizeDocumentSourceTreePaths(nextTree);
}

function compactNode(node: DocumentSourceNode, maxText = 700) {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    path: node.path,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    sourceSpanIds: node.sourceSpanIds.slice(0, 8),
    text: (node.textExcerpt ?? node.description).slice(0, maxText),
  };
}

function nodesByParent(sourceTree: DocumentSourceNode[]): Map<string | undefined, DocumentSourceNode[]> {
  const byParent = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of sourceTree) {
    const children = byParent.get(node.parentId) ?? [];
    children.push(node);
    byParent.set(node.parentId, children);
  }
  for (const children of byParent.values()) {
    children.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }
  return byParent;
}

function sourceTreeRootId(sourceTree: DocumentSourceNode[]): string | undefined {
  return sourceTree.find((node) => node.kind === "document")?.id;
}

function organizationBatches(sourceTree: DocumentSourceNode[]): OrganizationBatch[] {
  const byParent = nodesByParent(sourceTree);
  const rootId = sourceTreeRootId(sourceTree);
  const topLevelNodes = (byParent.get(rootId) ?? [])
    .filter((node) => node.kind !== "document");

  if (topLevelNodes.length === 0) {
    const nodes = sourceTree.filter((node) => node.kind !== "document").slice(0, 240);
    return [{
      label: "fallback node prefix because no document root children were found",
      topLevelNodeIds: nodes.map((node) => node.id),
      nodes,
    }];
  }

  const batches: OrganizationBatch[] = [];
  for (let index = 0; index < topLevelNodes.length; index += ORGANIZATION_TOP_LEVEL_BATCH_SIZE) {
    const topLevelBatch = topLevelNodes.slice(index, index + ORGANIZATION_TOP_LEVEL_BATCH_SIZE);
    const candidates = new Map<string, DocumentSourceNode>();
    for (const node of topLevelBatch) {
      candidates.set(node.id, node);
      const childContext = (byParent.get(node.id) ?? [])
        .filter((child) => child.kind !== "text" && child.kind !== "table_cell")
        .slice(0, ORGANIZATION_CHILD_CONTEXT_LIMIT);
      for (const child of childContext) {
        candidates.set(child.id, child);
      }
    }
    batches.push({
      label: `top-level nodes ${index + 1}-${index + topLevelBatch.length} of ${topLevelNodes.length}`,
      topLevelNodeIds: topLevelBatch.map((node) => node.id),
      nodes: [...candidates.values()],
    });
  }
  return batches;
}

function mergeOrganizationResults(results: SourceTreeOrganization[]): SourceTreeOrganization {
  const labels = new Map<string, SourceTreeOrganization["labels"][number]>();
  const groups = new Map<string, SourceTreeOrganization["groups"][number]>();

  for (const result of results) {
    for (const label of result.labels) {
      labels.set(label.nodeId, { ...labels.get(label.nodeId), ...label });
    }
    for (const group of result.groups) {
      const key = `${group.kind}:${group.childNodeIds.join("|")}`;
      groups.set(key, group);
    }
  }

  return {
    labels: [...labels.values()],
    groups: [...groups.values()],
  };
}

function buildOrganizationPrompt(batch: OrganizationBatch): string {
  const nodes = batch.nodes.map((node) => compactNode(node, node.kind === "page" ? 900 : 320));
  return `You organize an insurance document source tree.

Scope:
- ${batch.label}
- The provided list is a bounded extraction-time batch. It is not necessarily the whole document.
- Top-level page/form candidates in this batch: ${JSON.stringify(batch.topLevelNodeIds)}

Rules:
- Use only node IDs from the provided list.
- Do not invent text, page numbers, source spans, limits, or policy facts.
- You may relabel existing nodes and group adjacent top-level/page nodes from this batch only when they are clearly one continuous form, one declarations set, one schedule, or one clause family.
- Group adjacent separately numbered endorsements under a single generic "Endorsements" page_group parent, with each individual endorsement preserved as its own child node.
- Never create rollup titles such as "Endorsements 1-3 (...)" or merge multiple endorsements into one endorsement node.
- Add concise, human-readable titles to generic text, table, row, and cell nodes when the text makes their role clear.
- Keep organizer titles terse. Use the printed heading or a compact canonical title such as "Declarations", "Policy Form", "Definitions", or "Endorsement No. 3"; do not add parenthetical summaries.
- Groups must list existing childNodeIds only.
- Keep descriptions short and useful for search.
- Prefer the document's own form titles, endorsement titles, schedules, declarations headings, and page order over keyword-only guessing.

Source nodes:
${JSON.stringify(nodes, null, 2)}

Return JSON with labels and groups only.`;
}

function buildOperationalProfilePrompt(sourceTree: DocumentSourceNode[], fallback: PolicyOperationalProfile): string {
  const nodes = sourceTree
    .filter((node) => node.kind !== "document")
    .slice(0, 240)
    .map(compactNode);
  return `Extract a source-backed operational profile for an insurance policy or quote.

Return only high-value operational facts needed for policy lists, Q&A, compliance, and certificate generation:
- policy number, named insured, insurer/carrier/security, broker/producer, policy period, retroactive date, premium
- coverage lines with limits, deductibles, premiums, and form references
- coverage type labels

Rules:
- Every returned value must include sourceNodeIds or sourceSpanIds from the provided nodes.
- If a value is not directly supported, omit it.
- Prefer declarations, schedules, premium tables, and endorsement schedules over generic policy wording.
- Do not copy entire policy wording into fields.

Deterministic baseline:
${JSON.stringify(fallback, null, 2)}

Source nodes:
${JSON.stringify(nodes, null, 2)}

Return JSON for the operational profile.`;
}

function groupNodeId(documentId: string, group: { kind: string; title: string; childNodeIds: string[] }) {
  return [
    documentId.replace(/[^a-zA-Z0-9_.:-]/g, "_"),
    "source_node",
    group.kind,
    group.childNodeIds.join("_").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80),
  ].join(":");
}

function applyOrganization(sourceTree: DocumentSourceNode[], organization: SourceTreeOrganization): DocumentSourceNode[] {
  const byId = new Map(sourceTree.map((node) => [node.id, node]));
  const labels = new Map(organization.labels.map((label) => [label.nodeId, label]));
  let nextTree = sourceTree.map((node) => {
    const label = labels.get(node.id);
    if (!label) return node;
    return {
      ...node,
      kind: label.kind ?? node.kind,
      title: simplifyOrganizerTitle(label.title, node.title, label.kind ?? node.kind),
      description: cleanText(label.description, node.description),
    };
  });

  for (const group of organization.groups) {
    const children = group.childNodeIds
      .map((id) => byId.get(id))
      .filter((node): node is DocumentSourceNode => Boolean(node));
    if (children.length === 0) continue;
    if (rejectsOrganizerGroup(group, children)) continue;
    const parentId = children[0].parentId;
    if (!children.every((child) => child.parentId === parentId)) continue;
    const documentId = children[0].documentId;
    const title = simplifyOrganizerTitle(group.title, group.title, group.kind as DocumentSourceNodeKind);
    const description = cleanText(group.description, title);
    const id = groupNodeId(documentId, { ...group, title });
    if (byId.has(id)) continue;
    const sourceSpanIds = [...new Set(children.flatMap((child) => child.sourceSpanIds))];
    const pageStarts = children.map((child) => child.pageStart).filter((page): page is number => typeof page === "number");
    const pageEnds = children.map((child) => child.pageEnd ?? child.pageStart).filter((page): page is number => typeof page === "number");
    const order = Math.min(...children.map((child) => child.order));
    const node: DocumentSourceNode = {
      id,
      documentId,
      parentId,
      kind: group.kind as DocumentSourceNodeKind,
      title,
      description,
      textExcerpt: children.map((child) => child.textExcerpt ?? child.description).filter(Boolean).join("\n\n").slice(0, 1600),
      sourceSpanIds,
      pageStart: pageStarts.length ? Math.min(...pageStarts) : undefined,
      pageEnd: pageEnds.length ? Math.max(...pageEnds) : undefined,
      bbox: children.flatMap((child) => child.bbox ?? []).slice(0, 12),
      order,
      path: "",
      metadata: { sourceTreeVersion: "v3", organizer: "llm_group" },
    };
    nextTree = [
      ...nextTree.map((child) =>
        group.childNodeIds.includes(child.id)
          ? { ...child, parentId: id, order: child.order + 0.001 }
          : child,
      ),
      node,
    ];
    byId.set(id, node);
  }

  return applyEndorsementGrouping(normalizeDocumentSourceTreePaths(nextTree));
}

function sourceTreeToOutline(sourceTree: DocumentSourceNode[]) {
  const byParent = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of sourceTree.filter((item) => item.kind !== "document")) {
    const group = byParent.get(node.parentId) ?? [];
    group.push(node);
    byParent.set(node.parentId, group);
  }
  const root = sourceTree.find((node) => node.kind === "document");
  const visit = (node: DocumentSourceNode): Record<string, unknown> => ({
    id: node.id,
    title: node.title,
    type: node.kind,
    label: node.kind,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    excerpt: node.textExcerpt,
    content: node.textExcerpt,
    sourceSpanIds: node.sourceSpanIds,
    sourceTextHash: node.sourceSpanIds.join(":") || undefined,
    interpretationLabels: [node.kind],
    metadata: node.metadata,
    children: (byParent.get(node.id) ?? []).map(visit),
  });
  return (byParent.get(root?.id) ?? []).map(visit);
}

function valueOf(profile: PolicyOperationalProfile, key: keyof PolicyOperationalProfile): string | undefined {
  const value = profile[key];
  return value && typeof value === "object" && !Array.isArray(value) && "value" in value
    ? String(value.value)
    : undefined;
}

function materializeDocument(params: {
  id: string;
  sourceTree: DocumentSourceNode[];
  operationalProfile: PolicyOperationalProfile;
}): InsuranceDocument {
  const profile = params.operationalProfile;
  const policyNumber = valueOf(profile, "policyNumber") ?? "Unknown";
  const insuredName = valueOf(profile, "namedInsured") ?? "Unknown";
  const carrier = valueOf(profile, "insurer") ?? "Unknown";
  const effectiveDate = valueOf(profile, "effectiveDate") ?? "Unknown";
  const expirationDate = valueOf(profile, "expirationDate") ?? "Unknown";
  const premium = valueOf(profile, "premium");
  const coverages = profile.coverages.map((coverage) => ({
    name: coverage.name,
    coverageCode: coverage.coverageCode,
    limit: coverage.limit,
    deductible: coverage.deductible,
    premium: coverage.premium,
    formNumber: coverage.formNumber,
    sectionRef: coverage.sectionRef,
    sourceSpanIds: coverage.sourceSpanIds,
    documentNodeId: coverage.sourceNodeIds[0],
    originalContent: [coverage.name, coverage.limit, coverage.deductible, coverage.premium].filter(Boolean).join(" | "),
  }));
  const documentOutline = sourceTreeToOutline(params.sourceTree);
  const documentMetadata = {
    sourceTreeVersion: "v3",
    sourceTreeCanonical: true,
    tableOfContents: documentOutline.map((node) => ({
      title: node.title,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      documentNodeId: node.id,
      sourceSpanIds: node.sourceSpanIds,
    })),
    agentGuidance: [
      {
        kind: "source_tree",
        title: "Use the source tree as canonical evidence",
        detail: "Operational fields are projections from source nodes and source spans. Use source nodes for policy wording and exact provenance.",
      },
    ],
  };
  const summary = [
    carrier !== "Unknown" ? carrier : undefined,
    policyNumber !== "Unknown" ? `#${policyNumber}` : undefined,
    insuredName !== "Unknown" ? `for ${insuredName}` : undefined,
    profile.coverageTypes.length ? `covering ${profile.coverageTypes.slice(0, 5).join(", ")}` : undefined,
  ].filter(Boolean).join(" ");

  const base = {
    id: params.id,
    type: profile.documentType,
    carrier,
    security: carrier,
    insuredName,
    premium,
    policyTypes: profile.policyTypes,
    coverages,
    documentMetadata,
    documentOutline,
    declarations: {
      fields: [
        profile.policyNumber ? { field: "policyNumber", value: profile.policyNumber.value, sourceSpanIds: profile.policyNumber.sourceSpanIds } : undefined,
        profile.namedInsured ? { field: "namedInsured", value: profile.namedInsured.value, sourceSpanIds: profile.namedInsured.sourceSpanIds } : undefined,
        profile.insurer ? { field: "insurer", value: profile.insurer.value, sourceSpanIds: profile.insurer.sourceSpanIds } : undefined,
        profile.effectiveDate ? { field: "policyPeriodStart", value: profile.effectiveDate.value, sourceSpanIds: profile.effectiveDate.sourceSpanIds } : undefined,
        profile.expirationDate ? { field: "policyPeriodEnd", value: profile.expirationDate.value, sourceSpanIds: profile.expirationDate.sourceSpanIds } : undefined,
      ].filter(Boolean),
    },
    supplementaryFacts: profile.endorsementSupport.map((item) => ({
      key: item.kind,
      value: item.summary,
      sourceSpanIds: item.sourceSpanIds,
      documentNodeId: item.sourceNodeIds[0],
    })),
    summary: summary || undefined,
  };

  if (profile.documentType === "quote") {
    return {
      ...base,
      type: "quote",
      quoteNumber: policyNumber,
      proposedEffectiveDate: effectiveDate === "Unknown" ? undefined : effectiveDate,
      proposedExpirationDate: expirationDate === "Unknown" ? undefined : expirationDate,
    } as unknown as InsuranceDocument;
  }

  return {
    ...base,
    type: "policy",
    policyNumber,
    effectiveDate,
    expirationDate,
    retroactiveDate: valueOf(profile, "retroactiveDate"),
  } as unknown as InsuranceDocument;
}

export async function runSourceTreeExtraction(params: {
  id: string;
  sourceSpans: SourceSpan[];
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  resolveBudget: (taskKind: "extraction_source_tree" | "extraction_operational_profile", hintTokens: number) => ModelBudgetResolution;
  trackUsage: TrackUsage;
  log?: (message: string) => Promise<void>;
}): Promise<ExtractionV3Result> {
  const sourceSpans = normalizeSourceSpans(params.sourceSpans);
  let sourceTree = buildDocumentSourceTree(sourceSpans, params.id);
  const warnings: string[] = [];
  let modelCalls = 0;
  let callsWithUsage = 0;
  let callsMissingUsage = 0;
  const tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const performanceReport: PerformanceReport = { modelCalls: [], totalModelCallDurationMs: 0 };

  const localTrack: TrackUsage = (usage, report) => {
    modelCalls += 1;
    if (usage) {
      callsWithUsage += 1;
      tokenUsage.inputTokens += usage.inputTokens;
      tokenUsage.outputTokens += usage.outputTokens;
    } else {
      callsMissingUsage += 1;
    }
    if (report) {
      performanceReport.modelCalls.push({ ...report, usage, usageReported: !!usage });
      if (report.durationMs != null) performanceReport.totalModelCallDurationMs += report.durationMs;
    }
    params.trackUsage(usage, report);
  };

  try {
    const organizations: SourceTreeOrganization[] = [];
    const batches = organizationBatches(sourceTree);
    for (const [batchIndex, batch] of batches.entries()) {
      const budget = params.resolveBudget("extraction_source_tree", 4096);
      const startedAt = Date.now();
      const response = await safeGenerateObject(
        params.generateObject,
        {
          prompt: buildOrganizationPrompt(batch),
          schema: SourceTreeOrganizationSchema,
          maxTokens: budget.maxTokens,
          taskKind: "extraction_source_tree",
          budgetDiagnostics: budget,
          providerOptions: { ...params.providerOptions, sourceSpans },
        },
        {
          fallback: { labels: [], groups: [] },
          log: params.log,
        },
      );
      localTrack(response.usage, {
        taskKind: "extraction_source_tree",
        label: batches.length > 1 ? `source_tree_organizer_${batchIndex + 1}` : "source_tree_organizer",
        maxTokens: budget.maxTokens,
        durationMs: Date.now() - startedAt,
      });
      organizations.push(response.object as SourceTreeOrganization);
    }
    sourceTree = applyOrganization(sourceTree, mergeOrganizationResults(organizations));
  } catch (error) {
    warnings.push(`Source-tree organizer failed; deterministic tree used (${error instanceof Error ? error.message : String(error)})`);
  }
  sourceTree = applySemanticPageGrouping(sourceTree);

  const deterministicProfile = buildDeterministicOperationalProfile({
    sourceTree,
    sourceSpans,
  });
  let operationalProfile = deterministicProfile;
  try {
    const validNodeIds = new Set(sourceTree.map((node) => node.id));
    const validSpanIds = new Set(sourceSpans.map((span) => span.id));
    const budget = params.resolveBudget("extraction_operational_profile", 8192);
    const startedAt = Date.now();
    const response = await safeGenerateObject(
      params.generateObject,
      {
        prompt: buildOperationalProfilePrompt(sourceTree, deterministicProfile),
        schema: OperationalProfilePromptSchema,
        maxTokens: budget.maxTokens,
        taskKind: "extraction_operational_profile",
        budgetDiagnostics: budget,
        providerOptions: { ...params.providerOptions, sourceSpans, sourceTree },
      },
      {
        fallback: deterministicProfile,
        log: params.log,
      },
    );
    localTrack(response.usage, {
      taskKind: "extraction_operational_profile",
      label: "operational_profile",
      maxTokens: budget.maxTokens,
      durationMs: Date.now() - startedAt,
    });
    operationalProfile = mergeOperationalProfile(
      deterministicProfile,
      response.object as Partial<PolicyOperationalProfile>,
      validNodeIds,
      validSpanIds,
    );
  } catch (error) {
    warnings.push(`Operational profile model pass failed; deterministic profile used (${error instanceof Error ? error.message : String(error)})`);
  }

  const document = materializeDocument({
    id: params.id,
    sourceTree,
    operationalProfile,
  });

  return {
    sourceTree,
    sourceSpans,
    sourceChunks: chunkSourceSpans(sourceSpans),
    operationalProfile,
    document,
    chunks: [],
    warnings: [...warnings, ...operationalProfile.warnings],
    tokenUsage,
    usageReporting: {
      modelCalls,
      callsWithUsage,
      callsMissingUsage,
    },
    performanceReport,
  };
}
