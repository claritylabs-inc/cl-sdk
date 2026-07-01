import { z } from "zod";
import type { GenerateObject, PerformanceReport, TokenUsage } from "../core/types";
import type { ModelBudgetResolution, ModelTaskKind } from "../core/model-budget";
import { safeGenerateObject } from "../core/safe-generate";
import type { InsuranceDocument } from "../schemas/document";
import type { SourceProvenance } from "../schemas/shared";
import type {
  DocumentSourceNode,
  DocumentSourceNodeKind,
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
import type { FormInventoryResult } from "../prompts/coordinator/form-inventory";
import {
  applyOperationalProfileCleanup,
  buildOperationalProfileCleanupPrompt,
  OperationalCoverageTermKindSchema,
  OperationalProfileCleanupSchema,
  type OperationalProfileCleanup,
} from "./operational-profile-cleanup";

const ORGANIZABLE_KINDS = [
  "page_group",
  "form",
  "endorsement",
  "section",
  "schedule",
  "clause",
] as const;

const ORGANIZATION_TOP_LEVEL_BATCH_SIZE = 80;
const ORGANIZER_MAX_SOURCE_SPANS = 400;
const ORGANIZER_MAX_TOP_LEVEL_NODES = 18;
const OUTLINE_CLEANUP_MAX_TOP_LEVEL_NODES = 80;

export type SourceTreeFormHint = {
  formNumber?: string;
  editionDate?: string;
  title?: string;
  formType: "coverage" | "endorsement" | "declarations" | "application" | "notice" | "other";
  pageStart?: number;
  pageEnd?: number;
};

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

const SourceTreeVisualTableRepairSchema = z.object({
  tables: z.array(z.object({
    tableNodeId: z.string(),
    columnLabels: z.array(z.object({
      columnIndex: z.number().int().nonnegative(),
      label: z.string(),
    })).default([]),
    continuationRows: z.array(z.object({
      sourceRowNodeId: z.string(),
      targetRowNodeId: z.string(),
      targetColumnIndex: z.number().int().nonnegative().optional(),
      targetColumnLabel: z.string().optional(),
      reason: z.string().optional(),
    })).default([]),
  })).default([]),
  warnings: z.array(z.string()).default([]),
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
    retroactiveDate: z.string().optional(),
    formNumber: z.string().optional(),
    sectionRef: z.string().optional(),
    coverageOrigin: z.enum(["core", "endorsement"]).optional(),
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

type SourceTreeOrganization = z.infer<typeof SourceTreeOrganizationSchema>;
type SourceTreeVisualTableRepair = z.infer<typeof SourceTreeVisualTableRepairSchema>;
type VisualTableContinuationRepair = SourceTreeVisualTableRepair["tables"][number]["continuationRows"][number];
type OrganizationBatch = {
  label: string;
  topLevelNodeIds: string[];
  nodes: DocumentSourceNode[];
};
type VisualTableCandidate = {
  table: DocumentSourceNode;
  page: number;
  rows: Array<{
    row: DocumentSourceNode;
    cells: DocumentSourceNode[];
  }>;
};

function formatFormHintsForPrompt(forms: SourceTreeFormHint[]): string {
  const usable = forms
    .filter((form) => typeof form.pageStart === "number" && typeof form.pageEnd === "number")
    .slice(0, 120)
    .map((form) => ({
      title: form.title,
      formType: form.formType,
      formNumber: form.formNumber,
      editionDate: form.editionDate,
      pageStart: form.pageStart,
      pageEnd: form.pageEnd,
    }));
  return usable.length ? JSON.stringify(usable, null, 2) : "[]";
}

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

function formNumberFromText(value: string): string | undefined {
  return cleanText(value, "")
    .match(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\s+\d{2}\s+\d{2}\b/)?.[0]
    ?.replace(/\s+/g, " ");
}

function editionDateFromFormNumber(formNumber: string | undefined): string | undefined {
  const match = formNumber?.match(/\b(\d{2})\s+(\d{2})$/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function pageTitleFromText(text: string, fallback: string): string {
  const normalized = cleanText(text, fallback);
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
    const match = normalized.match(pattern)?.[0];
    if (match) return cleanText(match, fallback);
  }
  const endorsement = normalized.match(/\bENDORSEMENT\s+(?:NO\.?|NUMBER|#)\s*[A-Z0-9][A-Z0-9.-]*\b/i)?.[0];
  if (endorsement) return cleanText(endorsement, fallback);
  const firstSentence = normalized.split(/(?<=\.)\s+/)[0];
  if (/^page\s+\d+\b/i.test(firstSentence)) return fallback;
  if (firstSentence && firstSentence.length <= 120) return firstSentence.replace(/[.]$/, "");
  return fallback;
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

function pageFormTypeFromText(text: string): SourceTreeFormHint["formType"] {
  if (/\b(declarations?\s+page|declarations?\s+schedule)\b/i.test(text)) return "declarations";
  if (/\b(endorsement\s+(?:no\.?|number|#)|this endorsement changes the policy|[A-Z]{2,}-END\s+\d{2,})\b/i.test(text)) return "endorsement";
  if (/\b(technology errors?\s*&?\s*omissions.*liability insurance policy|policy form|coverage form|insuring agreement|definitions?|exclusions?|conditions?)\b/i.test(text)) return "coverage";
  if (/\b(important notice|privacy notice|ofac advisory|terrorism risk insurance act|tria|trade or economic sanctions)\b/i.test(text)) return "notice";
  return "other";
}

function administrativeFormTypeFromText(text: string): SourceTreeFormHint["formType"] | undefined {
  if (/\b(important notice|privacy notice|ofac advisory|terrorism risk insurance act|tria|trade or economic sanctions|economic sanctions limitation|how to report a claim)\b/i.test(text)) {
    return "notice";
  }
  if (/\b(specimen policy|policy jacket|countersigned|countersignature|licensed resident agent|corporate secretary|president and ceo|application of insurance executed)\b/i.test(text)) {
    return "other";
  }
  return undefined;
}

function pageTextByNumber(sourceSpans: SourceSpan[]): Map<number, string> {
  const pageTexts = new Map<number, string>();
  const pageSpanTexts = new Map<number, string>();
  for (const span of sourceSpans) {
    const start = spanPageStart(span);
    if (typeof start !== "number") continue;
    const end = spanPageEnd(span) ?? start;
    for (let page = start; page <= end; page += 1) {
      if (spanSourceUnit(span) === "page") {
        pageSpanTexts.set(page, cleanText(span.text, ""));
        continue;
      }
      const existing = pageTexts.get(page) ?? "";
      if (existing.length < 4000) pageTexts.set(page, cleanText([existing, span.text].filter(Boolean).join(" "), ""));
    }
  }
  return new Map([...new Set([...pageTexts.keys(), ...pageSpanTexts.keys()])].map((page) => [
    page,
    pageSpanTexts.get(page) ?? pageTexts.get(page) ?? "",
  ]));
}

function reconcileFormTypeWithSourceText(
  form: SourceTreeFormHint,
  pageTexts: Map<number, string>,
): SourceTreeFormHint["formType"] {
  const pages: string[] = [];
  const start = form.pageStart;
  const end = form.pageEnd ?? start;
  if (typeof start === "number" && typeof end === "number") {
    for (let page = start; page <= end; page += 1) pages.push(pageTexts.get(page) ?? "");
  }
  const text = cleanText([form.title, form.formNumber, ...pages].filter(Boolean).join(" "), "");
  const administrativeType = administrativeFormTypeFromText(text);
  if (administrativeType && form.formType !== administrativeType) return administrativeType;
  return form.formType;
}

function inferFormHintsFromSourceSpans(sourceSpans: SourceSpan[]): SourceTreeFormHint[] {
  const pageTexts = pageTextByNumber(sourceSpans);
  if (pageTexts.size === 0) return [];

  const pageHints = [...pageTexts.keys()]
    .sort((left, right) => left - right)
    .map((page): SourceTreeFormHint => {
      const text = pageTexts.get(page) ?? "";
      const formNumber = formNumberFromText(text);
      return {
        formNumber,
        editionDate: editionDateFromFormNumber(formNumber),
        title: pageTitleFromText(text, `Page ${page}`),
        formType: pageFormTypeFromText(text),
        pageStart: page,
        pageEnd: page,
      };
    });

  const merged: SourceTreeFormHint[] = [];
  for (const hint of pageHints) {
    const previous = merged[merged.length - 1];
    const startsNewEndorsement =
      hint.formType === "endorsement" &&
      /\bendorsement\s+(?:no\.?|number|#)\s*[A-Z0-9]|this endorsement changes the policy/i.test(hint.title ?? "");
    const canMerge =
      previous &&
      previous.formType === hint.formType &&
      previous.pageEnd !== undefined &&
      hint.pageStart === previous.pageEnd + 1 &&
      (hint.formType === "declarations" ||
        hint.formType === "coverage" ||
        (hint.formType === "endorsement" && !startsNewEndorsement));

    if (!canMerge) {
      merged.push(hint);
      continue;
    }

    previous.pageEnd = hint.pageEnd;
    previous.title = previous.title ?? hint.title;
    previous.formNumber = previous.formNumber ?? hint.formNumber;
    previous.editionDate = previous.editionDate ?? hint.editionDate;
  }

  return merged;
}

function normalizeFormHints(forms: SourceTreeFormHint[] | undefined, sourceSpans: SourceSpan[]): SourceTreeFormHint[] {
  const pageTexts = pageTextByNumber(sourceSpans);
  const provided = (forms ?? [])
    .filter((form) =>
      typeof form.pageStart === "number" &&
      typeof form.pageEnd === "number" &&
      form.pageStart > 0 &&
      form.pageEnd >= form.pageStart
    )
    .map((form) => ({
      ...form,
      formType: reconcileFormTypeWithSourceText(form, pageTexts),
      title: form.title ? cleanText(form.title, "") : undefined,
    }))
    .sort((left, right) =>
      (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER) ||
      (left.pageEnd ?? Number.MAX_SAFE_INTEGER) - (right.pageEnd ?? Number.MAX_SAFE_INTEGER)
    );
  return provided.length ? provided : inferFormHintsFromSourceSpans(sourceSpans);
}

function formHintForPage(forms: SourceTreeFormHint[], page: number): SourceTreeFormHint | undefined {
  return forms.find((form) =>
    typeof form.pageStart === "number" &&
    typeof form.pageEnd === "number" &&
    page >= form.pageStart &&
    page <= form.pageEnd
  );
}

function titleFromFormHint(form: SourceTreeFormHint, fallback: string): string {
  if (form.formType === "declarations") return "Declarations";
  if (form.formType === "coverage") return "Policy Form";
  if (form.formType === "endorsement") return endorsementTitle([form.title, form.formNumber].filter(Boolean).join(" ")) ?? cleanText(form.title, fallback);
  return cleanText(form.title, fallback);
}

function formGroupConfig(form: SourceTreeFormHint): {
  kind: DocumentSourceNodeKind;
  title: string;
  description: string;
  organizer: string;
} | undefined {
  if (form.formType === "declarations") {
    return {
      kind: "page_group",
      title: "Declarations",
      description: "Declarations pages and schedules grouped from form inventory",
      organizer: "form_inventory_declarations_grouping",
    };
  }
  if (form.formType === "coverage") {
    return {
      kind: "form",
      title: "Policy Form",
      description: "Policy form pages grouped from form inventory",
      organizer: "form_inventory_policy_form_grouping",
    };
  }
  if (form.formType === "endorsement") {
    const title = titleFromFormHint(form, "Endorsement");
    return {
      kind: "endorsement",
      title,
      description: `${title} grouped from form inventory`,
      organizer: "form_inventory_endorsement_grouping",
    };
  }
  return undefined;
}

function applyFormInventoryHints(sourceTree: DocumentSourceNode[], forms: SourceTreeFormHint[]): DocumentSourceNode[] {
  if (forms.length === 0) return sourceTree;
  const rootId = sourceTreeRootId(sourceTree);
  if (!rootId) return sourceTree;
  const byParent = nodesByParent(sourceTree);
  const children = (byParent.get(rootId) ?? [])
    .filter((node) => node.kind !== "document")
    .sort((left, right) => left.order - right.order);
  const rootPages = children.filter((node) => node.kind === "page" && typeof node.pageStart === "number");

  let nextTree = sourceTree.map((node) => {
    if (node.kind !== "page" || typeof node.pageStart !== "number") return node;
    const form = formHintForPage(forms, node.pageStart);
    if (!form) return node;
    const isStartPage = form.pageStart === node.pageStart;
    const shouldRetitle = isStartPage && form.formType !== "other";
    return {
      ...node,
      title: shouldRetitle ? titleFromFormHint(form, node.title) : node.title,
      metadata: {
        ...node.metadata,
        formInventoryHint: {
          formType: form.formType,
          formNumber: form.formNumber,
          title: form.title,
          pageStart: form.pageStart,
          pageEnd: form.pageEnd,
        },
      },
    };
  });

  const claimed = new Set<string>();
  for (const form of forms) {
    const config = formGroupConfig(form);
    const pageStart = form.pageStart;
    const pageEnd = form.pageEnd;
    if (!config || typeof pageStart !== "number" || typeof pageEnd !== "number") continue;
    const childIds = rootPages
      .filter((page) =>
        !claimed.has(page.id) &&
        typeof page.pageStart === "number" &&
        page.pageStart >= pageStart &&
        page.pageStart <= pageEnd
      )
      .map((page) => page.id);
    if (childIds.length === 0) continue;
    nextTree = groupAdjacentChildren({
      sourceTree: nextTree,
      children,
      childIds,
      kind: config.kind,
      title: config.title,
      description: config.description,
      organizer: config.organizer,
    });
    childIds.forEach((id) => claimed.add(id));
  }

  return normalizeDocumentSourceTreePaths(nextTree);
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
    /\b(item\s+\d+\.|coverage part|each claim limit|aggregate limit|retroactive date|self-insured retention|premium|payment plan|producer|broker|forms? and endorsements?|extended reporting period|discovery period)\b/i.test(text);
}

function looksLikePolicyFormStart(node: DocumentSourceNode): boolean {
  const text = sourceNodeText(node);
  const excerpt = cleanText(node.textExcerpt, "");
  if (isAdministrativeNoticeNode(node) || looksLikeDeclarationsStart(node)) return false;
  return /\bpolicy form\b/i.test(node.title) ||
    /^policy\s+form\b/i.test(excerpt) ||
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

  return normalizeSemanticHierarchy(nextTree);
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

function rootChildren(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const byParent = nodesByParent(sourceTree);
  const rootId = sourceTreeRootId(sourceTree);
  return (byParent.get(rootId) ?? []).filter((node) => node.kind !== "document");
}

function hasDeterministicSemanticOutline(sourceTree: DocumentSourceNode[]): boolean {
  const children = rootChildren(sourceTree);
  const semanticCount = children.filter((node) =>
    node.kind === "page_group" || node.kind === "form" || node.kind === "endorsement" || node.kind === "section" || node.kind === "schedule"
  ).length;
  return semanticCount >= 2 ||
    children.some((node) => node.title === "Declarations") ||
    children.some((node) => node.title === "Policy Form") ||
    children.some((node) => node.title === "Endorsements");
}

function shouldRunSourceTreeOrganizer(sourceTree: DocumentSourceNode[], sourceSpans: SourceSpan[]): boolean {
  const topLevelCount = rootChildren(sourceTree).length;
  if (sourceSpans.length > ORGANIZER_MAX_SOURCE_SPANS) return false;
  if (topLevelCount > ORGANIZER_MAX_TOP_LEVEL_NODES) return false;
  return !hasDeterministicSemanticOutline(sourceTree);
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

function buildOrganizationPrompt(batch: OrganizationBatch, formHints: SourceTreeFormHint[]): string {
  const nodes = batch.nodes.map((node) => compactNode(node, node.kind === "page" ? 900 : 320));
  return `You organize an insurance document source tree.

Scope:
- ${batch.label}
- The provided list is a bounded extraction-time batch. It is not necessarily the whole document.
- Top-level page/form candidates in this batch: ${JSON.stringify(batch.topLevelNodeIds)}

Expected form inventory / page ranges:
${formatFormHintsForPrompt(formHints)}

Rules:
- Use only node IDs from the provided list.
- Do not invent text, page numbers, source spans, limits, or policy facts.
- You may relabel existing nodes and group adjacent top-level/page nodes from this batch only when they are clearly one continuous form, one declarations set, one schedule, or one clause family.
- Treat the form inventory as a page-range hint for the expected order: front matter/notices, declarations, policy form, then endorsements.
- Prefer section hierarchy from printed title elements inside a form over page-by-page grouping.
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

function shouldRunOutlineCleanup(sourceTree: DocumentSourceNode[]): boolean {
  const topLevel = rootChildren(sourceTree);
  if (topLevel.length === 0 || topLevel.length > OUTLINE_CLEANUP_MAX_TOP_LEVEL_NODES) return false;
  const genericPages = topLevel.filter((node) => node.kind === "page" && /^Page\s+\d+$/i.test(node.title));
  const hasDeclarations = topLevel.some((node) => node.title === "Declarations");
  const hasPolicyForm = topLevel.some((node) => node.title === "Policy Form");
  const hasEndorsements = topLevel.some((node) => node.title === "Endorsements");
  if (hasDeclarations && hasPolicyForm && hasEndorsements) return false;
  return genericPages.length > 0 || topLevel.length > 6 || !hasDeclarations || !hasPolicyForm || !hasEndorsements;
}

function buildOutlineCleanupPrompt(sourceTree: DocumentSourceNode[], formHints: SourceTreeFormHint[]): string {
  const topLevel = rootChildren(sourceTree).slice(0, OUTLINE_CLEANUP_MAX_TOP_LEVEL_NODES);
  const nodes = topLevel.map((node) => compactNode(node, 900));
  return `You clean a top-level source outline for an insurance policy.

Expected product-facing order:
1. Optional front matter: policy jacket, important notices, privacy notices, OFAC notices, TRIA/terrorism notices, marketing/admin pages, signatures, countersignatures, or other pages that are not the declarations, policy wording, or endorsements.
2. Declarations: declarations page(s), schedules, named insured/policy period/premium rows, coverage limit schedules, forms-and-endorsements schedules.
3. Policy Form: the main policy wording, insuring agreements, definitions, exclusions, conditions, claim provisions, and general policy terms.
4. Endorsements: one generic "Endorsements" page_group containing each separately numbered endorsement as its own child.

Expected form inventory / page ranges:
${formatFormHintsForPrompt(formHints)}

Rules:
- Use only node IDs from this top-level list: ${JSON.stringify(topLevel.map((node) => node.id))}
- Group only adjacent top-level nodes.
- Do not invent text, pages, source spans, limits, or policy facts.
- Do not merge individually numbered endorsements into one endorsement node; use the generic "Endorsements" parent for the series.
- Use canonical terse titles: "Notices and Jacket", "Declarations", "Policy Form", "Endorsements", or the printed endorsement number.
- Keep page_group descriptions short and include the page range when pages are known, for example "Declarations pages 6-8".
- If a page is an OFAC, privacy, terrorism/TRIA, claim-reporting notice, signature page, or jacket, do not label it as declarations or policy form.
- If the form inventory provides page ranges, keep groups aligned to those ranges unless the source node text clearly contradicts them.
- If the existing deterministic outline is already correct, return empty labels and groups.

Top-level source nodes:
${JSON.stringify(nodes, null, 2)}

Return JSON with labels and groups only.`;
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
      return /\b(policy\s*(number|period)|named insured|insurer|carrier|broker|producer|premium|coverage|limit|liability|deductible|retention|retroactive|aggregate|sublimit|sub-limit|endorsement)\b/i.test(text);
    })
    .slice(0, 420);
}

function emptyOperationalProfile(): PolicyOperationalProfile {
  return {
    documentType: "policy",
    policyTypes: ["other"],
    coverageTypes: [],
    coverages: [],
    parties: [],
    endorsementSupport: [],
    sourceNodeIds: [],
    sourceSpanIds: [],
    warnings: [],
  };
}

function buildOperationalProfilePrompt(sourceTree: DocumentSourceNode[]): string {
  const nodes = operationalProfilePromptNodes(sourceTree).map((node) =>
    compactNode(node, node.kind === "page" || node.kind === "endorsement" ? 900 : 700),
  );
  return `Extract a source-backed operational profile for an insurance policy or quote.

Return only high-value operational facts needed for policy lists, Q&A, compliance, and certificate generation:
- policy number, named insured, insurer/carrier/security, broker/producer, policy period, retroactive date, premium
- coverage units with their own nested limit terms, deductibles/retentions, retroactive dates, premiums, and form references
- coverage type labels

Rules:
- Every returned value must include sourceNodeIds or sourceSpanIds from the provided nodes.
- If a value is not directly supported, omit it.
- Prefer declarations, schedules, premium tables, and endorsement schedules over generic policy wording.
- For life, critical illness, disability, and long-term care policies, keep named benefit units and benefit subconditions as operational facts even when they do not have dollar limits. Examples include death benefit, disability benefit, total disability, catastrophic disability, return of premium, waiver, and conversion options. Put subcondition details in coverages[].limits with kind "other" when they belong under a broader benefit.
- Treat an endorsement as one coverage unit when it contains a schedule. Do not split an endorsement schedule into generic rows like "Aggregate Limit".
- For coverage schedules, put each claim, aggregate, sublimit, retention, deductible, and retroactive date values in coverages[].limits with labels and source IDs. Keep the legacy coverages[].limit as the primary display value only.
- Use coverageOrigin: "endorsement" for endorsement units and "core" for declarations/core policy coverage units.
- Do not copy entire policy wording into fields.
- Extract facts directly from source nodes. There is no deterministic fact baseline.

Source nodes:
${JSON.stringify(nodes, null, 2)}

Return JSON for the operational profile.`;
}

const VISUAL_TABLE_REPAIR_MAX_TABLES = 4;
const VISUAL_TABLE_REPAIR_MAX_ROWS = 28;
const VISUAL_TABLE_REPAIR_MAX_CELLS = 140;

function isSourceTreeHeaderRow(row: DocumentSourceNode): boolean {
  return row.metadata?.isHeader === true || row.metadata?.isHeader === "true";
}

function tableCellText(cell: DocumentSourceNode): string {
  return cleanText(cell.textExcerpt ?? cell.description ?? cell.title, "");
}

function tableCellValueText(cell: DocumentSourceNode): string {
  return cleanText(cell.textExcerpt ?? cell.description ?? "", "");
}

function tableRowTextFromCells(cells: DocumentSourceNode[]): string | undefined {
  const text = cells
    .map((cell) => {
      const label = cleanText(cell.title, "");
      const value = tableCellValueText(cell);
      if (!value) return label;
      if (!label || value.toLowerCase() === label.toLowerCase()) return value;
      return `${label}: ${value}`;
    })
    .filter(Boolean)
    .join(" | ");
  return text ? cleanText(text, text) : undefined;
}

function normalizeTableBoundaryDelimiters(value: string | undefined): string | undefined {
  const text = cleanText(value, "");
  if (!text) return undefined;
  const normalized = text
    .replace(/\s+\|\s+\|/g, " | ")
    .replace(/\s+\/\s+\|/g, " |")
    .replace(/\s+[|/]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalized || undefined;
}

function normalizeSourceTreeTableDisplayText(sourceTree: DocumentSourceNode[]): DocumentSourceNode[] {
  const byParent = nodesByParent(sourceTree);
  const updates = new Map<string, DocumentSourceNode>();
  const currentNode = (node: DocumentSourceNode) => updates.get(node.id) ?? node;

  for (const node of sourceTree) {
    if (node.kind !== "table_cell") continue;
    const textExcerpt = normalizeTableBoundaryDelimiters(node.textExcerpt);
    const textChanged = textExcerpt !== undefined && textExcerpt !== node.textExcerpt;
    const description = textChanged && textExcerpt
      ? normalizeTableBoundaryDelimiters([node.title, textExcerpt].filter(Boolean).join(" | "))
      : normalizeTableBoundaryDelimiters(node.description);
    if (textExcerpt === node.textExcerpt && description === node.description) continue;
    updates.set(node.id, {
      ...node,
      ...(textExcerpt !== undefined ? { textExcerpt } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }

  for (const node of sourceTree) {
    if (node.kind !== "table_row") continue;
    const cells = (byParent.get(node.id) ?? [])
      .filter((child) => child.kind === "table_cell")
      .map(currentNode)
      .sort((left, right) =>
        tableCellColumnIndex(left, 0) - tableCellColumnIndex(right, 0) ||
        left.order - right.order ||
        left.id.localeCompare(right.id),
      );
    const textExcerpt = cells.length
      ? tableRowTextFromCells(cells)
      : normalizeTableBoundaryDelimiters(node.textExcerpt);
    const textChanged = textExcerpt !== undefined && textExcerpt !== node.textExcerpt;
    const description = textChanged && textExcerpt
      ? normalizeTableBoundaryDelimiters([node.title, textExcerpt].filter(Boolean).join(" | "))
      : normalizeTableBoundaryDelimiters(node.description);
    if (textExcerpt === node.textExcerpt && description === node.description) continue;
    updates.set(node.id, {
      ...node,
      ...(textExcerpt !== undefined ? { textExcerpt } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }

  if (updates.size === 0) return sourceTree;
  return sourceTree.map((node) => updates.get(node.id) ?? node);
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

function bboxSummary(node: DocumentSourceNode): Record<string, number> | undefined {
  const box = node.bbox?.[0];
  if (!box) return undefined;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    page: box.page,
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
  };
}

function tableRowsWithCells(
  table: DocumentSourceNode,
  byParent: Map<string | undefined, DocumentSourceNode[]>,
): VisualTableCandidate["rows"] {
  return (byParent.get(table.id) ?? [])
    .filter((node) => node.kind === "table_row")
    .map((row) => ({
      row,
      cells: (byParent.get(row.id) ?? [])
        .filter((child) => child.kind === "table_cell")
        .sort((left, right) =>
          tableCellColumnIndex(left, 0) - tableCellColumnIndex(right, 0) ||
          left.order - right.order ||
          left.id.localeCompare(right.id),
        ),
    }))
    .sort((left, right) => left.row.order - right.row.order || left.row.id.localeCompare(right.row.id));
}

function primaryHeaderColumnCount(rows: VisualTableCandidate["rows"]): number {
  const header = rows.find(({ row, cells }) => isSourceTreeHeaderRow(row) && cells.length > 1);
  if (header) return header.cells.length;
  return Math.max(0, ...rows.map(({ cells }) => cells.length));
}

function visualTableRepairScore(candidate: VisualTableCandidate): number {
  const rows = candidate.rows;
  if (rows.length < 3) return 0;

  const headerCount = primaryHeaderColumnCount(rows);
  if (headerCount < 2) return 0;

  const firstHeaderIndex = rows.findIndex(({ row, cells }) => isSourceTreeHeaderRow(row) && cells.length > 1);
  const repeatedHeader = firstHeaderIndex >= 0 &&
    rows.some(({ row }, index) => index > firstHeaderIndex && isSourceTreeHeaderRow(row));
  const shortContinuation = rows.some(({ row, cells }, index) =>
    index > 0 &&
    !isSourceTreeHeaderRow(row) &&
    cells.length > 0 &&
    cells.length < headerCount &&
    !/^(?:item\s+\d+|[A-Z]\.)\b/i.test(tableCellText(cells[0])),
  );
  const genericDataLabels = rows.some(({ row, cells }) =>
    !isSourceTreeHeaderRow(row) &&
    cells.length >= 2 &&
    cells.some((cell) => isGenericColumnTitle(cell.title)),
  );
  const danglingSlash = rows.some(({ row, cells }) =>
    !isSourceTreeHeaderRow(row) &&
    /\/\s*$/.test(tableRowTextForPrompt(row, cells)),
  );

  return (
    (repeatedHeader ? 4 : 0) +
    (danglingSlash ? 3 : 0) +
    (shortContinuation ? 3 : 0) +
    (genericDataLabels ? 2 : 0)
  );
}

function visualTableCandidates(sourceTree: DocumentSourceNode[]): VisualTableCandidate[] {
  const byParent = nodesByParent(sourceTree);
  return sourceTree
    .filter((node) => node.kind === "table" && typeof node.pageStart === "number")
    .map((table) => ({
      table,
      page: table.pageStart!,
      rows: tableRowsWithCells(table, byParent),
    }))
    .map((candidate) => ({ ...candidate, repairScore: visualTableRepairScore(candidate) }))
    .filter((candidate) => candidate.repairScore > 0)
    .sort((left, right) =>
      right.repairScore - left.repairScore ||
      left.page - right.page ||
      left.table.order - right.table.order ||
      left.table.id.localeCompare(right.table.id),
    )
    .slice(0, VISUAL_TABLE_REPAIR_MAX_TABLES)
    .map(({ repairScore: _repairScore, ...candidate }) => candidate);
}

function compactVisualTableCandidate(candidate: VisualTableCandidate) {
  let cellCount = 0;
  const rows = candidate.rows.slice(0, VISUAL_TABLE_REPAIR_MAX_ROWS).map(({ row, cells }) => {
    const compactCells = cells
      .slice(0, Math.max(0, VISUAL_TABLE_REPAIR_MAX_CELLS - cellCount))
      .map((cell, index) => ({
        cellNodeId: cell.id,
        columnIndex: tableCellColumnIndex(cell, index),
        currentColumnName: cell.title,
        text: tableCellText(cell),
        bbox: bboxSummary(cell),
      }));
    cellCount += compactCells.length;
    return {
      rowNodeId: row.id,
      order: row.order,
      isHeader: isSourceTreeHeaderRow(row),
      text: tableRowTextForPrompt(row, cells),
      bbox: bboxSummary(row),
      cells: compactCells,
    };
  });

  return {
    tableNodeId: candidate.table.id,
    page: candidate.page,
    title: candidate.table.title,
    bbox: bboxSummary(candidate.table),
    rows,
  };
}

function buildVisualTableRepairPrompt(candidate: VisualTableCandidate): string {
  return `Compare a parsed insurance source table against the original page visual layout.

If a page image is attached, use it as the primary reference. If no image is available, use the bbox coordinates below as the visual layout reference.

Task:
- Identify rows that are not real standalone rows because they are visually wrapped continuation text for a nearby row.
- Identify the primary printed column labels for the table.

Rules:
- Return only high-confidence repairs.
- Use only rowNodeId/tableNodeId/cellNodeId values from the provided JSON.
- Do not invent policy facts, values, row text, source spans, or page numbers.
- continuationRows.sourceRowNodeId must be a parsed row that should be removed as a standalone row.
- continuationRows.targetRowNodeId must be the row that visually owns that wrapped text, usually the immediately previous non-header row.
- targetColumnIndex/targetColumnLabel should point to the visual column that owns the wrapped text, usually the limit/amount/value column.
- Do not mark actual data rows as continuations when they begin a new item, coverage part, endorsement, form, location, person, or premium/tax row.
- columnLabels should be the primary visual header labels, not later wrapped cell text that the parser misread as a header.

Parsed table with visual coordinates:
${JSON.stringify(compactVisualTableCandidate(candidate), null, 2)}

Return JSON with tables[].columnLabels and tables[].continuationRows. Return empty arrays if no repair is needed.`;
}

function sourceSpanIdsForNodes(nodes: DocumentSourceNode[]): string[] {
  return [...new Set(nodes.flatMap((node) => node.sourceSpanIds))];
}

function appendDistinctText(base: string | undefined, addition: string | undefined): string | undefined {
  const current = cleanText(base, "");
  const next = cleanText(addition, "");
  if (!current) return next || undefined;
  if (!next) return current;
  if (current.toLowerCase().includes(next.toLowerCase())) return current;
  const joinsWithSpace =
    /(?:[/(:;-]|,\s*)$/.test(current) ||
    /\b(?:part of|including|subject to|not in addition to)$/i.test(current) ||
    /^(?:aggregate|claim|loss|proceeding|occurrence|each\s+(?:claim|loss|proceeding|occurrence)|coverage\s+part\b)/i.test(next);
  const delimiter = joinsWithSpace ? " " : " / ";
  return cleanText(`${current}${delimiter}${next}`, current);
}

function mergedBbox(nodes: DocumentSourceNode[]): DocumentSourceNode["bbox"] {
  const boxes = nodes.flatMap((node) => node.bbox ?? []);
  return boxes.length ? boxes.slice(0, 12) : undefined;
}

function normalizedRepairLabel(value: string | undefined): string | undefined {
  const label = cleanText(value, "");
  if (!label || label.length > 80) return undefined;
  if (/^(?:source|page|row|table)$/i.test(label)) return undefined;
  return label;
}

function findCellForContinuation(params: {
  cells: DocumentSourceNode[];
  targetColumnIndex?: number;
  targetColumnLabel?: string;
}): DocumentSourceNode | undefined {
  if (typeof params.targetColumnIndex === "number") {
    const byIndex = params.cells.find((cell, index) =>
      tableCellColumnIndex(cell, index) === params.targetColumnIndex
    );
    if (byIndex) return byIndex;
  }
  const label = normalizedRepairLabel(params.targetColumnLabel);
  if (label) {
    const byLabel = params.cells.find((cell) =>
      cleanText(cell.title, "").toLowerCase() === label.toLowerCase()
    );
    if (byLabel) return byLabel;
  }
  return params.cells[1] ?? params.cells[params.cells.length - 1];
}

function bboxCenterX(node: DocumentSourceNode): number | undefined {
  const box = node.bbox?.[0];
  if (!box) return undefined;
  return box.x + box.width / 2;
}

function findCellByVisualPosition(
  sourceCell: DocumentSourceNode,
  targetCells: DocumentSourceNode[],
): DocumentSourceNode | undefined {
  const sourceX = bboxCenterX(sourceCell);
  if (sourceX === undefined) return undefined;
  const positioned = targetCells
    .map((cell) => ({ cell, centerX: bboxCenterX(cell) }))
    .filter((entry): entry is { cell: DocumentSourceNode; centerX: number } =>
      entry.centerX !== undefined
    );
  if (positioned.length === 0) return undefined;
  positioned.sort((left, right) =>
    Math.abs(left.centerX - sourceX) - Math.abs(right.centerX - sourceX)
  );
  return positioned[0]?.cell;
}

function columnLabelStartIndex(rows: VisualTableCandidate["rows"]): number {
  const headerIndex = rows.findIndex(({ row, cells }) =>
    isSourceTreeHeaderRow(row) && cells.length > 1
  );
  return headerIndex >= 0 ? headerIndex : 0;
}

function startsNewVisualTableItem(cells: DocumentSourceNode[]): boolean {
  const firstText = tableCellText(cells[0]);
  return /^(?:item\s+\d+\b|[A-Z][.)]\s+|coverage\s+part\b|endorsement\s+(?:no\.?|number|#|\d+)\b)/i.test(firstText);
}

function rowMatchesColumnLabels(cells: DocumentSourceNode[], columnLabels: Map<number, string>): boolean {
  if (columnLabels.size === 0 || cells.length < columnLabels.size) return false;
  return cells.every((cell, index) => {
    const label = columnLabels.get(tableCellColumnIndex(cell, index));
    return !label || tableCellText(cell).toLowerCase() === label.toLowerCase();
  });
}

function implicitContinuationRows(
  rows: VisualTableCandidate["rows"],
  columnLabels: Map<number, string>,
  firstLabelRowIndex: number,
): VisualTableContinuationRepair[] {
  const continuations: VisualTableContinuationRepair[] = [];
  let targetRowId: string | undefined;
  const targetColumnLabel = columnLabels.get(1);

  for (const [rowIndex, { row, cells }] of rows.entries()) {
    if (rowIndex < firstLabelRowIndex) continue;
    if (rowIndex === firstLabelRowIndex && rowMatchesColumnLabels(cells, columnLabels)) continue;
    if (startsNewVisualTableItem(cells)) {
      targetRowId = row.id;
      continue;
    }
    if (!targetRowId || cells.length === 0) continue;

    const isSpuriousHeader = isSourceTreeHeaderRow(row) && !rowMatchesColumnLabels(cells, columnLabels);
    const isShortContinuation = !isSourceTreeHeaderRow(row) && cells.length < Math.max(2, columnLabels.size);
    if (!isSpuriousHeader && !isShortContinuation) continue;

    continuations.push({
      sourceRowNodeId: row.id,
      targetRowNodeId: targetRowId,
      targetColumnIndex: 1,
      targetColumnLabel,
      reason: "Continuation row inferred from repaired table header.",
    });
  }

  return continuations;
}

function metadataWithColumnLabel(
  metadata: DocumentSourceNode["metadata"],
  label: string,
): DocumentSourceNode["metadata"] {
  const next: Record<string, unknown> = {
    ...(metadata ?? {}),
    columnName: label,
    visualTableRepairColumnLabel: label,
  };
  if (metadata?.table && typeof metadata.table === "object" && !Array.isArray(metadata.table)) {
    next.table = {
      ...metadata.table,
      columnName: label,
    };
  }
  return next;
}

function tableCellDescription(cell: DocumentSourceNode, label: string): string {
  const text = tableCellText(cell);
  return cleanText(
    text && text.toLowerCase() !== label.toLowerCase()
      ? `${label} | ${text}`
      : label,
    cell.description,
  );
}

function applyVisualTableRepair(
  sourceTree: DocumentSourceNode[],
  repair: SourceTreeVisualTableRepair,
): DocumentSourceNode[] {
  if (repair.tables.length === 0) return sourceTree;

  const byId = new Map(sourceTree.map((node) => [node.id, node]));
  const byParent = nodesByParent(sourceTree);
  const updates = new Map<string, DocumentSourceNode>();
  const removeIds = new Set<string>();
  const rowsToRebuildText = new Set<string>();

  const currentNode = (id: string) => updates.get(id) ?? byId.get(id);

  for (const tableRepair of repair.tables) {
    const table = byId.get(tableRepair.tableNodeId);
    if (!table || table.kind !== "table") continue;
    const rows = tableRowsWithCells(table, byParent);
    const rowIds = new Set(rows.map(({ row }) => row.id));
    const rowOrder = new Map(rows.map(({ row }, index) => [row.id, index]));
    const columnLabels = new Map<number, string>();
    for (const label of tableRepair.columnLabels) {
      const normalized = normalizedRepairLabel(label.label);
      if (normalized) columnLabels.set(label.columnIndex, normalized);
    }

    const firstLabelRowIndex = columnLabelStartIndex(rows);
    if (columnLabels.size > 0) {
      const normalizedLabels = new Set([...columnLabels.values()].map((label) => label.toLowerCase()));
      for (const [rowIndex, { row, cells }] of rows.entries()) {
        if (removeIds.has(row.id)) continue;
        if (rowIndex < firstLabelRowIndex) {
          for (const cell of cells) {
            const metadataLabel = metadataColumnName(cell.metadata);
            if (
              metadataLabel &&
              isGenericColumnTitle(metadataLabel) &&
              normalizedLabels.has(cleanText(cell.title, "").toLowerCase())
            ) {
              updates.set(cell.id, {
                ...(currentNode(cell.id) ?? cell),
                title: metadataLabel,
                description: tableCellDescription(cell, metadataLabel),
                metadata: metadataWithColumnLabel(cell.metadata, metadataLabel),
              });
              rowsToRebuildText.add(row.id);
            }
          }
          continue;
        }
        for (const [fallbackIndex, cell] of cells.entries()) {
          const columnIndex = tableCellColumnIndex(cell, fallbackIndex);
          const label = columnLabels.get(columnIndex);
          if (!label) continue;
          const current = currentNode(cell.id) ?? cell;
          if (
            current.title === label &&
            metadataColumnName(current.metadata) === label &&
            (metadataTableColumnName(current.metadata) ?? label) === label
          ) {
            continue;
          }
          updates.set(cell.id, {
            ...current,
            title: label,
            description: tableCellDescription(current, label),
            metadata: metadataWithColumnLabel(current.metadata, label),
          });
          rowsToRebuildText.add(row.id);
        }
        if (cells.length > 0) rowsToRebuildText.add(row.id);
      }
    }

    const continuationRows = [
      ...tableRepair.continuationRows,
      ...implicitContinuationRows(rows, columnLabels, firstLabelRowIndex),
    ];
    const seenContinuationRows = new Set<string>();
    for (const continuation of continuationRows) {
      const continuationKey = `${continuation.sourceRowNodeId}:${continuation.targetRowNodeId}`;
      if (seenContinuationRows.has(continuationKey)) continue;
      seenContinuationRows.add(continuationKey);
      if (!rowIds.has(continuation.sourceRowNodeId) || !rowIds.has(continuation.targetRowNodeId)) continue;
      if (continuation.sourceRowNodeId === continuation.targetRowNodeId) continue;
      const sourceIndex = rowOrder.get(continuation.sourceRowNodeId);
      const targetIndex = rowOrder.get(continuation.targetRowNodeId);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      if (Math.abs(sourceIndex - targetIndex) > 3) continue;

      const sourceRow = currentNode(continuation.sourceRowNodeId);
      const targetRow = currentNode(continuation.targetRowNodeId);
      if (!sourceRow || !targetRow || sourceRow.kind !== "table_row" || targetRow.kind !== "table_row") continue;
      if (isSourceTreeHeaderRow(targetRow)) continue;

      const sourceCells = (byParent.get(sourceRow.id) ?? [])
        .filter((node) => node.kind === "table_cell")
        .map((node) => currentNode(node.id) ?? node);
      const targetCells = (byParent.get(targetRow.id) ?? [])
        .filter((node) => node.kind === "table_cell")
        .map((node) => currentNode(node.id) ?? node);
      const sourceText = tableRowTextForPrompt(sourceRow, sourceCells);
      if (!sourceText) continue;

      const targetCell = findCellForContinuation({
        cells: targetCells,
        targetColumnIndex: continuation.targetColumnIndex,
        targetColumnLabel: continuation.targetColumnLabel,
      });
      const sourceNodes = [sourceRow, ...sourceCells];
      const sourceSpanIds = sourceSpanIdsForNodes(sourceNodes);
      let mergedIntoCells = false;

      if (sourceCells.length > 0 && targetCells.length > 0) {
        for (const sourceCell of sourceCells) {
          const cellText = tableCellValueText(sourceCell);
          if (!cellText) continue;
          const visualTargetCell =
            findCellByVisualPosition(sourceCell, targetCells) ?? targetCell;
          if (!visualTargetCell) continue;
          const currentTargetCell = currentNode(visualTargetCell.id) ?? visualTargetCell;
          const nextCellText = appendDistinctText(tableCellText(currentTargetCell), cellText);
          if (!nextCellText) continue;
          updates.set(visualTargetCell.id, {
            ...currentTargetCell,
            textExcerpt: nextCellText,
            description: cleanText(
              [currentTargetCell.title, nextCellText].filter(Boolean).join(" | "),
              currentTargetCell.description,
            ),
            sourceSpanIds: [
              ...new Set([
                ...currentTargetCell.sourceSpanIds,
                ...sourceRow.sourceSpanIds,
                ...sourceCell.sourceSpanIds,
              ]),
            ],
            bbox: mergedBbox([currentTargetCell, sourceCell]),
            metadata: {
              ...(currentTargetCell.metadata ?? {}),
              visualTableRepair: "merged_continuation",
            },
          });
          mergedIntoCells = true;
        }
        if (mergedIntoCells) rowsToRebuildText.add(targetRow.id);
      }

      if (!mergedIntoCells && targetCell) {
        const nextCellText = appendDistinctText(tableCellText(targetCell), sourceText);
        if (nextCellText) {
          const mergedNodes = [targetCell, ...sourceNodes];
          updates.set(targetCell.id, {
            ...(currentNode(targetCell.id) ?? targetCell),
            textExcerpt: nextCellText,
            description: cleanText([targetCell.title, nextCellText].filter(Boolean).join(" | "), targetCell.description),
            sourceSpanIds: [...new Set([...targetCell.sourceSpanIds, ...sourceSpanIds])],
            bbox: mergedBbox(mergedNodes),
            metadata: {
              ...(targetCell.metadata ?? {}),
              visualTableRepair: "merged_continuation",
            },
          });
          rowsToRebuildText.add(targetRow.id);
        }
      }

      const fallbackRowText = mergedIntoCells
        ? undefined
        : appendDistinctText(targetRow.textExcerpt ?? targetRow.description, sourceText);
      updates.set(targetRow.id, {
        ...(currentNode(targetRow.id) ?? targetRow),
        ...(mergedIntoCells
          ? {}
          : {
              textExcerpt: fallbackRowText,
              description: cleanText(
                [targetRow.title, fallbackRowText].filter(Boolean).join(" | "),
                targetRow.description,
              ),
            }),
        sourceSpanIds: [...new Set([...targetRow.sourceSpanIds, ...sourceSpanIds])],
        bbox: mergedBbox([targetRow, ...sourceNodes]),
        metadata: {
          ...(targetRow.metadata ?? {}),
          visualTableRepair: "merged_continuation",
        },
      });

      removeIds.add(sourceRow.id);
      for (const sourceCell of sourceCells) removeIds.add(sourceCell.id);
    }
  }

  for (const rowId of rowsToRebuildText) {
    if (removeIds.has(rowId)) continue;
    const row = currentNode(rowId);
    if (!row || row.kind !== "table_row") continue;
    const cells = (byParent.get(row.id) ?? [])
      .filter((node) => node.kind === "table_cell" && !removeIds.has(node.id))
      .map((node) => currentNode(node.id) ?? node)
      .sort((left, right) =>
        tableCellColumnIndex(left, 0) - tableCellColumnIndex(right, 0) ||
        left.order - right.order ||
        left.id.localeCompare(right.id),
      );
    const textExcerpt = tableRowTextFromCells(cells);
    if (!textExcerpt) continue;
    updates.set(row.id, {
      ...row,
      textExcerpt,
      description: cleanText([row.title, textExcerpt].filter(Boolean).join(" | "), row.description),
    });
  }

  if (updates.size === 0 && removeIds.size === 0) return sourceTree;
  const repaired = sourceTree
    .filter((node) => !removeIds.has(node.id))
    .map((node) => updates.get(node.id) ?? node);
  return normalizeDocumentSourceTreePaths(normalizeContainerEvidenceFromChildren(repaired));
}

async function runVisualTableRepair(params: {
  sourceTree: DocumentSourceNode[];
  generateObject: GenerateObject;
  resolveBudget: (taskKind: ModelTaskKind, hintTokens: number) => ModelBudgetResolution;
  trackUsage: TrackUsage;
  log?: (message: string) => Promise<void>;
}): Promise<{ sourceTree: DocumentSourceNode[]; warnings: string[] }> {
  const candidates = visualTableCandidates(params.sourceTree);
  if (candidates.length === 0) return { sourceTree: params.sourceTree, warnings: [] };

  let sourceTree = params.sourceTree;
  const warnings: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    try {
      const budget = params.resolveBudget("extraction_source_tree", 1800);
      const maxTokens = Math.min(budget.maxTokens, 2400);
      const startedAt = Date.now();
      const response = await safeGenerateObject(
        params.generateObject,
        {
          prompt: buildVisualTableRepairPrompt(candidate),
          schema: SourceTreeVisualTableRepairSchema,
          maxTokens,
          taskKind: "extraction_source_tree",
          budgetDiagnostics: { ...budget, maxTokens },
          trace: {
            label: `source_tree_visual_table_repair_p${candidate.page}`,
            startPage: candidate.page,
            endPage: candidate.page,
            batchIndex: index + 1,
            batchCount: candidates.length,
            sourceBacked: true,
          },
        },
        {
          fallback: { tables: [], warnings: [] },
          log: params.log,
        },
      );
      params.trackUsage(response.usage, {
        taskKind: "extraction_source_tree",
        label: `source_tree_visual_table_repair_p${candidate.page}`,
        maxTokens,
        durationMs: Date.now() - startedAt,
      });
      const repair = response.object as SourceTreeVisualTableRepair;
      sourceTree = applyVisualTableRepair(sourceTree, repair);
      warnings.push(...repair.warnings.map((warning) =>
        `Visual table repair warning on page ${candidate.page}: ${warning}`,
      ));
    } catch (error) {
      warnings.push(`Visual table repair skipped on page ${candidate.page}; parsed table kept (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return { sourceTree, warnings };
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
    const description = descriptionWithPages(cleanText(group.description, title), children);
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

const NORMALIZED_COMPATIBILITY_FIELDS = new Set<keyof PolicyOperationalProfile>([
  "policyNumber",
  "namedInsured",
  "insurer",
  "broker",
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

function provenanceOf(value: SourceBackedValue | undefined): SourceProvenance | undefined {
  if (!value?.sourceSpanIds.length) return undefined;
  return {
    sourceSpanIds: value.sourceSpanIds,
    ...(value.sourceNodeIds[0] ? { documentNodeId: value.sourceNodeIds[0] } : {}),
  };
}

function materializeDocument(params: {
  id: string;
  sourceTree: DocumentSourceNode[];
  formInventory: SourceTreeFormHint[];
  operationalProfile: PolicyOperationalProfile;
}): InsuranceDocument {
  const profile = params.operationalProfile;
  const policyNumber = valueOf(profile, "policyNumber") ?? "Unknown";
  const insuredName = valueOf(profile, "namedInsured") ?? "Unknown";
  const carrier = valueOf(profile, "insurer") ?? "Unknown";
  const effectiveDate = valueOf(profile, "effectiveDate") ?? "Unknown";
  const expirationDate = valueOf(profile, "expirationDate") ?? "Unknown";
  const premium = valueOf(profile, "premium");
  const insurerProvenance = provenanceOf(profile.insurer);
  const broker = valueOf(profile, "broker");
  const brokerProvenance = provenanceOf(profile.broker);
  const coverages = profile.coverages.map((coverage) => ({
    name: coverage.name,
    coverageCode: coverage.coverageCode,
    limit: coverage.limit,
    deductible: coverage.deductible,
    premium: coverage.premium,
    retroactiveDate: coverage.retroactiveDate,
    formNumber: coverage.formNumber,
    sectionRef: coverage.sectionRef,
    coverageOrigin: coverage.coverageOrigin,
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
    ...(insurerProvenance
      ? { insurer: { legalName: carrier, ...insurerProvenance } }
      : {}),
    ...(broker && brokerProvenance
      ? {
          brokerAgency: broker,
          producer: { agencyName: broker, ...brokerProvenance },
        }
      : {}),
    policyTypes: profile.policyTypes,
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
  formInventory?: FormInventoryResult;
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  resolveBudget: (taskKind: ModelTaskKind, hintTokens: number) => ModelBudgetResolution;
  trackUsage: TrackUsage;
  log?: (message: string) => Promise<void>;
}): Promise<ExtractionV3Result> {
  const sourceSpans = normalizeSourceSpans(params.sourceSpans);
  const formHints = normalizeFormHints(params.formInventory?.forms, sourceSpans);
  let sourceTree = applySemanticPageGrouping(applyFormInventoryHints(buildDocumentSourceTree(sourceSpans, params.id), formHints));
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

  if (shouldRunSourceTreeOrganizer(sourceTree, sourceSpans)) {
    try {
    const organizations: SourceTreeOrganization[] = [];
    const batches = organizationBatches(sourceTree);
    for (const [batchIndex, batch] of batches.entries()) {
      const budget = params.resolveBudget("extraction_source_tree", 4096);
      const startedAt = Date.now();
      const response = await safeGenerateObject(
        params.generateObject,
        {
          prompt: buildOrganizationPrompt(batch, formHints),
          schema: SourceTreeOrganizationSchema,
          maxTokens: budget.maxTokens,
          taskKind: "extraction_source_tree",
          budgetDiagnostics: budget,
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
  } else {
    await params.log?.("Deterministic source tree ready; skipped model organizer");
  }

  if (shouldRunOutlineCleanup(sourceTree)) {
    try {
      const budget = params.resolveBudget("extraction_source_tree", 1600);
      const maxTokens = Math.min(budget.maxTokens, 1600);
      const startedAt = Date.now();
      const response = await safeGenerateObject(
        params.generateObject,
        {
          prompt: buildOutlineCleanupPrompt(sourceTree, formHints),
          schema: SourceTreeOrganizationSchema,
          maxTokens,
          taskKind: "extraction_source_tree",
          budgetDiagnostics: { ...budget, maxTokens },
        },
        {
          fallback: { labels: [], groups: [] },
          log: params.log,
        },
      );
      localTrack(response.usage, {
        taskKind: "extraction_source_tree",
        label: "source_tree_outline_cleanup",
        maxTokens,
        durationMs: Date.now() - startedAt,
      });
      sourceTree = applyOrganization(sourceTree, response.object as SourceTreeOrganization);
    } catch (error) {
      warnings.push(`Source-tree outline cleanup failed; deterministic tree used (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const visualTableRepair = await runVisualTableRepair({
    sourceTree,
    generateObject: params.generateObject,
    resolveBudget: params.resolveBudget,
    trackUsage: localTrack,
    log: params.log,
  });
  sourceTree = normalizeSourceTreeTableDisplayText(visualTableRepair.sourceTree);
  warnings.push(...visualTableRepair.warnings);

  const emptyProfile = emptyOperationalProfile();
  let operationalProfile = emptyProfile;
  try {
    const validNodeIds = new Set(sourceTree.map((node) => node.id));
    const validSpanIds = new Set(sourceSpans.map((span) => span.id));
    const budget = params.resolveBudget("extraction_operational_profile", 8192);
    const startedAt = Date.now();
    const response = await safeGenerateObject(
      params.generateObject,
      {
        prompt: buildOperationalProfilePrompt(sourceTree),
        schema: OperationalProfilePromptSchema,
        maxTokens: budget.maxTokens,
        taskKind: "extraction_operational_profile",
        budgetDiagnostics: budget,
        providerOptions: params.providerOptions,
      },
      {
        fallback: emptyProfile,
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
      emptyProfile,
      response.object as Partial<PolicyOperationalProfile>,
      validNodeIds,
      validSpanIds,
    );
  } catch (error) {
    warnings.push(`Operational profile model pass failed; coverage rows omitted (${error instanceof Error ? error.message : String(error)})`);
  }

  if (operationalProfile.coverages.length > 0) {
    try {
      const validNodeIds = new Set(sourceTree.map((node) => node.id));
      const validSpanIds = new Set(sourceSpans.map((span) => span.id));
      const budget = params.resolveBudget("extraction_coverage_cleanup", 4096);
      const startedAt = Date.now();
      const response = await safeGenerateObject(
        params.generateObject,
        {
          prompt: buildOperationalProfileCleanupPrompt(sourceTree, operationalProfile),
          schema: OperationalProfileCleanupSchema,
          maxTokens: budget.maxTokens,
          taskKind: "extraction_coverage_cleanup",
          budgetDiagnostics: budget,
          providerOptions: params.providerOptions,
          trace: { phase: "coverage_cleanup", sourceBacked: true },
        },
        {
          fallback: { coverageDecisions: [], warnings: [] },
          log: params.log,
        },
      );
      localTrack(response.usage, {
        taskKind: "extraction_coverage_cleanup",
        label: "operational_profile_cleanup",
        maxTokens: budget.maxTokens,
        durationMs: Date.now() - startedAt,
      });
      operationalProfile = applyOperationalProfileCleanup(
        operationalProfile,
        response.object as OperationalProfileCleanup,
        validNodeIds,
        validSpanIds,
      );
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
