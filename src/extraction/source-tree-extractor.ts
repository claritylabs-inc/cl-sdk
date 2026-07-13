import { z } from "zod";
import type { GenerateObject, PerformanceReport, TokenUsage } from "../core/types";
import type { ModelBudgetResolution, ModelTaskKind } from "../core/model-budget";
import { safeGenerateObject } from "../core/safe-generate";
import type { InsuranceDocument } from "../schemas/document";
import type { SourceProvenance } from "../schemas/shared";
import type {
  DocumentSourceNode,
  DocumentSourceNodeKind,
  OperationalAddress,
  OperationalDeclarationFact,
  OperationalParty,
  PolicyOperationalProfile,
  SourceBackedValue,
  SourceChunk,
  SourceSpan,
} from "../source";
import {
  buildDocumentSourceTree,
  chunkSourceSpans,
  normalizeDocumentSourceTreePaths,
  normalizeSourceSpans,
} from "../source";
import { mergeOperationalProfile } from "../source/operational-profile";
import {
  applyOperationalProfileCleanup,
  buildOperationalProfileCleanupPrompt,
  OperationalCoverageTermKindSchema,
  OperationalProfileCleanupSchema,
  type OperationalProfileCleanup,
} from "./operational-profile-cleanup";
import {
  disabledCoverageRecoveryDiagnostics,
  recoverOperationalProfileCoverage,
  type CoverageRecoveryDiagnostics,
} from "./coverage-recovery";

export type SourceTreeFormHint = {
  formNumber?: string;
  editionDate?: string;
  title?: string;
  formType: "coverage" | "endorsement" | "declarations" | "application" | "notice" | "other";
  pageStart?: number;
  pageEnd?: number;
};

