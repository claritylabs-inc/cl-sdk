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
} from "../source";

const ORGANIZABLE_KINDS = [
  "page_group",
  "form",
  "endorsement",
  "section",
  "schedule",
  "clause",
] as const;

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

function cleanText(value: string | undefined, fallback: string): string {
  const text = value?.replace(/\s+/g, " ").trim();
  return text || fallback;
}

function compactNode(node: DocumentSourceNode) {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    path: node.path,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    sourceSpanIds: node.sourceSpanIds.slice(0, 8),
    text: (node.textExcerpt ?? node.description).slice(0, 700),
  };
}

function buildOrganizationPrompt(sourceTree: DocumentSourceNode[]): string {
  const nodes = sourceTree
    .filter((node) => node.kind !== "document")
    .slice(0, 240)
    .map(compactNode);
  return `You organize an insurance document source tree.

Rules:
- Use only node IDs from the provided list.
- Do not invent text, page numbers, source spans, limits, or policy facts.
- You may relabel existing nodes and group adjacent top-level/page nodes when they are clearly one form, endorsement, declarations set, schedule, or clause family.
- Add concise, human-readable titles to generic text, table, row, and cell nodes when the text makes their role clear.
- Groups must list existing childNodeIds only.
- Keep descriptions short and useful for search.

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

function applyOrganization(sourceTree: DocumentSourceNode[], organization: z.infer<typeof SourceTreeOrganizationSchema>): DocumentSourceNode[] {
  const byId = new Map(sourceTree.map((node) => [node.id, node]));
  let nextTree = sourceTree.map((node) => {
    const label = organization.labels.find((item) => item.nodeId === node.id);
    if (!label) return node;
    return {
      ...node,
      kind: label.kind ?? node.kind,
      title: cleanText(label.title, node.title),
      description: cleanText(label.description, node.description),
    };
  });

  for (const group of organization.groups.slice(0, 40)) {
    const children = group.childNodeIds
      .map((id) => byId.get(id))
      .filter((node): node is DocumentSourceNode => Boolean(node));
    if (children.length === 0) continue;
    const parentId = children[0].parentId;
    if (!children.every((child) => child.parentId === parentId)) continue;
    const documentId = children[0].documentId;
    const id = groupNodeId(documentId, group);
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
      title: group.title,
      description: group.description ?? group.title,
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

  return normalizeDocumentSourceTreePaths(nextTree);
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
  let sourceTree = buildDocumentSourceTree(params.sourceSpans, params.id);
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
    const budget = params.resolveBudget("extraction_source_tree", 4096);
    const startedAt = Date.now();
    const response = await safeGenerateObject(
      params.generateObject,
      {
        prompt: buildOrganizationPrompt(sourceTree),
        schema: SourceTreeOrganizationSchema,
        maxTokens: budget.maxTokens,
        taskKind: "extraction_source_tree",
        budgetDiagnostics: budget,
        providerOptions: { ...params.providerOptions, sourceSpans: params.sourceSpans },
      },
      {
        fallback: { labels: [], groups: [] },
        log: params.log,
      },
    );
    localTrack(response.usage, {
      taskKind: "extraction_source_tree",
      label: "source_tree_organizer",
      maxTokens: budget.maxTokens,
      durationMs: Date.now() - startedAt,
    });
    sourceTree = applyOrganization(sourceTree, response.object as z.infer<typeof SourceTreeOrganizationSchema>);
  } catch (error) {
    warnings.push(`Source-tree organizer failed; deterministic tree used (${error instanceof Error ? error.message : String(error)})`);
  }

  const deterministicProfile = buildDeterministicOperationalProfile({
    sourceTree,
    sourceSpans: params.sourceSpans,
  });
  let operationalProfile = deterministicProfile;
  try {
    const validNodeIds = new Set(sourceTree.map((node) => node.id));
    const validSpanIds = new Set(params.sourceSpans.map((span) => span.id));
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
        providerOptions: { ...params.providerOptions, sourceSpans: params.sourceSpans, sourceTree },
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
    sourceSpans: params.sourceSpans,
    sourceChunks: chunkSourceSpans(params.sourceSpans),
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