const SourceBackedValueForPromptSchema = z.object({
  value: z.string(),
  normalizedValue: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const OperationalAddressForPromptSchema = z.object({
  street1: z.string().optional(),
  street2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  formatted: z.string().optional(),
});

const OperationalDeclarationFactForPromptSchema = z.object({
  field: z.enum([
    "namedInsured",
    "mailingAddress",
    "dba",
    "entityType",
    "taxId",
    "additionalNamedInsured",
    "policyNumber",
    "insurer",
    "broker",
    "effectiveDate",
    "expirationDate",
    "premium",
    "other",
  ]),
  label: z.string().optional(),
  value: z.string(),
  normalizedValue: z.string().optional(),
  valueKind: z.enum(["string", "number", "date", "money", "address", "list", "unknown"]).optional(),
  address: OperationalAddressForPromptSchema.optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const OperationalPartyForPromptSchema = z.object({
  role: z.enum([
    "named_insured",
    "producer",
    "broker",
    "insurer",
    "carrier",
    "mga",
    "administrator",
  ]),
  name: z.string(),
  address: OperationalAddressForPromptSchema.optional(),
  sourceNodeIds: z.array(z.string()),
  sourceSpanIds: z.array(z.string()),
});

const OperationalProfilePromptSchema = z.object({
  documentType: z.enum(["policy", "quote"]).optional(),
  linesOfBusiness: z.array(z.string()).optional(),
  policyNumber: SourceBackedValueForPromptSchema.optional(),
  namedInsured: SourceBackedValueForPromptSchema.optional(),
  insurer: SourceBackedValueForPromptSchema.optional(),
  broker: SourceBackedValueForPromptSchema.optional(),
  effectiveDate: SourceBackedValueForPromptSchema.optional(),
  expirationDate: SourceBackedValueForPromptSchema.optional(),
  retroactiveDate: SourceBackedValueForPromptSchema.optional(),
  premium: SourceBackedValueForPromptSchema.optional(),
  operationsDescription: SourceBackedValueForPromptSchema.optional(),
  declarationFacts: z.array(OperationalDeclarationFactForPromptSchema).optional(),
  parties: z.array(OperationalPartyForPromptSchema).optional(),
  coverages: z.array(z.object({
    name: z.string(),
    lineOfBusiness: z.string().optional(),
    coverageCode: z.string().optional(),
    limit: z.string().optional(),
    deductible: z.string().optional(),
    premium: z.string().optional(),
    retroactiveDate: z.string().optional(),
    formNumber: z.string().optional(),
    sectionRef: z.string().optional(),
    endorsementNumber: z.string().optional(),
    limits: z.array(z.object({
      kind: OperationalCoverageTermKindSchema.optional(),
      label: z.string(),
      value: z.string(),
      amount: z.number().optional(),
      appliesTo: z.string().optional(),
      sourceNodeIds: z.array(z.string()),
      sourceSpanIds: z.array(z.string()),
    })).optional(),
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
  formInventory: SourceTreeFormHint[];
  operationalProfile: PolicyOperationalProfile;
  coverageRecovery: CoverageRecoveryDiagnostics;
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
    taskKind: ModelTaskKind;
    label?: string;
    maxTokens?: number;
    durationMs?: number;
  },
) => void;

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

function looksLikeEndorsementContinuation(node: DocumentSourceNode): boolean {
  if (looksLikeEndorsementStart(node)) return false;
  const title = cleanText(node.title, "");
  const text = sourceNodeText(node);
  return /\bendorsement\b/i.test(text) ||
    /\bcontinuation\b/i.test(title) ||
    /\ball\s+other\s+terms\s+and\s+conditions\b/i.test(text);
}

function endorsementStartTitle(node: DocumentSourceNode): string | undefined {
  return looksLikeEndorsementStart(node) ? endorsementTitle(sourceNodeText(node)) : undefined;
}

function endorsementDescription(title: string, node: DocumentSourceNode): string {
  return cleanText(
    [title, "endorsement", node.pageStart ? `page ${node.pageStart}` : undefined].filter(Boolean).join(" | "),
    title,
  );
}

function endorsementTitleKey(node: DocumentSourceNode): string | undefined {
  const title = endorsementTitle(sourceNodeText(node));
  if (title) return title.toLowerCase();
  const fallback = cleanText(node.title, "");
  return fallback ? fallback.toLowerCase() : undefined;
}

function nodePageEnd(node: DocumentSourceNode): number | undefined {
  return node.pageEnd ?? node.pageStart;
}

function pageRangeForNodes(nodes: DocumentSourceNode[]): string | undefined {
  const pages = [...new Set(nodes.flatMap((node) => {
    if (typeof node.pageStart !== "number") return [];
    const end = nodePageEnd(node) ?? node.pageStart;
    const values: number[] = [];
    for (let page = node.pageStart; page <= end; page += 1) values.push(page);
    return values;
  }))].sort((left, right) => left - right);
  if (pages.length === 0) return undefined;
  const ranges: string[] = [];
  let start = pages[0];
  let previous = pages[0];
  for (const page of pages.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    start = page;
    previous = page;
  }
  ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  return ranges.length === 1 && !ranges[0].includes("-")
    ? `page ${ranges[0]}`
    : `pages ${ranges.join(", ")}`;
}

function descriptionWithPages(description: string, nodes: DocumentSourceNode[]): string {
  const range = pageRangeForNodes(nodes);
  if (!range || new RegExp(`\\b${range.replace("-", "\\-")}\\b`, "i").test(description)) return description;
  return `${description}; ${range}`;
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

function spanPageStart(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.page ?? span.location?.startPage;
}

function spanPageEnd(span: SourceSpan): number | undefined {
  return span.pageEnd ?? span.location?.endPage ?? spanPageStart(span);
}

function spanSourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit ?? span.metadata?.elementType;
}

function pageHeadingTitleFromText(text: string, fallback: string): string {
  const normalized = cleanText(text, "");
  const headingText = normalized
    .replace(/^page\s+\d+\s*(?:\|\s*page\s*\|\s*page\s+\d+\s*\|?)?/i, "")
    .slice(0, 700);
  const patterns = [
    /\bIMPORTANT NOTICE\s+[—-]\s+HOW TO REPORT A CLAIM\b/i,
    /\bPRIVACY NOTICE TO POLICYHOLDERS\b/i,
    /\bOFAC ADVISORY NOTICE\b/i,
    /\bTERRORISM RISK INSURANCE ACT\s*\(TRIA\)\s*DISCLOSURE AND REJECTION\b/i,
    /\bDECLARATIONS PAGE\b/i,
    /\bTECHNOLOGY ERRORS?\s*&\s*OMISSIONS AND CYBER LIABILITY INSURANCE POLICY\b/i,
    /\bTRADE OR ECONOMIC SANCTIONS LIMITATION\b/i,
    /\bFORMS? AND ENDORSEMENTS\b/i,
  ];
  for (const pattern of patterns) {
    const match = headingText.match(pattern)?.[0];
    if (match) return cleanText(match, fallback);
  }
  return fallback;
}

function hasSubstantiveDeclarationsScheduleText(text: string): boolean {
  return /\bitem\s+\d+\.?\s*(?:named insured|policy number|policy period|renewal|form of business|coverage parts?|limits?|premium|extended reporting|producer|forms? and endorsements?)\b/i.test(text) ||
    /\bforms? and endorsements attached at inception\b/i.test(text) ||
    /\bcoverage parts?,?\s+limits? of liability,?\s+deductibles?,?\s+and retroactive dates\b/i.test(text) ||
    /\bannual premium\s*\(all coverage parts?\)\b/i.test(text) ||
    /\berp option\b/i.test(text) ||
    /\bproducer\b[\s\S]{0,240}\blicense\b/i.test(text);
}

function looksLikeDeclarationsStart(node: DocumentSourceNode): boolean {
  const title = cleanText(node.title, "");
  const text = sourceNodeText(node);
  if (/\b(important notice|privacy notice|ofac advisory|terrorism risk insurance act|how to report a claim)\b/i.test(text)) {
    return false;
  }
  return /^declarations?$/i.test(title) ||
    /\bdeclarations?\s+(page|schedule|section)\b/i.test(text) ||
    /^declarations?\b/i.test(cleanText(node.textExcerpt, ""));
}

function looksLikeDeclarationsContinuation(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  return looksLikeDeclarationsStart(node) ||
    /\b(item\s+\d+\.|coverage part|limits?,?\s+sub-limits?|each claim limit|aggregate limit|retroactive date|self-insured retention|premium|payment plan|producer|broker|forms? and endorsements?|attached at inception|extended reporting period|discovery period)\b/i.test(text) ||
    /\b(these declarations|policy form|[A-Z]{2,}-END\s+\d{3}|endorsement\s+(?:no\.?|number|#)?\s*\d+)\b/i.test(text);
}

function looksLikePolicyFormStart(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  const excerpt = cleanText(node.textExcerpt, "");
  if (isAdministrativeNoticeNode(node) || looksLikeDeclarationsStart(node)) return false;
  return /\bpolicy form\b/i.test(node.title) ||
    /^policy\s+form\b/i.test(excerpt) ||
    (/\btechnology errors?\s*&?\s*omissions\b/i.test(text) && /\bplease read this entire policy carefully\b/i.test(text)) ||
    /\bsection\s+[IVX0-9]+\s*[—-]\s*(insuring agreements?|definitions?|exclusions?|conditions?)\b/i.test(text) ||
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
  if (params.childIds.length < 1) return params.sourceTree;
  const children = params.childIds
    .map((id) => params.children.find((child) => child.id === id))
    .filter((child): child is DocumentSourceNode => Boolean(child));
  if (children.length < 1) return params.sourceTree;
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
    description: descriptionWithPages(params.description, children),
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

function reparentNodes(
  sourceTree: DocumentSourceNode[],
  childIds: string[],
  parentId: string,
  organizerRepair: string,
): DocumentSourceNode[] {
  const wanted = new Set(childIds);
  if (wanted.size === 0) return sourceTree;
  return sourceTree.map((node) =>
    wanted.has(node.id)
      ? {
          ...node,
          parentId,
          order: node.order + 0.001,
          metadata: {
            ...node.metadata,
            organizerRepair,
          },
        }
      : node
  );
}

function applySemanticPageGrouping(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const relabeled = sourceTree.map((node) => {
    if (node.kind === "document" || node.kind === "page_group") return node;
    let nextNode = node;
    if (node.kind === "page" && /^page\s+\d+$/i.test(node.title)) {
      const title = pageHeadingTitleFromText([node.textExcerpt, node.description].filter(Boolean).join(" "), node.title);
      if (title !== node.title) {
        nextNode = {
          ...node,
          title: simplifyOrganizerTitle(title, title, node.kind),
          metadata: { ...node.metadata, organizerRepair: "semantic_page_title" },
        };
      }
    }
    const endorsement = endorsementStartTitle(nextNode);
    if (endorsement && nextNode.kind === "page") {
      return {
        ...nextNode,
        kind: "endorsement" as const,
        title: endorsement,
        description: endorsementDescription(endorsement, nextNode),
        metadata: { ...nextNode.metadata, organizerRepair: "semantic_page_grouping" },
      };
    }
    if (nextNode.kind === "page" && looksLikeDeclarationsStart(nextNode)) {
      return {
        ...nextNode,
        title: "Declarations",
        description: cleanText([nextNode.description, "Declarations"].join(" "), "Declarations"),
        metadata: { ...nextNode.metadata, organizerRepair: "semantic_page_grouping" },
      };
    }
    if (nextNode.kind === "page" && looksLikePolicyFormStart(nextNode)) {
      return {
        ...nextNode,
        title: "Policy Form",
        description: cleanText([nextNode.description, "Policy Form"].join(" "), "Policy Form"),
        metadata: { ...nextNode.metadata, organizerRepair: "semantic_page_grouping" },
      };
    }
    return nextNode;
  });

  const rootId = sourceTreeRootId(relabeled);
  const children = (nodesByParent(relabeled).get(rootId) ?? [])
    .filter((node) => node.kind !== "document")
    .sort((left, right) => left.order - right.order);
  let nextTree = relabeled;
  const declarationsStartIndex = children.findIndex(looksLikeDeclarationsStart);
  const firstCoreIndex = children.findIndex((child) =>
    looksLikeDeclarationsStart(child) || looksLikePolicyFormStart(child) || looksLikeEndorsementStart(child)
  );
  const frontMatterBoundary = declarationsStartIndex >= 0 ? declarationsStartIndex : firstCoreIndex;

  if (frontMatterBoundary > 0) {
    const frontMatterIds = children
      .slice(0, frontMatterBoundary)
      .map((child) => child.id);
    nextTree = groupAdjacentChildren({
      sourceTree: nextTree,
      children,
      childIds: frontMatterIds,
      kind: "page_group",
      title: "Notices and Jacket",
      description: "Policy jacket, notices, and administrative pages grouped by source order",
      organizer: "semantic_front_matter_grouping",
    });
  }

  if (declarationsStartIndex >= 0) {
    const declarationIds: string[] = [];
    for (let index = declarationsStartIndex; index < children.length; index += 1) {
      const child = children[index];
      if (index > declarationsStartIndex && (looksLikePolicyFormStart(child) || looksLikeEndorsementStart(child))) break;
      if (!looksLikeDeclarationsContinuation(child)) break;
      declarationIds.push(child.id);
    }
    const existingDeclarations = children[declarationsStartIndex];
    nextTree = isDeclarationsNode(existingDeclarations)
      ? reparentNodes(
          nextTree,
          declarationIds.filter((id) => id !== existingDeclarations.id),
          existingDeclarations.id,
          "semantic_declarations_continuation",
        )
      : groupAdjacentChildren({
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
      if (isAdministrativeNoticeNode(child) || looksLikeDeclarationsStart(child)) break;
      if (index > policyStartIndex && child.kind === "page") {
        policyIds.push(child.id);
        continue;
      }
      if (!looksLikePolicyFormContinuation(child)) break;
      policyIds.push(child.id);
    }
    const existingPolicyForm = children[policyStartIndex];
    nextTree = isPolicyFormNode(existingPolicyForm)
      ? reparentNodes(
          nextTree,
          policyIds.filter((id) => id !== existingPolicyForm.id),
          existingPolicyForm.id,
          "semantic_policy_form_continuation",
        )
      : groupAdjacentChildren({
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

function isEndorsementGroup(node: DocumentSourceNode): boolean {
  return node.kind === "page_group" && /^endorsements?\b/i.test(node.title);
}

function isNoticesGroup(node: DocumentSourceNode): boolean {
  return node.kind === "page_group" && /^notices?\s+and\s+jacket$/i.test(node.title);
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

function isPolicyFormNode(node: DocumentSourceNode): boolean {
  return node.title === "Policy Form" && (node.kind === "form" || node.kind === "page_group");
}

function isDeclarationsNode(node: DocumentSourceNode): boolean {
  return node.kind === "page_group" && node.title === "Declarations";
}

function isAdministrativeNoticeNode(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  if (hasSubstantiveDeclarationsScheduleText(text)) return false;
  return /\b(specimen policy|policy jacket|important notice|privacy notice|ofac advisory|terrorism risk insurance act|tria|trade or economic sanctions|economic sanctions limitation|signature|countersignature|how to report a claim)\b/i.test(text);
}

function mergeAdministrativeNoticesIntoFrontMatter(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const rootId = sourceTreeRootId(sourceTree);
  if (!rootId) return sourceTree;
  const children = (nodesByParent(sourceTree).get(rootId) ?? []).filter((node) => node.kind !== "document");
  const noticesGroup = children.find(isNoticesGroup);
  if (!noticesGroup) return sourceTree;
  const noticesGroupChildren = new Set(
    (nodesByParent(sourceTree).get(noticesGroup.id) ?? []).map((node) => node.id),
  );
  const noticeIds = new Set(
    children
      .filter((node) =>
        node.id !== noticesGroup.id &&
        !noticesGroupChildren.has(node.id) &&
        node.kind === "page" &&
        isAdministrativeNoticeNode(node)
      )
      .map((node) => node.id),
  );
  if (noticeIds.size === 0) return sourceTree;
  return sourceTree.map((node) => noticeIds.has(node.id)
    ? {
        ...node,
        parentId: noticesGroup.id,
        metadata: {
          ...node.metadata,
          organizerRepair: "merge_administrative_notice",
        },
      }
    : node
  );
}

function rootSemanticRank(node: DocumentSourceNode): number {
  if (isNoticesGroup(node)) return 0;
  if (node.title === "Declarations") return 1;
  if (node.title === "Policy Form") return 2;
  if (isEndorsementGroup(node)) return 3;
  if (isAdministrativeNoticeNode(node)) return 0.5;
  return 2.5;
}

function normalizeRootSemanticOrder(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const rootId = sourceTreeRootId(sourceTree);
  if (!rootId) return sourceTree;
  const rootChildren = (nodesByParent(sourceTree).get(rootId) ?? [])
    .filter((node) => node.kind !== "document")
    .sort((left, right) =>
      rootSemanticRank(left) - rootSemanticRank(right) ||
      (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER) ||
      left.order - right.order ||
      left.id.localeCompare(right.id)
    );
  const orderById = new Map(rootChildren.map((node, index) => [node.id, index + 1]));
  return sourceTree.map((node) => {
    const order = orderById.get(node.id);
    return order === undefined ? node : { ...node, order };
  });
}

function normalizePolicyFormStructure(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  let nextTree = sourceTree;
  const byParent = nodesByParent(nextTree);
  const nodesToRemove = new Set<string>();

  for (const form of nextTree.filter((node) => node.kind === "form" && node.title === "Policy Form")) {
    const children = byParent.get(form.id) ?? [];
    const declarationsChildren = children.filter(isDeclarationsNode);
    const nestedPolicyForm = children.find((child) => child.id !== form.id && isPolicyFormNode(child));

    if (declarationsChildren.length === 0 && !nestedPolicyForm) continue;

    const declarationIds = new Set(declarationsChildren.map((child) => child.id));
    nextTree = nextTree.map((node) => {
      if (declarationIds.has(node.id)) {
        return {
          ...node,
          parentId: form.parentId,
          metadata: {
            ...node.metadata,
            organizerRepair: "promote_declarations_from_policy_form",
          },
        };
      }
      if (nestedPolicyForm && node.parentId === nestedPolicyForm.id) {
        return {
          ...node,
          parentId: form.id,
          metadata: {
            ...node.metadata,
            organizerRepair: "collapse_nested_policy_form",
          },
        };
      }
      return node;
    });

    if (nestedPolicyForm) nodesToRemove.add(nestedPolicyForm.id);
  }

  if (nodesToRemove.size > 0) {
    nextTree = nextTree.filter((node) => !nodesToRemove.has(node.id));
  }

  return nextTree;
}

function nestEndorsementContinuationPages(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const byParent = nodesByParent(sourceTree);
  const continuationParentById = new Map<string, string>();

  for (const group of sourceTree.filter(isEndorsementGroup)) {
    const children = byParent.get(group.id) ?? [];
    let currentEndorsement: DocumentSourceNode | undefined;

    for (const child of children) {
      if (child.kind === "endorsement" && endorsementStartTitle(child)) {
        currentEndorsement = child;
        continue;
      }

      if (!currentEndorsement || child.kind !== "page") continue;
      continuationParentById.set(child.id, currentEndorsement.id);
    }
  }

  if (continuationParentById.size === 0) return sourceTree;

  return sourceTree.map((node) => {
    const parentId = continuationParentById.get(node.id);
    if (!parentId) return node;
    return {
      ...node,
      parentId,
      metadata: {
        ...node.metadata,
        organizerRepair: "nest_endorsement_continuation",
      },
    };
  });
}

function nodeDepth(node: DocumentSourceNode): number {
  return node.path ? node.path.split("/").filter(Boolean).length : 0;
}

function shouldUseOwnEvidenceForContainer(node: DocumentSourceNode): boolean {
  return node.kind === "endorsement" || node.kind === "page" || node.kind === "table" || node.kind === "table_row" || node.kind === "table_cell" || node.kind === "text";
}

function normalizeContainerEvidenceFromChildren(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const byParent = nodesByParent(sourceTree);
  const byId = new Map(sourceTree.map((node) => [node.id, node]));
  const sorted = [...sourceTree].sort((left, right) => nodeDepth(right) - nodeDepth(left));

  for (const originalNode of sorted) {
    const children = (byParent.get(originalNode.id) ?? [])
      .map((child) => byId.get(child.id))
      .filter((child): child is DocumentSourceNode => Boolean(child));
    if (children.length === 0) continue;

    const currentNode = byId.get(originalNode.id) ?? originalNode;
    const evidenceNodes = shouldUseOwnEvidenceForContainer(currentNode)
      ? [currentNode, ...children]
      : children;
    const pageStarts = evidenceNodes
      .map((node) => node.pageStart)
      .filter((page): page is number => typeof page === "number");
    const pageEnds = evidenceNodes
      .map((node) => node.pageEnd ?? node.pageStart)
      .filter((page): page is number => typeof page === "number");
    const sourceSpanIds = [...new Set(evidenceNodes.flatMap((node) => node.sourceSpanIds))];
    const bbox = evidenceNodes.flatMap((node) => node.bbox ?? []).slice(0, 12);
    const childText = children
      .map((child) => child.textExcerpt ?? child.description)
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 1600);

    byId.set(currentNode.id, {
      ...currentNode,
      sourceSpanIds,
      pageStart: pageStarts.length ? Math.min(...pageStarts) : currentNode.pageStart,
      pageEnd: pageEnds.length ? Math.max(...pageEnds) : currentNode.pageEnd,
      bbox,
      order: Math.min(currentNode.order, ...children.map((child) => child.order)),
      description: descriptionWithPages(
        currentNode.description.replace(/;\s*pages?\s+[0-9,\s-]+$/i, ""),
        evidenceNodes,
      ),
      textExcerpt: shouldUseOwnEvidenceForContainer(currentNode)
        ? currentNode.textExcerpt
        : childText || currentNode.textExcerpt,
    });
  }

  return sourceTree.map((node) => byId.get(node.id) ?? node);
}

function metadataText(node: DocumentSourceNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isTitleBlockNode(node: DocumentSourceNode): boolean {
  if (node.kind !== "text") return false;
  return metadataText(node, "organizer") === "title_block" ||
    metadataText(node, "elementType") === "title" ||
    metadataText(node, "sourceUnit") === "title";
}

function isRejectableSectionHeading(text: string, container: DocumentSourceNode): boolean {
  const normalized = cleanText(text, "");
  if (!normalized) return true;
  if (normalized.length > 160) return true;
  if (/^page\s+\d+$/i.test(normalized)) return true;
  if (/^table\s+\d+$/i.test(normalized)) return true;
  if (/^(document|text|header row|row\s+\d+)$/i.test(normalized)) return true;
  if (/^(northwoods continental insurance company|specimen policy|for testing only)$/i.test(normalized)) return true;
  if (/^technology errors?\s*&\s*omissions and cyber liability insurance policy$/i.test(normalized)) return true;
  if (/^declarations(?:\s+page)?$/i.test(normalized) && /^declarations$/i.test(container.title)) return true;
  if (/^policy\s+form$/i.test(normalized) && /^policy\s+form$/i.test(container.title)) return true;
  if (/^endorsement\s+(?:no\.?|number|#)/i.test(normalized) && container.kind === "endorsement") return true;
  if (/\b(policyholder|policyholders)\b/i.test(normalized) && normalized.length < 40) return true;
  return false;
}

function sectionHeadingTitle(node: DocumentSourceNode, container: DocumentSourceNode): string | undefined {
  if (!isTitleBlockNode(node)) return undefined;
  const text = cleanText(node.title || node.textExcerpt, "");
  if (isRejectableSectionHeading(text, container)) return undefined;
  const words = text.split(/\s+/);
  if (words.length > 18) return undefined;

  const structured =
    /^(SECTION|PART|ARTICLE|SCHEDULE)\b/i.test(text) ||
    /^Item\s+\d+[\.:]/i.test(text) ||
    /^Coverage\s+Part\b/i.test(text) ||
    /^Endorsement\s+(?:No\.?|Number|#)\s+/i.test(text);
  const uppercaseLetters = [...text].filter((char) => /[A-Z]/.test(char)).length;
  const lowercaseLetters = [...text].filter((char) => /[a-z]/.test(char)).length;
  const mostlyUppercase = uppercaseLetters > 0 && uppercaseLetters >= lowercaseLetters * 1.5;
  const hasSentencePunctuation = /[.;:]\s+\S/.test(text) || /[.;:]$/.test(text);
  const sentenceLike = /\b(is|are|was|were|will|shall|may|must|means|includes|provided|subject|available|attached|remain|constitutes)\b/i.test(text) &&
    /[a-z]/.test(text);

  if (!structured && (!mostlyUppercase || hasSentencePunctuation || sentenceLike)) return undefined;
  return simplifyOrganizerTitle(text, text, node.kind);
}

function sectionKindForTitle(title: string): DocumentSourceNodeKind {
  if (/^schedule\b/i.test(title) || /\b(forms? and endorsements?|coverage parts?|limits?|premium|declarations?)\b/i.test(title)) return "schedule";
  if (/^(section|part|article|item)\b/i.test(title)) return "section";
  return "section";
}

function hasAncestor(
  node: DocumentSourceNode,
  ancestorId: string,
  byId: Map<string, DocumentSourceNode>,
): boolean {
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId) {
    if (parentId === ancestorId) return true;
    if (seen.has(parentId)) return false;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  return false;
}

function shouldBuildSectionsForContainer(node: DocumentSourceNode): boolean {
  if (isNoticesGroup(node)) return false;
  if (isEndorsementGroup(node)) return false;
  return node.kind === "form" || node.kind === "page_group" || node.kind === "endorsement";
}

function applyTitleSectionHierarchy(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const byId = new Map(sourceTree.map((node) => [node.id, node]));
  const byParent = nodesByParent(sourceTree);
  const updates = new Map<string, DocumentSourceNode>();

  for (const container of sourceTree.filter(shouldBuildSectionsForContainer)) {
    const pageIds = new Set(
      sourceTree
        .filter((node) => node.kind === "page" && hasAncestor(node, container.id, byId))
        .map((node) => node.id),
    );
    if (pageIds.size === 0) continue;

    const directPageChildren = sourceTree
      .filter((node) =>
        node.parentId !== undefined &&
        pageIds.has(node.parentId) &&
        node.kind !== "table_row" &&
        node.kind !== "table_cell"
      )
      .sort((left, right) =>
        (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER) ||
        left.order - right.order ||
        left.id.localeCompare(right.id)
      );
    if (directPageChildren.length === 0) continue;

    let currentSectionId: string | undefined;
    for (let index = 0; index < directPageChildren.length; index += 1) {
      const child = directPageChildren[index];
      const current = updates.get(child.id) ?? child;
      const heading = sectionHeadingTitle(current, container);
      if (heading) {
        const descendants = byParent.get(child.id) ?? [];
        const hasOwnContent = descendants.some((descendant) => descendant.kind !== "table_row" && descendant.kind !== "table_cell");
        let hasFollowingContent = false;
        for (const nextChild of directPageChildren.slice(index + 1)) {
          const next = updates.get(nextChild.id) ?? nextChild;
          if (sectionHeadingTitle(next, container)) break;
          hasFollowingContent = true;
          break;
        }
        if (!hasOwnContent && !hasFollowingContent) {
          currentSectionId = undefined;
          continue;
        }
        currentSectionId = child.id;
        updates.set(child.id, {
          ...current,
          parentId: container.id,
          kind: sectionKindForTitle(heading),
          title: heading,
          description: descriptionWithPages(cleanText([heading, "section"].join(" "), heading), [current, ...descendants]),
          metadata: {
            ...current.metadata,
            organizer: "title_section",
            sourceTreeVersion: "v3",
          },
        });
        continue;
      }

      if (!currentSectionId) continue;
      const parent = current.parentId ? byId.get(current.parentId) : undefined;
      if (!parent || parent.kind !== "page") continue;
      updates.set(child.id, {
        ...current,
        parentId: currentSectionId,
        metadata: {
          ...current.metadata,
          organizerRepair: "title_section_continuation",
        },
      });
    }
  }

  if (updates.size === 0) return sourceTree;
  return normalizeDocumentSourceTreePaths(sourceTree.map((node) => updates.get(node.id) ?? node));
}

function normalizeSemanticHierarchy(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const normalized = normalizeDocumentSourceTreePaths(
    normalizePolicyFormStructure(
      normalizeDocumentSourceTreePaths(sourceTree),
    ),
  );
  const nested = normalizeDocumentSourceTreePaths(nestEndorsementContinuationPages(normalized));
  const mergedNotices = normalizeDocumentSourceTreePaths(mergeAdministrativeNoticesIntoFrontMatter(nested));
  const sectioned = normalizeDocumentSourceTreePaths(applyTitleSectionHierarchy(mergedNotices));
  const withEvidence = normalizeContainerEvidenceFromChildren(sectioned);
  return normalizeDocumentSourceTreePaths(
    normalizeRootSemanticOrder(normalizeContainerEvidenceFromChildren(withEvidence)),
  );
}

function applyEndorsementGrouping(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const rootId = sourceTreeRootId(sourceTree);
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
      description: endorsementDescription(title, node),
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
      description: descriptionWithPages(cleanText(node.description, "Endorsement forms grouped by source order"), byParent.get(node.id) ?? [node]),
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
      description: endorsementDescription(title, node),
      metadata: {
        ...node.metadata,
        organizerRepair: "normalize_endorsement_grouping",
      },
    };
  });

  for (const [parentId, children] of byParent) {
    if (parentId !== rootId) continue;
    if (endorsementGroupIds.has(parentId ?? "")) continue;
    const endorsementChildren = children.filter((child) => child.kind === "endorsement" && !isEndorsementGroup(child));
    if (endorsementChildren.length < 1) continue;
    const endorsementGroupChildren: DocumentSourceNode[] = [];
    let hasSeenEndorsementStart = false;
    for (const child of children) {
      if (child.kind === "endorsement" && !isEndorsementGroup(child)) {
        hasSeenEndorsementStart = true;
        endorsementGroupChildren.push(child);
        continue;
      }
      if (hasSeenEndorsementStart && child.kind === "page" && looksLikeEndorsementContinuation(child)) {
        endorsementGroupChildren.push(child);
      }
    }
    if (endorsementGroupChildren.length < 1) continue;
    const documentId = endorsementChildren[0].documentId;
    const pageStarts = endorsementGroupChildren.map((child) => child.pageStart).filter((page): page is number => typeof page === "number");
    const pageEnds = endorsementGroupChildren.map((child) => child.pageEnd ?? child.pageStart).filter((page): page is number => typeof page === "number");
    const order = Math.min(...endorsementChildren.map((child) => child.order));
    const existingGroup = groupsByParent.get(parentId);
    const groupId = existingGroup?.id ?? endorsementGroupNodeId(documentId, parentId);
    const groupNode: DocumentSourceNode = existingGroup ?? {
      id: groupId,
      documentId,
      parentId,
      kind: "page_group",
      title: "Endorsements",
      description: descriptionWithPages("Endorsement forms grouped by source order", endorsementGroupChildren),
      textExcerpt: undefined,
      sourceSpanIds: [],
      pageStart: pageStarts.length ? Math.min(...pageStarts) : undefined,
      pageEnd: pageEnds.length ? Math.max(...pageEnds) : undefined,
      bbox: endorsementGroupChildren.flatMap((child) => child.bbox ?? []).slice(0, 12),
      order,
      path: "",
      metadata: { sourceTreeVersion: "v3", organizer: "endorsement_grouping" },
    };
    const childSpanIds = [...new Set(endorsementGroupChildren.flatMap((child) => child.sourceSpanIds))];
    const childPageStart = pageStarts.length ? Math.min(...pageStarts) : undefined;
    const childPageEnd = pageEnds.length ? Math.max(...pageEnds) : undefined;
    const normalizedGroup = {
      ...groupNode,
      sourceSpanIds: groupNode.sourceSpanIds.length ? groupNode.sourceSpanIds : childSpanIds,
      pageStart: childPageStart === undefined
        ? groupNode.pageStart
        : groupNode.pageStart === undefined
          ? childPageStart
          : Math.min(groupNode.pageStart, childPageStart),
      pageEnd: childPageEnd === undefined
        ? groupNode.pageEnd
        : groupNode.pageEnd === undefined
          ? childPageEnd
          : Math.max(groupNode.pageEnd, childPageEnd),
      order,
    };
    groupsByParent.set(parentId, normalizedGroup);
    if (!existingGroup) nextTree.push(normalizedGroup);
    else nextTree = nextTree.map((node) => node.id === normalizedGroup.id ? normalizedGroup : node);
    const endorsementGroupChildIds = new Set(endorsementGroupChildren.map((child) => child.id));
    nextTree = nextTree.map((node) =>
      endorsementGroupChildIds.has(node.id)
        ? { ...node, parentId: groupId, order: node.order + 0.001 }
        : node,
    );
  }

  return collapseNestedDuplicateEndorsements(normalizeSemanticHierarchy(nextTree));
}

function nearestEndorsementAncestor(
  node: DocumentSourceNode,
  byId: Map<string, DocumentSourceNode>,
): DocumentSourceNode | undefined {
  let parentId = node.parentId;
  const seen = new Set<string>();
  while (parentId) {
    if (seen.has(parentId)) return undefined;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (parent.kind === "endorsement") return parent;
    parentId = parent.parentId;
  }
  return undefined;
}

function collapseNestedDuplicateEndorsements(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const byId = new Map(sourceTree.map((node) => [node.id, node]));
  const replacementById = new Map<string, string>();
  const duplicateEvidenceByTarget = new Map<string, DocumentSourceNode[]>();

  for (const node of sourceTree) {
    if (node.kind !== "endorsement") continue;
    const ancestor = nearestEndorsementAncestor(node, byId);
    if (!ancestor) continue;
    if (endorsementTitleKey(node) !== endorsementTitleKey(ancestor)) continue;
    replacementById.set(node.id, ancestor.id);
    duplicateEvidenceByTarget.set(ancestor.id, [
      ...(duplicateEvidenceByTarget.get(ancestor.id) ?? []),
      node,
    ]);
  }

  if (replacementById.size === 0) return sourceTree;

  const replacementParent = (parentId: string | undefined): string | undefined => {
    let next = parentId;
    const seen = new Set<string>();
    while (next && replacementById.has(next) && !seen.has(next)) {
      seen.add(next);
      next = replacementById.get(next);
    }
    return next;
  };
  const updated = sourceTree
    .filter((node) => !replacementById.has(node.id))
    .map((node) => {
      const evidence = duplicateEvidenceByTarget.get(node.id);
      const parentId = replacementParent(node.parentId);
      if (!evidence?.length) {
        return parentId === node.parentId ? node : {
          ...node,
          parentId,
          metadata: {
            ...node.metadata,
            organizerRepair: "collapse_duplicate_endorsement_wrapper",
          },
        };
      }
      const evidenceNodes = [node, ...evidence];
      const pageStarts = evidenceNodes
        .map((item) => item.pageStart)
        .filter((page): page is number => typeof page === "number");
      const pageEnds = evidenceNodes
        .map((item) => item.pageEnd ?? item.pageStart)
        .filter((page): page is number => typeof page === "number");
      return {
        ...node,
        parentId,
        sourceSpanIds: [...new Set(evidenceNodes.flatMap((item) => item.sourceSpanIds))],
        pageStart: pageStarts.length ? Math.min(...pageStarts) : node.pageStart,
        pageEnd: pageEnds.length ? Math.max(...pageEnds) : node.pageEnd,
        bbox: evidenceNodes.flatMap((item) => item.bbox ?? []).slice(0, 12),
        metadata: {
          ...node.metadata,
          organizerRepair: "collapse_duplicate_endorsement_wrapper",
        },
      };
    });

  return normalizeDocumentSourceTreePaths(normalizeContainerEvidenceFromChildren(updated));
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

type OperationalProfileEvidenceEntry = {
  sourceSpanId: string;
  sourceNodeIds: string[];
  pageStart?: number;
  pageEnd?: number;
  sourceUnit?: string;
  formNumber?: string;
  text: string;
};

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

function sourceNodeIdsBySpanId(sourceTree: DocumentSourceNode[]): Map<string, string[]> {
  const bySpan = new Map<string, string[]>();
  for (const node of sourceTree) {
    for (const spanId of node.sourceSpanIds) {
      const nodes = bySpan.get(spanId) ?? [];
      nodes.push(node.id);
      bySpan.set(spanId, nodes);
    }
  }
  return bySpan;
}

function operationalEvidenceScore(span: SourceSpan): number {
  const text = cleanText([
    span.text,
    span.formNumber,
    span.sourceUnit,
    span.metadata?.elementType,
    span.metadata?.sourceUnit,
  ].filter(Boolean).join(" "), "");
  if (!text) return 0;

  let score = 0;
  if (span.sourceUnit === "table_row" || span.sourceUnit === "table") score += 5;
  if (span.metadata?.elementType === "title") score += 4;
  if (span.sourceUnit === "page") score -= 3;

  if (/\b(policy\s*(number|period|term)|effective date|expiration date|expiry date|named insured|insurer|carrier|security|broker|producer|premium|total due)\b/i.test(text)) score += 12;
  if (/\b(mailing address|business address|address|managing general (?:agent|underwriter)|mga|administrator|description of operations|operations description|nature of business|business description)\b/i.test(text)) score += 12;
  if (/\b\d{1,6}\s+[A-Z0-9][^\n,]{1,80}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|highway|hwy)\b/i.test(text)) score += 10;
  if (/\b[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(text)) score += 10;
  if (/\b(coverage part|limit(?:s)? of liability|deductible|retention|retroactive date|aggregate|sublimit|sub-limit|each claim|each loss|each occurrence|coinsurance)\b/i.test(text)) score += 14;
  if (/\bendorsement\s+(?:no\.?|number|#)?\s*[A-Z0-9]|forms? and endorsements?|attached at inception|schedule\b/i.test(text)) score += 8;
  if (/\bitem\s+\d+\.?\s*(?:named insured|policy number|policy period|renewal|form of business|coverage parts?|premium|extended reporting|producer|forms? and endorsements?)\b/i.test(text)) score += 10;
  if (/\$[\d,.]+|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4}/.test(text)) score += 3;

  return score;
}

function spanTableId(span: SourceSpan): string | undefined {
  return span.table?.tableId ?? span.metadata?.tableId;
}

function isTableCellSpan(span: SourceSpan): boolean {
  return spanSourceUnit(span) === "table_cell";
}

function isOperationalEvidenceAnchor(span: SourceSpan): boolean {
  const sourceUnit = spanSourceUnit(span);
  if (sourceUnit === "table_cell") return false;
  if (sourceUnit === "table" || sourceUnit === "table_row") return true;

  const text = cleanText([span.text, span.formNumber].filter(Boolean).join(" "), "");
  if (!text) return false;
  if (sourceUnit === "page") {
    return hasSubstantiveDeclarationsScheduleText(text) ||
      /\b(declarations?|named insured|policy number|policy period|effective date|expiration date|premium|total due|producer|mailing address|mga|administrator|description of operations|nature of business|business description)\b/i.test(text);
  }
  if (/\bitem\s+\d+\.?\s*(?:named insured|policy number|policy period|renewal|form of business|coverage parts?|premium|extended reporting|producer|forms? and endorsements?)\b/i.test(text)) return true;
  if (/\b(policy\s*(number|period)|effective date|expiration date|expiry date|named insured|insurer|carrier|broker|producer|premium|total due)\b/i.test(text)) return true;
  if (/\b(mailing address|business address|address|managing general (?:agent|underwriter)|mga|administrator|description of operations|operations description|nature of business|business description)\b/i.test(text)) return true;
  if (/\b\d{1,6}\s+[A-Z0-9][^\n,]{1,80}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|highway|hwy)\b/i.test(text)) return true;
  if (/\b[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(text)) return true;
  if (/\b(coverage part|forms? and endorsements?|attached at inception|endorsement\s+(?:no\.?|number|#)?\s*[A-Z0-9])\b/i.test(text)) return true;
  if (/\$[\d,.]+|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4}/.test(text)) return true;
  return false;
}

function operationalEvidencePages(sourceSpans: SourceSpan[]): Set<number> {
  const scores = new Map<number, number>();

  for (const span of sourceSpans) {
    const page = spanPageStart(span);
    if (typeof page !== "number") continue;
    const text = cleanText([span.text, span.formNumber, spanSourceUnit(span)].filter(Boolean).join(" "), "");
    if (!text) continue;

    let score = Math.max(0, operationalEvidenceScore(span));
    if (/\bdeclarations?\s+(page|schedule)?\b/i.test(text)) score += 24;
    if (/\bitem\s+\d+\.?\s*(?:named insured|policy number|policy period|coverage parts?|limits?|premium|producer|forms? and endorsements?)\b/i.test(text)) score += 20;
    if (/\bcoverage parts?,?\s+limits? of liability,?\s+deductibles?,?\s+and retroactive dates\b/i.test(text)) score += 24;
    if (/\b(policy\s*(number|period|term)|effective date|expiration date|expiry date|named insured|insurer|carrier|security)\b/i.test(text)) score += 12;
    if (/\b(premium|total due|tax|fee|producer|broker)\b/i.test(text)) score += 10;
    if (/\b(mailing address|business address|managing general (?:agent|underwriter)|mga|administrator|description of operations|operations description|nature of business|business description)\b/i.test(text)) score += 16;
    if (/\b(endorsement\s+(?:no\.?|number|#)?\s*[A-Z0-9]|attached at inception|forms? and endorsements?)\b/i.test(text)) score += 8;
    if (/\b(definitions?|exclusions?|conditions?|duties in the event|action against|cancellation by)\b/i.test(text)) score -= 12;

    if (score > 0) scores.set(page, (scores.get(page) ?? 0) + score);
  }

  return new Set(
    [...scores.entries()]
      .filter(([, score]) => score >= 18)
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])
      .slice(0, 12)
      .map(([page]) => page),
  );
}

function operationalProfileEvidence(sourceTree: DocumentSourceNode[], sourceSpans: SourceSpan[]): OperationalProfileEvidenceEntry[] {
  const sorted = [...sourceSpans].sort((left, right) =>
    (spanPageStart(left) ?? Number.MAX_SAFE_INTEGER) - (spanPageStart(right) ?? Number.MAX_SAFE_INTEGER) ||
    (left.location?.charStart ?? Number.MAX_SAFE_INTEGER) - (right.location?.charStart ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );
  const selectedPages = operationalEvidencePages(sorted);
  const selected = new Set<number>();
  const selectedTableIds = new Set<string>();
  for (let index = 0; index < sorted.length; index += 1) {
    const span = sorted[index];
    const score = operationalEvidenceScore(span);
    if (score < 8) continue;
    if (!isOperationalEvidenceAnchor(span)) continue;
    const page = spanPageStart(span);
    if (selectedPages.size > 0 && typeof page === "number" && !selectedPages.has(page) && score < 30) continue;
    const tableId = spanTableId(span);
    if (tableId && !isTableCellSpan(span)) selectedTableIds.add(tableId);
    const neighborWindow = score >= 24 ? 2 : 1;
    for (let offset = -neighborWindow; offset <= neighborWindow; offset += 1) {
      const neighborIndex = index + offset;
      const neighbor = sorted[neighborIndex];
      if (!neighbor || spanPageStart(neighbor) !== page) continue;
      if (selectedPages.size > 0 && typeof page === "number" && !selectedPages.has(page) && operationalEvidenceScore(neighbor) < 30) continue;
      const neighborText = cleanText(neighbor.text, "");
      if (!neighborText || neighborText.length > 3000) continue;
      selected.add(neighborIndex);
    }
  }
  if (selectedTableIds.size > 0) {
    sorted.forEach((span, index) => {
      const tableId = spanTableId(span);
      if (!tableId || !selectedTableIds.has(tableId) || isTableCellSpan(span)) return;
      const text = cleanText(span.text, "");
      if (text && text.length <= 3000) selected.add(index);
    });
  }

  const nodeIdsBySpanId = sourceNodeIdsBySpanId(sourceTree);
  const seenText = new Set<string>();
  const entries = [...selected]
    .sort((left, right) => left - right)
    .map((index) => sorted[index])
    .filter((span) => !isTableCellSpan(span))
    .flatMap((span): OperationalProfileEvidenceEntry[] => {
      const text = cleanText(span.text, "");
      if (!text) return [];
      const key = `${spanPageStart(span) ?? "na"}:${text.toLowerCase().slice(0, 240)}`;
      if (seenText.has(key)) return [];
      seenText.add(key);
      return [{
        sourceSpanId: span.id,
        sourceNodeIds: [...new Set(nodeIdsBySpanId.get(span.id) ?? [])].slice(0, 4),
        pageStart: spanPageStart(span),
        pageEnd: spanPageEnd(span),
        sourceUnit: spanSourceUnit(span),
        formNumber: span.formNumber,
        text: text.slice(0, span.sourceUnit === "page" ? 900 : 700),
      }];
    });

  const detailEntries = entries.filter((entry) => entry.sourceUnit !== "page");
  const pageEntries = entries.filter((entry) => entry.sourceUnit === "page");
  return [...detailEntries, ...pageEntries];
}

function sourceTreeRootId(sourceTree: DocumentSourceNode[]): string | undefined {
  return sourceTree.find((node) => node.kind === "document")?.id;
}

function operationalProfilePromptNodes(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  return sourceTree
    .filter((node) => node.kind !== "document")
    .filter((node) => {
      if (["page_group", "form", "endorsement", "schedule", "table", "table_row", "table_cell"].includes(node.kind)) {
        return true;
      }
      const text = [node.title, node.path, node.description, node.textExcerpt]
        .filter(Boolean)
        .join(" ");
      return /\b(policy\s*(number|period)|named insured|insurer|carrier|broker|producer|managing general (?:agent|underwriter)|mga|administrator|mailing address|description of operations|operations description|nature of business|business description|premium|coverage|limit|liability|deductible|retention|retroactive|aggregate|sublimit|sub-limit|endorsement)\b/i.test(text);
    })
    .slice(0, 420);
}

function emptyOperationalProfile(): PolicyOperationalProfile {
  return {
    documentType: "policy",
    linesOfBusiness: ["UN"],
    declarationFacts: [],
    coverages: [],
    coverageSchedules: [],
    premiumBreakdown: [],
    taxesAndFees: [],
    parties: [],
    endorsementSupport: [],
    sourceNodeIds: [],
    sourceSpanIds: [],
    warnings: [],
  };
}

function buildOperationalProfilePrompt(sourceTree: DocumentSourceNode[], sourceSpans: SourceSpan[]): string {
  const evidence = operationalProfileEvidence(sourceTree, sourceSpans);
  const fallbackNodes = evidence.length
    ? []
    : operationalProfilePromptNodes(sourceTree).map((node) =>
        compactNode(node, node.kind === "page" || node.kind === "endorsement" ? 900 : 700),
      );
  return `Extract a source-backed operational profile for an insurance policy.

Return only high-value operational facts needed for policy lists, Q&A, compliance, and certificate generation:
- policy number, named insured, insurer/carrier/security, broker/producer, policy period, retroactive date, premium, and the insured's description of operations
- parties[] rows for named insured, producer/broker, insurer/carrier, and MGA/administrator identities and their mailing addresses
- source-backed declarationFacts for named-insured identity details: named insured, mailing address, DBA, entity type, tax ID/FEIN, additional named insureds, and other durable declaration-page identity facts
- coverage units with their own nested limit terms, deductibles/retentions, retroactive dates, premiums, and form references
- coverage type labels
- coverage lineOfBusiness ACORD codes when a coverage unit can be assigned to one specific line

Rules:
- Every returned value must include sourceNodeIds or sourceSpanIds from the provided evidence.
- When citing an evidence entry, copy its sourceSpanId into the returned sourceSpanIds array.
- If a value is not directly supported, omit it.
- Prefer declarations, schedules, premium tables, and endorsement schedules over generic policy wording.
- Put named-insured mailing address in declarationFacts[] with field "mailingAddress", valueKind "address", a user-facing value string, and structured address fields when present. Do not put producer, broker, insurer, mortgagee, loss-payee, or certificate-holder addresses in mailingAddress.
- Put every source-backed policy party in parties[] using only these canonical roles: "named_insured", "producer", "broker", "insurer", "carrier", "mga", or "administrator". Keep producer/broker, insurer/carrier, and MGA/administrator addresses policy-scoped in parties[]; never represent them as the named-insured mailingAddress declaration fact.
- When a party's address is present, return its available street1, street2, city, state, zip, country, and formatted parts under parties[].address. Partial addresses are allowed in parties[], but never guess a missing component. The party row must cite the source node or source span that supports both the identity and address.
- Put the insured's directly stated business or operations description in operationsDescription. Do not synthesize it from coverages, industry inference, website research, or generic policy wording.
- Put DBA or trade name in declarationFacts[] with field "dba"; entity/legal form in field "entityType"; FEIN/tax ID in field "taxId"; each additional named insured in field "additionalNamedInsured".
- For effective, expiration, retroactive, and other date fields, return a normalized YYYY-MM-DD value when the source date is unambiguous, including month-name dates such as "20 Feb 2026". Do not emit fragmented date text such as "20 2 2026".
- For broker/producer, extract the agency or company legal name, not the license role, credential, or type. In a block like "Bayshore Insurance Brokers, LLC" followed by "Surplus Lines Broker - CA License No. ...", broker.value must be "Bayshore Insurance Brokers, LLC"; the surplus-lines role and license number are not the broker name.
- On declarations pages, treat "Item N" labels as section boundaries. Use Item 6 or equivalent coverage-schedule rows for coverage limits, deductibles, aggregate terms, and retroactive dates; do not merge Item 7 premium, Item 8 ERP, Item 9 producer, or Item 10 forms into Item 6 coverage facts.
- Premium, tax, fee, payment-plan, rating, exposure, and reporting-value schedules are billing evidence, not coverage schedules. Extract the total policy premium into premium when supported, but do not create coverages[] entries from premium-only or fee-only rows, and never use Total Premium, MGA Fee, tax, stamping fee, reporting values, or exposure annual rate as a coverage limit.
- A coverage schedule row's coverage name should come from the "Coverage Part" or equivalent row label. Limit, deductible, aggregate, sublimit, retention, and retroactive-date values belong as nested terms under that coverage, not in the coverage title.
- Put the ACORD line of business code for each coverage unit in coverages[].lineOfBusiness only when the row belongs to one specific line, such as CGL, AUTOB, WORK, UMBRC, EXLIA, EO, OLIB, EPLI, DO, FIDUC, CRIME, INMRC, COMAR, PROPC, PROP, BOP, HOME, DFIRE, FLOOD, or GARAG. Do not use limit labels such as Each Occurrence, Aggregate, Products-Completed Operations Aggregate, deductible, retention, retroactive date, or sublimit as lines of business.
- If a package or multi-line row cannot be assigned to exactly one ACORD line, omit coverages[].lineOfBusiness for that coverage.
- If a coverage schedule continues onto the next page before the next item marker, include the continuation rows in the same coverage or declaration item.
- If one schedule row or continuation row states the same amount with multiple bases, such as "$1,000,000 Each Claim / Aggregate", return separate limit terms for each basis using the same value instead of one combined "Each Claim / Aggregate" term.
- LiteParse text can fragment visual table cells into adjacent lines. Before extracting coverage terms, mentally join adjacent lines in the same declaration item or schedule row. For example, "$2,000,000 Policy Each Claim" followed immediately by "Aggregate" means "$2,000,000 Policy Aggregate"; a line ending with "/" followed by "Aggregate ..." means the limit cell continues, not a new coverage.
- Forms-and-endorsements schedules are form schedule evidence, not coverage limits. Do not turn form schedule rows into coverage units unless the row also states a coverage-specific limit or deductible.
- Keep each coverage unit tied to one evidence scope: a declaration/core schedule row, a core policy form section, or one specific endorsement schedule. Do not merge declaration facts and endorsement schedule facts into the same coverage unit, even when they use the same coverage name.
- If the declarations schedule and an endorsement schedule both list Network Security, Social Engineering Fraud, Regulatory Proceedings, or another same-named coverage, return separate coverage units for each supported source scope.
- Use the declaration coverage name for declaration/core schedule rows. Use the endorsement title or endorsement schedule coverage name for endorsement rows, and include formNumber and endorsementNumber when source-backed.
- For life, critical illness, disability, and long-term care policies, keep named benefit units and benefit subconditions as operational facts even when they do not have dollar limits. Examples include death benefit, disability benefit, total disability, catastrophic disability, return of premium, waiver, and conversion options. Put subcondition details in coverages[].limits with kind "other" when they belong under a broader benefit.
- Treat an endorsement as one coverage unit when it contains a schedule. Do not split an endorsement schedule into generic rows like "Aggregate Limit".
- For coverage schedules, put each claim, aggregate, sublimit, retention, deductible, and retroactive date values in coverages[].limits with labels and source IDs. Keep the legacy coverages[].limit as the primary display value only.
- Extract coinsurance, participation percentage, or insurer/named-insured split terms as coverages[].limits entries with kind "other" when they are part of a coverage schedule.
- Do not copy entire policy wording into fields.
- Extract facts directly from source evidence. There is no deterministic fact baseline.

Source evidence:
${JSON.stringify(evidence.length ? evidence : fallbackNodes, null, 2)}

Return JSON for the operational profile.`;
}

function isSourceTreeHeaderRow(row: DocumentSourceNode): boolean {
  return row.metadata?.isHeader === true || row.metadata?.isHeader === "true";
}

function tableCellText(cell: DocumentSourceNode): string {
  return cleanText(cell.textExcerpt ?? cell.description ?? cell.title, "");
}

function tableRowTextForPrompt(row: DocumentSourceNode, cells: DocumentSourceNode[]): string {
  return cleanText(
    cells.length
      ? cells.map(tableCellText).filter(Boolean).join(" | ")
      : row.textExcerpt ?? row.description ?? row.title,
    row.title,
  );
}

function tableCellColumnIndex(cell: DocumentSourceNode, fallbackIndex: number): number {
  const metadataIndex = cell.metadata?.columnIndex;
  return typeof metadataIndex === "number" && Number.isInteger(metadataIndex)
    ? metadataIndex
    : fallbackIndex;
}

function isGenericColumnTitle(value: string | undefined): boolean {
  const title = cleanText(value, "");
  return !title || /^(?:column\s+\d+|table cell|value)$/i.test(title);
}

function metadataColumnName(metadata: DocumentSourceNode["metadata"]): string | undefined {
  const value = metadata?.columnName;
  return typeof value === "string" ? cleanText(value, "") || undefined : undefined;
}

function metadataTableColumnName(metadata: DocumentSourceNode["metadata"]): string | undefined {
  const table = metadata?.table;
  if (!table || typeof table !== "object" || Array.isArray(table)) return undefined;
  if (!("columnName" in table)) return undefined;
  const value = table.columnName;
  return typeof value === "string" ? cleanText(value, "") || undefined : undefined;
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

const NORMALIZED_COMPATIBILITY_FIELDS = new Set<keyof PolicyOperationalProfile>([
  "policyNumber",
  "namedInsured",
  "insurer",
  "broker",
  "effectiveDate",
  "expirationDate",
  "retroactiveDate",
]);

function valueOf(profile: PolicyOperationalProfile, key: keyof PolicyOperationalProfile): string | undefined {
  const value = profile[key];
  if (!value || typeof value !== "object" || Array.isArray(value) || !("value" in value)) return undefined;
  if (
    NORMALIZED_COMPATIBILITY_FIELDS.has(key) &&
    "normalizedValue" in value &&
    typeof value.normalizedValue === "string" &&
    value.normalizedValue.trim()
  ) {
    return value.normalizedValue;
  }
  return String(value.value);
}

function provenanceFromIds(sourceSpanIds: string[], sourceNodeIds: string[]): SourceProvenance | undefined {
  if (sourceSpanIds.length === 0) return undefined;
  return {
    sourceSpanIds,
    ...(sourceNodeIds[0] ? { documentNodeId: sourceNodeIds[0] } : {}),
  };
}

function combinedProvenance(
  ...values: Array<{ sourceSpanIds: string[]; sourceNodeIds: string[] } | undefined>
): SourceProvenance | undefined {
  const sourceSpanIds = [...new Set(values.flatMap((value) => value?.sourceSpanIds ?? []))];
  const sourceNodeIds = [...new Set(values.flatMap((value) => value?.sourceNodeIds ?? []))];
  return provenanceFromIds(sourceSpanIds, sourceNodeIds);
}

function firstOperationalParty(
  profile: PolicyOperationalProfile,
  roles: readonly string[],
): OperationalParty | undefined {
  const candidates = roles.flatMap((role) =>
    profile.parties.filter((candidate) => candidate.role === role && candidate.name.trim()),
  );
  return candidates.find((candidate) => candidate.address) ?? candidates[0];
}

function completeOperationalAddress(address: OperationalAddress | undefined) {
  if (!address?.street1 || !address.city || !address.state || !address.zip) return undefined;
  return {
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
  };
}

function sourceBackedAddressFromParty(party: OperationalParty | undefined) {
  const address = completeOperationalAddress(party?.address);
  const provenance = party ? provenanceFromIds(party.sourceSpanIds, party.sourceNodeIds) : undefined;
  return address && provenance ? { ...address, ...provenance } : undefined;
}

function declarationFactsByField(
  profile: PolicyOperationalProfile,
  field: OperationalDeclarationFact["field"],
): OperationalDeclarationFact[] {
  return profile.declarationFacts.filter((fact) => fact.field === field && fact.value.trim());
}

function firstDeclarationFact(
  profile: PolicyOperationalProfile,
  field: OperationalDeclarationFact["field"],
): OperationalDeclarationFact | undefined {
  return declarationFactsByField(profile, field)[0];
}

function sourceBackedAddressFromFact(fact: OperationalDeclarationFact | undefined) {
  if (!fact?.address || fact.sourceSpanIds.length === 0) return undefined;
  const address = fact.address;
  if (!address.street1 || !address.city || !address.state || !address.zip) return undefined;
  return {
    street1: address.street1,
    street2: address.street2,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    ...provenanceFromIds(fact.sourceSpanIds, fact.sourceNodeIds),
  };
}

function normalizedEntityType(value: string | undefined) {
  const normalized = cleanText(value, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (normalized === "inc" || normalized === "incorporated" || normalized === "c_corporation" || normalized === "s_corporation") {
    return "corporation";
  }
  if (normalized === "limited_liability_company") return "llc";
  if (normalized === "non_profit") return "nonprofit";
  return [
    "corporation",
    "llc",
    "partnership",
    "sole_proprietor",
    "joint_venture",
    "trust",
    "nonprofit",
    "municipality",
    "individual",
    "married_couple",
    "other",
  ].includes(normalized) ? normalized : undefined;
}

function declarationFieldName(fact: OperationalDeclarationFact): string {
  if (fact.field === "mailingAddress") return "mailingAddress";
  if (fact.field === "taxId") return "fein";
  if (fact.field === "additionalNamedInsured") return "additionalNamedInsured";
  return fact.field;
}

function scheduleValueMap(
  item: NonNullable<PolicyOperationalProfile["coverageSchedules"]>[number]["items"][number],
) {
  return new Map(item.values.map((value) => [
    value.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    value.value,
  ]));
}

function firstScheduleValue(values: Map<string, string>, labels: string[]) {
  for (const label of labels) {
    const direct = values.get(label);
    if (direct) return direct;
    const match = [...values.entries()].find(([key]) => key.includes(label));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value?.match(/\d+/)?.[0] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function structuredVehicles(profile: PolicyOperationalProfile) {
  return (profile.coverageSchedules ?? [])
    .filter((schedule) => schedule.kind === "vehicle")
    .flatMap((schedule) => schedule.items)
    .flatMap((item, index) => {
      const values = scheduleValueMap(item);
      const year = positiveInteger(firstScheduleValue(values, ["year", "model year"]));
      const make = firstScheduleValue(values, ["make"]);
      const model = firstScheduleValue(values, ["model"]);
      const vin = firstScheduleValue(values, ["vin", "vehicle identification number"]);
      if (!year || !make || !model || !vin) return [];
      return [{
        number: positiveInteger(item.label) ?? index + 1,
        year,
        make,
        model,
        vin,
      }];
    });
}

function structuredLocations(profile: PolicyOperationalProfile) {
  return (profile.coverageSchedules ?? [])
    .filter((schedule) => schedule.kind === "location" || schedule.kind === "property")
    .flatMap((schedule) => schedule.items)
    .flatMap((item, index) => {
      const values = scheduleValueMap(item);
      const street1 = firstScheduleValue(values, ["street 1", "street address", "address"]);
      const city = firstScheduleValue(values, ["city"]);
      const state = firstScheduleValue(values, ["state", "province"]);
      const zip = firstScheduleValue(values, ["zip", "postal code"]);
      if (!street1 || !city || !state || !zip) return [];
      return [{
        number: positiveInteger(item.label) ?? index + 1,
        address: {
          street1,
          city,
          state,
          zip,
          country: firstScheduleValue(values, ["country"]),
        },
        description: item.description,
        buildingValue: firstScheduleValue(values, ["building value", "building"]),
        contentsValue: firstScheduleValue(values, ["contents value", "contents"]),
      }];
    });
}

function materializeDocument(params: {
  id: string;
  sourceTree: DocumentSourceNode[];
  formInventory: SourceTreeFormHint[];
  operationalProfile: PolicyOperationalProfile;
}): InsuranceDocument {
  const profile = params.operationalProfile;
  const policyNumber = valueOf(profile, "policyNumber") ?? "Unknown";
  const namedInsuredParty = firstOperationalParty(profile, ["named_insured"]);
  const insurerParty = firstOperationalParty(profile, ["insurer", "carrier"]);
  const producerParty = firstOperationalParty(profile, ["producer", "broker"]);
  const insuredName = valueOf(profile, "namedInsured") ?? namedInsuredParty?.name ?? "Unknown";
  const carrier = valueOf(profile, "insurer") ?? insurerParty?.name ?? "Unknown";
  const effectiveDate = valueOf(profile, "effectiveDate") ?? "Unknown";
  const expirationDate = valueOf(profile, "expirationDate") ?? "Unknown";
  const premium = valueOf(profile, "premium");
  const insurerProvenance = combinedProvenance(profile.insurer, insurerParty);
  const insurerAddress = completeOperationalAddress(insurerParty?.address);
  const broker = valueOf(profile, "broker") ?? producerParty?.name;
  const brokerProvenance = combinedProvenance(profile.broker, producerParty);
  const producerAddress = completeOperationalAddress(producerParty?.address);
  const mailingAddressFact = firstDeclarationFact(profile, "mailingAddress");
  const insuredAddress = sourceBackedAddressFromParty(namedInsuredParty) ?? sourceBackedAddressFromFact(mailingAddressFact);
  const insuredDba = firstDeclarationFact(profile, "dba")?.value;
  const insuredEntityType = normalizedEntityType(firstDeclarationFact(profile, "entityType")?.value);
  const insuredFein = firstDeclarationFact(profile, "taxId")?.value;
  const additionalNamedInsureds = declarationFactsByField(profile, "additionalNamedInsured")
    .flatMap((fact) => {
      const provenance = provenanceFromIds(fact.sourceSpanIds, fact.sourceNodeIds);
      return provenance ? [{ name: fact.value, ...provenance }] : [];
    });
  const coverages = profile.coverages.map((coverage) => ({
    name: coverage.name,
    lineOfBusiness: coverage.lineOfBusiness,
    coverageCode: coverage.coverageCode,
    limit: coverage.limit,
    deductible: coverage.deductible,
    premium: coverage.premium,
    retroactiveDate: coverage.retroactiveDate,
    formNumber: coverage.formNumber,
    sectionRef: coverage.sectionRef,
    endorsementNumber: coverage.endorsementNumber,
    limits: coverage.limits,
    sourceSpanIds: coverage.sourceSpanIds,
    documentNodeId: coverage.sourceNodeIds[0],
    originalContent: [
      coverage.name,
      ...(coverage.limits?.length
        ? coverage.limits.map((term) => `${term.label}: ${term.value}`)
        : [coverage.limit, coverage.deductible, coverage.premium]),
    ].filter(Boolean).join(" | "),
  }));
  const coverageSchedules = (profile.coverageSchedules ?? []).map((schedule) => ({
    ...schedule,
    items: schedule.items.map((item) => ({ ...item })),
  }));
  const premiumBreakdown = (profile.premiumBreakdown ?? []).map((row) => ({
    line: row.line,
    amount: row.amount,
    amountValue: row.amountValue,
    documentNodeId: row.sourceNodeIds[0],
    sourceSpanIds: row.sourceSpanIds,
  }));
  const taxesAndFees = (profile.taxesAndFees ?? []).map((row) => ({
    name: row.name,
    amount: row.amount,
    amountValue: row.amountValue,
    type: row.type,
    description: row.description,
    documentNodeId: row.sourceNodeIds[0],
    sourceSpanIds: row.sourceSpanIds,
  }));
  const totalCost = valueOf(profile, "totalCost");
  const totalCostAmount = totalCost
    ? Number(totalCost.replace(/[^0-9.-]/g, ""))
    : undefined;
  const vehicles = structuredVehicles(profile);
  const locations = structuredLocations(profile);
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
    profile.linesOfBusiness.length ? `covering ${profile.linesOfBusiness.slice(0, 5).join(", ")}` : undefined,
  ].filter(Boolean).join(" ");

  const base = {
    id: params.id,
    type: profile.documentType,
    carrier,
    security: carrier,
    insuredName,
    premium,
    ...(premiumBreakdown.length > 0 ? { premiumBreakdown } : {}),
    ...(taxesAndFees.length > 0 ? { taxesAndFees } : {}),
    ...(totalCost ? { totalCost } : {}),
    ...(typeof totalCostAmount === "number" && Number.isFinite(totalCostAmount)
      ? { totalCostAmount }
      : {}),
    insuredDba,
    insuredAddress,
    insuredEntityType,
    insuredFein,
    ...(additionalNamedInsureds.length > 0 ? { additionalNamedInsureds } : {}),
    ...(insurerProvenance
      ? {
          insurer: {
            legalName: carrier,
            ...(insurerAddress ? { address: insurerAddress } : {}),
            ...insurerProvenance,
          },
        }
      : {}),
    ...(broker && brokerProvenance
      ? {
          brokerAgency: broker,
          producer: {
            agencyName: broker,
            ...(producerAddress ? { address: producerAddress } : {}),
            ...brokerProvenance,
          },
        }
      : {}),
    linesOfBusiness: profile.linesOfBusiness,
    formInventory: params.formInventory
      .filter((form): form is SourceTreeFormHint & { formNumber: string } => typeof form.formNumber === "string" && form.formNumber.trim().length > 0)
      .map((form) => ({
        formNumber: form.formNumber,
        editionDate: form.editionDate,
        title: form.title,
        formType: form.formType,
        pageStart: form.pageStart,
        pageEnd: form.pageEnd,
      })),
    coverages,
    ...(coverageSchedules.length > 0 ? { coverageSchedules } : {}),
    ...(vehicles.length > 0 ? { vehicles } : {}),
    ...(locations.length > 0 ? { locations } : {}),
    documentMetadata,
    documentOutline,
    declarations: {
      fields: [
        profile.policyNumber ? { field: "policyNumber", value: profile.policyNumber.value, sourceSpanIds: profile.policyNumber.sourceSpanIds } : undefined,
        profile.namedInsured ? { field: "namedInsured", value: profile.namedInsured.value, sourceSpanIds: profile.namedInsured.sourceSpanIds } : undefined,
        profile.insurer ? { field: "insurer", value: profile.insurer.value, sourceSpanIds: profile.insurer.sourceSpanIds } : undefined,
        profile.effectiveDate ? { field: "policyPeriodStart", value: profile.effectiveDate.value, sourceSpanIds: profile.effectiveDate.sourceSpanIds } : undefined,
        profile.expirationDate ? { field: "policyPeriodEnd", value: profile.expirationDate.value, sourceSpanIds: profile.expirationDate.sourceSpanIds } : undefined,
        ...profile.declarationFacts.map((fact) => ({
          field: declarationFieldName(fact),
          value: fact.value,
          sourceSpanIds: fact.sourceSpanIds,
        })),
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

type CoverageCleanupGroup = {
  id: "all";
  label: string;
};

function coverageCleanupGroups(profile: PolicyOperationalProfile): CoverageCleanupGroup[] {
  return profile.coverages.length
    ? [{ id: "all", label: "Coverage schedule cleanup" }]
    : [];
}

async function cleanupOperationalCoverageSchedules(params: {
  sourceTree: DocumentSourceNode[];
  sourceSpans: SourceSpan[];
  operationalProfile: PolicyOperationalProfile;
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  resolveBudget: (taskKind: ModelTaskKind, hintTokens: number) => ModelBudgetResolution;
  trackUsage: TrackUsage;
  log?: (message: string) => Promise<void>;
}): Promise<{ operationalProfile: PolicyOperationalProfile; warnings: string[] }> {
  const groups = coverageCleanupGroups(params.operationalProfile);
  const validNodeIds = new Set(params.sourceTree.map((node) => node.id));
  const validSpanIds = new Set(params.sourceSpans.map((span) => span.id));
  const results = await Promise.all(groups.map(async (group, groupIndex) => {
    const budget = params.resolveBudget("extraction_coverage_cleanup", 4096);
    const startedAt = Date.now();
    const response = await safeGenerateObject(
      params.generateObject,
      {
        prompt: buildOperationalProfileCleanupPrompt(
          params.sourceTree,
          params.operationalProfile,
          { label: group.label },
        ),
        schema: OperationalProfileCleanupSchema,
        maxTokens: budget.maxTokens,
        taskKind: "extraction_coverage_cleanup",
        budgetDiagnostics: budget,
        providerOptions: params.providerOptions,
        trace: {
          phase: "coverage_cleanup",
          label: group.label,
          itemCount: params.operationalProfile.coverages.length,
          coverageGroup: group.id,
          batchIndex: groups.length > 1 ? groupIndex + 1 : undefined,
          batchCount: groups.length > 1 ? groups.length : undefined,
          sourceBacked: true,
        },
      },
      {
        fallback: { coverageDecisions: [], warnings: [] },
        maxRetries: 0,
        log: params.log,
        retry: false,
      },
    );
    params.trackUsage(response.usage, {
      taskKind: "extraction_coverage_cleanup",
      label: group.id === "all" ? "coverage_cleanup" : `coverage_cleanup_${group.id}`,
      maxTokens: budget.maxTokens,
      durationMs: Date.now() - startedAt,
    });
    return response.object as OperationalProfileCleanup;
  }));

  const cleanup = {
    coverageDecisions: results.flatMap((result) => result.coverageDecisions ?? []),
    warnings: results.flatMap((result) => result.warnings ?? []),
  };
  return {
    operationalProfile: applyOperationalProfileCleanup(
      params.operationalProfile,
      cleanup,
      validNodeIds,
      validSpanIds,
    ),
    warnings: cleanup.warnings,
  };
}

export async function runSourceTreeExtraction(params: {
  id: string;
  sourceSpans: SourceSpan[];
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  resolveBudget: (taskKind: ModelTaskKind, hintTokens: number) => ModelBudgetResolution;
  trackUsage: TrackUsage;
  log?: (message: string) => Promise<void>;
  coverageRecovery?: { enabled: boolean };
}): Promise<ExtractionV3Result> {
  const sourceSpans = normalizeSourceSpans(params.sourceSpans);
  const formHints: SourceTreeFormHint[] = [];
  let sourceTree = applySemanticPageGrouping(buildDocumentSourceTree(sourceSpans, params.id));
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

  const emptyProfile = emptyOperationalProfile();
  let operationalProfile = emptyProfile;
  let coverageRecovery = disabledCoverageRecoveryDiagnostics();
  try {
    const validNodeIds = new Set(sourceTree.map((node) => node.id));
    const validSpanIds = new Set(sourceSpans.map((span) => span.id));
    const budget = params.resolveBudget("extraction_operational_profile", 8192);
    const startedAt = Date.now();
    const response = await safeGenerateObject(
      params.generateObject,
      {
        prompt: buildOperationalProfilePrompt(sourceTree, sourceSpans),
        schema: OperationalProfilePromptSchema,
        maxTokens: budget.maxTokens,
        taskKind: "extraction_operational_profile",
        budgetDiagnostics: budget,
        providerOptions: params.providerOptions,
      },
      {
        fallback: emptyProfile,
        maxRetries: 0,
        log: params.log,
        retry: false,
      },
    );
    localTrack(response.usage, {
      taskKind: "extraction_operational_profile",
      label: "operational_profile",
      maxTokens: budget.maxTokens,
      durationMs: Date.now() - startedAt,
    });
    operationalProfile = mergeOperationalProfile(
      emptyProfile,
      response.object as Partial<PolicyOperationalProfile>,
      validNodeIds,
      validSpanIds,
    );
  } catch (error) {
    warnings.push(`Operational profile model pass failed; coverage rows omitted (${error instanceof Error ? error.message : String(error)})`);
  }

  if (params.coverageRecovery?.enabled) {
    const recovery = await recoverOperationalProfileCoverage({
      sourceTree,
      sourceSpans,
      operationalProfile,
      generateObject: params.generateObject,
      providerOptions: params.providerOptions,
      resolveBudget: params.resolveBudget,
      trackUsage: localTrack,
      log: params.log,
    });
    operationalProfile = recovery.operationalProfile;
    coverageRecovery = recovery.diagnostics;
    warnings.push(...coverageRecovery.warnings);
  }

  if (operationalProfile.coverages.length > 0) {
    try {
      const cleanup = await cleanupOperationalCoverageSchedules({
        sourceTree,
        sourceSpans,
        operationalProfile,
        generateObject: params.generateObject,
        providerOptions: params.providerOptions,
        resolveBudget: params.resolveBudget,
        trackUsage: localTrack,
        log: params.log,
      });
      operationalProfile = cleanup.operationalProfile;
      warnings.push(...cleanup.warnings);
    } catch (error) {
      warnings.push(`Operational profile cleanup pass failed; uncleaned profile used (${error instanceof Error ? error.message : String(error)})`);
    }
  } else {
    await params.log?.("Operational profile has no coverage rows; skipped model cleanup");
  }

  const document = materializeDocument({
    id: params.id,
    sourceTree,
    formInventory: formHints,
    operationalProfile,
  });

  return {
    sourceTree,
    sourceSpans,
    sourceChunks: chunkSourceSpans(sourceSpans),
    formInventory: formHints,
    operationalProfile,
    coverageRecovery,
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
