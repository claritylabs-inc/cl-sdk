import { z } from "zod";
import type { GenerateObject, LogFn, PerformanceReport, TokenUsage } from "../core/types";
import { resolveModelBudget } from "../core/model-budget";
import type {
  ModelBudgetConstraint,
  ModelBudgetResolution,
  ModelCapabilities,
  ModelTaskKind,
} from "../core/model-budget";
import { safeGenerateObject } from "../core/safe-generate";
import {
  OperationalCoverageLineSchema,
  OperationalCoverageScheduleSchema,
  OperationalPremiumLineSchema,
  OperationalTaxFeeItemSchema,
  SourceBackedValueSchema,
  type DocumentSourceNode,
  type OperationalCoverageLine,
  type OperationalCoverageSchedule,
  type OperationalPremiumLine,
  type OperationalTaxFeeItem,
  type PolicyOperationalProfile,
  type SourceBackedValue,
  type SourceSpan,
} from "../source";

const COVERAGE_RECOVERY_VERSION = "coverage-recovery-v2" as const;
const DISCOVERY_PAGE_BATCH_SIZE = 32;
const REGION_PAGE_BATCH_SIZE = 4;
const RECOVERY_EVIDENCE_CHAR_LIMIT = 42_000;

const RecoveryRegionSchema = z.object({
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  reason: z.string(),
  priorContext: z.string().optional(),
  sourceNodeIds: z.array(z.string()).default([]),
  sourceSpanIds: z.array(z.string()).default([]),
});

const RecoveryRegionDiscoverySchema = z.object({
  regions: z.array(RecoveryRegionSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

const CoverageRecoveryCandidateSchema = z.object({
  coverages: z.array(OperationalCoverageLineSchema).default([]),
  coverageSchedules: z.array(OperationalCoverageScheduleSchema).default([]),
  premiumBreakdown: z.array(OperationalPremiumLineSchema).default([]),
  taxesAndFees: z.array(OperationalTaxFeeItemSchema).default([]),
  totalCost: SourceBackedValueSchema.optional(),
  warnings: z.array(z.string()).default([]),
});

type RecoveryRegion = z.infer<typeof RecoveryRegionSchema>;
type CoverageRecoveryCandidate = z.infer<typeof CoverageRecoveryCandidateSchema>;

export type CoverageRecoveryDiagnostics = {
  version: typeof COVERAGE_RECOVERY_VERSION;
  status: "disabled" | "succeeded" | "failed";
  regionCount: number;
  modelCallCount: number;
  recoveredCoverageCount: number;
  recoveredTermCount: number;
  recoveredScheduleCount: number;
  recoveredFinancialFactCount: number;
  citationRejectionCount: number;
  warnings: string[];
};

export type CoverageRecoveryResult = {
  operationalProfile: PolicyOperationalProfile;
  diagnostics: CoverageRecoveryDiagnostics;
  tokenUsage: TokenUsage;
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

type RecoveryEvidenceEntry = {
  sourceSpanId: string;
  sourceNodeIds: string[];
  pageStart?: number;
  pageEnd?: number;
  sourceUnit?: string;
  formNumber?: string;
  table?: SourceSpan["table"];
  text: string;
};

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function spanPageStart(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.startPage ?? span.location?.page;
}

function spanPageEnd(span: SourceSpan): number | undefined {
  return span.pageEnd ?? span.location?.endPage ?? span.location?.page ?? spanPageStart(span);
}

function spanSourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
}

function overlapsPageRange(
  value: { pageStart?: number; pageEnd?: number },
  pageStart: number,
  pageEnd: number,
): boolean {
  const start = value.pageStart ?? value.pageEnd;
  const end = value.pageEnd ?? value.pageStart;
  return typeof start === "number" && typeof end === "number" && start <= pageEnd && end >= pageStart;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function evenlySample<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return [values[0]!];
  return Array.from({ length: limit }, (_, index) =>
    values[Math.round((index * (values.length - 1)) / (limit - 1))]!,
  );
}

function sourceNodeIdsBySpanId(sourceTree: DocumentSourceNode[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const node of sourceTree) {
    for (const sourceSpanId of node.sourceSpanIds) {
      const ids = result.get(sourceSpanId) ?? [];
      ids.push(node.id);
      result.set(sourceSpanId, ids);
    }
  }
  return result;
}

function documentPages(sourceTree: DocumentSourceNode[], sourceSpans: SourceSpan[]): number[] {
  const pages = new Set<number>();
  for (const span of sourceSpans) {
    const start = spanPageStart(span);
    const end = spanPageEnd(span) ?? start;
    if (!start || !end) continue;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  for (const node of sourceTree) {
    if (node.pageStart) pages.add(node.pageStart);
    if (node.pageEnd) pages.add(node.pageEnd);
  }
  return [...pages].sort((left, right) => left - right);
}

function pageSketch(
  page: number,
  sourceTree: DocumentSourceNode[],
  sourceSpans: SourceSpan[],
) {
  const pageNodes = sourceTree
    .filter((node) => node.kind !== "document" && overlapsPageRange(node, page, page))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const pageSpans = sourceSpans
    .filter((span) => overlapsPageRange({ pageStart: spanPageStart(span), pageEnd: spanPageEnd(span) }, page, page))
    .sort((left, right) =>
      (left.location?.charStart ?? Number.MAX_SAFE_INTEGER) - (right.location?.charStart ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id),
    );
  const tableIds = uniqueStrings(pageSpans.map((span) => span.table?.tableId ?? span.metadata?.tableId));
  const units = pageSpans.reduce<Record<string, number>>((counts, span) => {
    const unit = spanSourceUnit(span) ?? "unknown";
    counts[unit] = (counts[unit] ?? 0) + 1;
    return counts;
  }, {});
  const textSamples = evenlySample(
    pageSpans.filter((span) => cleanText(span.text)).map((span) => ({
      sourceSpanId: span.id,
      sourceUnit: spanSourceUnit(span),
      tableId: span.table?.tableId ?? span.metadata?.tableId,
      rowIndex: span.table?.rowIndex,
      columnIndex: span.table?.columnIndex,
      columnName: span.table?.columnName,
      bbox: span.bbox?.[0],
      text: cleanText(span.text)?.slice(0, 280),
    })),
    18,
  );
  return {
    page,
    forms: uniqueStrings(pageSpans.map((span) => span.formNumber)),
    structure: evenlySample(pageNodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      path: node.path,
      sourceSpanIds: node.sourceSpanIds.slice(0, 6),
    })), 20),
    layout: {
      units,
      tableCount: tableIds.length,
      rowCount: pageSpans.filter((span) => spanSourceUnit(span) === "table_row").length,
      cellCount: pageSpans.filter((span) => spanSourceUnit(span) === "table_cell").length,
    },
    textSamples,
  };
}

function discoveryPrompt(sketches: ReturnType<typeof pageSketch>[]): string {
  return `Discover every document region that may contain policy-specific coverage facts, asset schedules, or financial facts.

This is semantic region discovery, not keyword or heading matching. Inspect the layout and source-tree sketch for every supplied page, including unusual terminology and late-document schedules.

Select regions containing or continuing any of:
- coverage, benefit, insuring-agreement, limit, sublimit, deductible, retention, or per-asset terms
- covered-auto, vehicle, property, location, building, equipment, or similar asset schedules
- premium breakdowns, taxes, fees, surcharges, assessments, or total payable
- declarations, forms, endorsements, options, exclusions, or cross-references that establish the status or scope of those facts

Continuation rules:
- A repeated heading is not required. Carry prior section and table-header context onto continuation pages.
- Continue through compatible row numbering, column geometry, form identity, and table shape.
- Stop at a new form, incompatible table structure, terminal language, or unrelated section.
- Include declined, excluded, and unselected-option regions so the extraction pass can keep them out of active coverage rows.

Use only page numbers and source IDs from the sketches. Return no region for pages that contain no relevant policy-specific evidence.

Page sketches:
${JSON.stringify(sketches, null, 2)}`;
}

function normalizeRegions(regions: RecoveryRegion[], pages: number[]): RecoveryRegion[] {
  if (pages.length === 0) return [];
  const minPage = pages[0]!;
  const maxPage = pages[pages.length - 1]!;
  const normalized = regions.flatMap((region) => {
    const start = Math.max(minPage, Math.min(maxPage, region.pageStart));
    const end = Math.max(start, Math.min(maxPage, region.pageEnd));
    if (!pages.some((page) => page >= start && page <= end)) return [];
    return [{ ...region, pageStart: start, pageEnd: end }];
  });
  normalized.sort((left, right) => left.pageStart - right.pageStart || left.pageEnd - right.pageEnd);
  return normalized.reduce<RecoveryRegion[]>((rows, region) => {
    const previous = rows[rows.length - 1];
    if (!previous || region.pageStart > previous.pageEnd + 1) {
      rows.push(region);
      return rows;
    }
    previous.pageEnd = Math.max(previous.pageEnd, region.pageEnd);
    previous.reason = uniqueStrings([previous.reason, region.reason]).join("; ");
    previous.priorContext = uniqueStrings([previous.priorContext, region.priorContext]).join("; ") || undefined;
    previous.sourceNodeIds = uniqueStrings([...previous.sourceNodeIds, ...region.sourceNodeIds]);
    previous.sourceSpanIds = uniqueStrings([...previous.sourceSpanIds, ...region.sourceSpanIds]);
    return rows;
  }, []);
}

function splitRegions(regions: RecoveryRegion[]): RecoveryRegion[] {
  return regions.flatMap((region) => {
    const result: RecoveryRegion[] = [];
    for (let page = region.pageStart; page <= region.pageEnd; page += REGION_PAGE_BATCH_SIZE) {
      result.push({
        ...region,
        pageStart: page,
        pageEnd: Math.min(region.pageEnd, page + REGION_PAGE_BATCH_SIZE - 1),
      });
    }
    return result;
  });
}

function priorStructuralContext(
  region: RecoveryRegion,
  sourceTree: DocumentSourceNode[],
  sourceSpans: SourceSpan[],
) {
  const precedingNodes = sourceTree
    .filter((node) => node.kind !== "document" && (node.pageStart ?? 0) <= region.pageStart)
    .filter((node) => ["page_group", "form", "endorsement", "section", "schedule", "table"].includes(node.kind))
    .sort((left, right) =>
      (right.pageStart ?? 0) - (left.pageStart ?? 0) || right.order - left.order,
    )
    .slice(0, 12)
    .map((node) => ({
      id: node.id,
      kind: node.kind,
      title: node.title,
      path: node.path,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      sourceSpanIds: node.sourceSpanIds.slice(0, 8),
    }));
  const headerSpans = sourceSpans
    .filter((span) => {
      const page = spanPageStart(span);
      return typeof page === "number"
        && page >= Math.max(1, region.pageStart - 2)
        && page <= region.pageStart
        && (span.table?.isHeader || span.table?.columnName || span.metadata?.isHeader === "true");
    })
    .map((span) => ({
      sourceSpanId: span.id,
      pageStart: spanPageStart(span),
      table: span.table,
      text: cleanText(span.text)?.slice(0, 600),
    }));
  return { priorContext: region.priorContext, precedingNodes, tableHeaders: headerSpans };
}

function regionEvidence(
  region: RecoveryRegion,
  sourceTree: DocumentSourceNode[],
  sourceSpans: SourceSpan[],
): RecoveryEvidenceEntry[] {
  const nodeIdsBySpanId = sourceNodeIdsBySpanId(sourceTree);
  const spans = sourceSpans
    .filter((span) => overlapsPageRange(
      { pageStart: spanPageStart(span), pageEnd: spanPageEnd(span) },
      region.pageStart,
      region.pageEnd,
    ))
    .sort((left, right) =>
      (spanPageStart(left) ?? Number.MAX_SAFE_INTEGER) - (spanPageStart(right) ?? Number.MAX_SAFE_INTEGER)
      || (left.location?.charStart ?? Number.MAX_SAFE_INTEGER) - (right.location?.charStart ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id),
    );
  return spans.flatMap((span) => {
    const text = cleanText(span.text);
    if (!text) return [];
    const parts = text.match(/[\s\S]{1,1400}/g) ?? [text];
    return parts.map((part) => ({
      sourceSpanId: span.id,
      sourceNodeIds: (nodeIdsBySpanId.get(span.id) ?? []).slice(0, 6),
      pageStart: spanPageStart(span),
      pageEnd: spanPageEnd(span),
      sourceUnit: spanSourceUnit(span),
      formNumber: span.formNumber,
      table: span.table,
      text: part,
    }));
  });
}

function evidenceBatches(entries: RecoveryEvidenceEntry[]): RecoveryEvidenceEntry[][] {
  const batches: RecoveryEvidenceEntry[][] = [];
  let current: RecoveryEvidenceEntry[] = [];
  let chars = 0;
  for (const entry of entries) {
    const size = entry.text.length + 260;
    if (current.length > 0 && chars + size > RECOVERY_EVIDENCE_CHAR_LIMIT) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(entry);
    chars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function recoveryPrompt(params: {
  region: RecoveryRegion;
  context: ReturnType<typeof priorStructuralContext>;
  evidence: RecoveryEvidenceEntry[];
  batchIndex: number;
  batchCount: number;
}) {
  return `Recover missing source-backed policy coverage, schedule, and financial facts from one semantically selected document region.

Region: pages ${params.region.pageStart}-${params.region.pageEnd}
Reason: ${params.region.reason}
Evidence batch: ${params.batchIndex}/${params.batchCount}

Rules:
- Preserve the source's coverage terminology as coverages[].name. ACORD lineOfBusiness and coverageCode may supplement it but may not replace it with unsupported wording.
- A repeated heading is not required. Use the prior section and table-header context to interpret compatible continuation rows.
- Keep declaration/core-form and endorsement facts separate when their source scopes differ, even if names match.
- Put per occurrence, per claim, aggregate, per vehicle, per location, retention, deductible, sublimit, and similar values in coverages[].limits with the source label preserved.
- Do not emit premium, taxes, fees, surcharges, assessments, rating bases, insured values, or exposures as coverage rows or coverage terms.
- Do not emit declined, excluded, not-covered, or optional-unselected entries as active coverages.
- Store covered-auto, vehicle, property, location, building, and equipment listings in coverageSchedules. Partial or redacted items are allowed there.
- Put premium rows in premiumBreakdown, taxes/fees/surcharges/assessments in taxesAndFees, and total payable in totalCost.
- Every returned fact must cite existing sourceSpanIds or sourceNodeIds from the supplied evidence. Prefer exact row/cell sourceSpanIds.
- Numeric, monetary, percentage, date, VIN, form, and policy identifiers must be copied exactly enough to appear in their cited evidence after punctuation and spacing normalization.
- Omit ambiguous or unsupported facts. Do not replace or rewrite source values.

Prior structural context:
${JSON.stringify(params.context, null, 2)}

Source evidence:
${JSON.stringify(params.evidence, null, 2)}`;
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mechanicallyCheckableTokens(value: string): string[] {
  const numeric = [...value.matchAll(/\d[\d,./:%-]*/g)]
    .map((match) => match[0].replace(/^0+(?=\d)/, "").replace(/[^0-9a-z]/gi, ""))
    .filter((token) => token.length >= 2);
  const identifiers = [...value.matchAll(/\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,}\b/gi)]
    .map((match) => normalizedText(match[0]));
  return uniqueStrings([...numeric, ...identifiers]);
}

function valueGroundedInText(value: string | undefined, evidenceText: string): boolean {
  if (!value) return true;
  const tokens = mechanicallyCheckableTokens(value);
  if (tokens.length === 0) return true;
  const normalizedEvidence = normalizedText(evidenceText);
  return tokens.every((token) => normalizedEvidence.includes(normalizedText(token)));
}

function citedText(ids: string[], spansById: Map<string, SourceSpan>): string {
  return ids.map((id) => spansById.get(id)?.text ?? "").join(" ");
}

function validIds(ids: readonly string[], valid: Set<string>): string[] {
  return uniqueStrings(ids.filter((id) => valid.has(id)));
}

function validateCandidate(
  candidate: CoverageRecoveryCandidate,
  sourceTree: DocumentSourceNode[],
  sourceSpans: SourceSpan[],
) {
  const validNodeIds = new Set(sourceTree.map((node) => node.id));
  const validSpanIds = new Set(sourceSpans.map((span) => span.id));
  const spansById = new Map(sourceSpans.map((span) => [span.id, span]));
  let citationRejectionCount = 0;
  const validateCitation = (sourceNodeIds: string[], sourceSpanIds: string[], values: (string | undefined)[]) => {
    const nodes = validIds(sourceNodeIds, validNodeIds);
    const spans = validIds(sourceSpanIds, validSpanIds);
    if (nodes.length === 0 && spans.length === 0) {
      citationRejectionCount += 1;
      return undefined;
    }
    const evidenceText = citedText(spans, spansById);
    if (values.some((value) => !valueGroundedInText(value, evidenceText))) {
      citationRejectionCount += 1;
      return undefined;
    }
    return { sourceNodeIds: nodes, sourceSpanIds: spans };
  };

  const coverages = candidate.coverages.flatMap((coverage) => {
    const coverageCitation = validateCitation(
      coverage.sourceNodeIds,
      coverage.sourceSpanIds,
      [coverage.name, coverage.limit, coverage.deductible, coverage.premium, coverage.retroactiveDate, coverage.formNumber, coverage.endorsementNumber],
    );
    if (!coverageCitation) return [];
    if (/\b(?:declined|excluded|not covered|not selected|optional\s*[-:]?\s*no)\b/i.test(coverage.name)) return [];
    if (/\b(?:premium|tax|fee|surcharge|assessment|rating basis|exposure|insured value)\b/i.test(coverage.name)
      && coverage.limits.length === 0 && !coverage.limit && !coverage.deductible) return [];
    const limits = coverage.limits.flatMap((term) => {
      if (term.kind === "premium") return [];
      const citation = validateCitation(
        term.sourceNodeIds,
        term.sourceSpanIds,
        [term.label, term.value, term.appliesTo],
      );
      return citation ? [{ ...term, ...citation }] : [];
    });
    const hasCoverageFact = limits.length > 0 || coverage.limit || coverage.deductible || coverage.retroactiveDate || coverage.formNumber || coverage.endorsementNumber;
    return hasCoverageFact ? [{ ...coverage, ...coverageCitation, limits }] : [];
  });

  const coverageSchedules = candidate.coverageSchedules.flatMap((schedule) => {
    const sourceSpanIds = validIds(schedule.sourceSpanIds, validSpanIds);
    if (sourceSpanIds.length === 0 || !valueGroundedInText(schedule.name, citedText(sourceSpanIds, spansById))) {
      citationRejectionCount += 1;
      return [];
    }
    const items = schedule.items.flatMap((item) => {
      const itemSpanIds = validIds(item.sourceSpanIds, validSpanIds);
      if (itemSpanIds.length === 0) {
        citationRejectionCount += 1;
        return [];
      }
      const evidenceText = citedText(itemSpanIds, spansById);
      const values = item.values.filter((value) => {
        const valid = valueGroundedInText(value.value, evidenceText);
        if (!valid) citationRejectionCount += 1;
        return valid;
      });
      return values.length > 0 && valueGroundedInText(item.label, evidenceText)
        ? [{ ...item, values, sourceSpanIds: itemSpanIds }]
        : [];
    });
    return items.length > 0 ? [{ ...schedule, items, sourceSpanIds }] : [];
  });

  const premiumBreakdown = candidate.premiumBreakdown.flatMap((row) => {
    const citation = validateCitation(row.sourceNodeIds, row.sourceSpanIds, [row.line, row.amount]);
    return citation ? [{ ...row, ...citation }] : [];
  });
  const taxesAndFees = candidate.taxesAndFees.flatMap((row) => {
    const citation = validateCitation(row.sourceNodeIds, row.sourceSpanIds, [row.name, row.amount]);
    return citation ? [{ ...row, ...citation }] : [];
  });
  const totalCostCitation = candidate.totalCost
    ? validateCitation(candidate.totalCost.sourceNodeIds, candidate.totalCost.sourceSpanIds, [candidate.totalCost.value])
    : undefined;

  return {
    candidate: {
      ...candidate,
      coverages,
      coverageSchedules,
      premiumBreakdown,
      taxesAndFees,
      totalCost: candidate.totalCost && totalCostCitation
        ? { ...candidate.totalCost, ...totalCostCitation }
        : undefined,
    },
    citationRejectionCount,
  };
}

function normalizedLabel(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function sourcePages(ids: readonly string[], spansById: Map<string, SourceSpan>): [number, number] | undefined {
  const pages = ids.flatMap((id) => {
    const span = spansById.get(id);
    const start = span ? spanPageStart(span) : undefined;
    const end = span ? spanPageEnd(span) : undefined;
    return [start, end].filter((page): page is number => typeof page === "number");
  });
  return pages.length > 0 ? [Math.min(...pages), Math.max(...pages)] : undefined;
}

function sameCoverageScope(
  primary: OperationalCoverageLine,
  recovery: OperationalCoverageLine,
  spansById: Map<string, SourceSpan>,
): boolean {
  if (normalizedLabel(primary.name) !== normalizedLabel(recovery.name)) return false;
  if (primary.lineOfBusiness && recovery.lineOfBusiness && primary.lineOfBusiness !== recovery.lineOfBusiness) return false;
  for (const key of ["formNumber", "sectionRef", "endorsementNumber"] as const) {
    const left = cleanText(primary[key]);
    const right = cleanText(recovery[key]);
    if (left && right && normalizedLabel(left) !== normalizedLabel(right)) return false;
    if (key === "endorsementNumber" && Boolean(left) !== Boolean(right)) return false;
  }
  const primaryPages = sourcePages(primary.sourceSpanIds, spansById);
  const recoveryPages = sourcePages(recovery.sourceSpanIds, spansById);
  if (!primaryPages || !recoveryPages) return true;
  return primaryPages[0] <= recoveryPages[1] + 1 && recoveryPages[0] <= primaryPages[1] + 1;
}

function termIdentity(term: OperationalCoverageLine["limits"][number]): string {
  return [term.kind, normalizedLabel(term.label), normalizedLabel(term.value), normalizedLabel(term.appliesTo ?? "")].join("|");
}

function mergeCoverage(
  primary: OperationalCoverageLine,
  recovery: OperationalCoverageLine,
  warnings: string[],
): OperationalCoverageLine {
  const limits = [...primary.limits];
  const identities = new Set(limits.map(termIdentity));
  for (const term of recovery.limits) {
    const identity = termIdentity(term);
    if (identities.has(identity)) continue;
    const conflict = limits.find((current) =>
      current.kind === term.kind
      && normalizedLabel(current.label) === normalizedLabel(term.label)
      && normalizedLabel(current.appliesTo ?? "") === normalizedLabel(term.appliesTo ?? "")
      && normalizedLabel(current.value) !== normalizedLabel(term.value),
    );
    if (conflict) {
      warnings.push(`Coverage recovery preserved conflicting cited ${term.label} terms for ${primary.name}.`);
    }
    limits.push(term);
    identities.add(identity);
  }
  return {
    ...recovery,
    ...primary,
    limit: primary.limit ?? recovery.limit,
    deductible: primary.deductible ?? recovery.deductible,
    premium: primary.premium ?? recovery.premium,
    retroactiveDate: primary.retroactiveDate ?? recovery.retroactiveDate,
    formNumber: primary.formNumber ?? recovery.formNumber,
    sectionRef: primary.sectionRef ?? recovery.sectionRef,
    endorsementNumber: primary.endorsementNumber ?? recovery.endorsementNumber,
    limits,
    sourceNodeIds: uniqueStrings([...primary.sourceNodeIds, ...recovery.sourceNodeIds]),
    sourceSpanIds: uniqueStrings([...primary.sourceSpanIds, ...recovery.sourceSpanIds]),
  };
}

function appendUnique<T>(
  primary: T[],
  additions: T[],
  key: (value: T) => string,
): T[] {
  const result = [...primary];
  const seen = new Set(primary.map(key));
  for (const value of additions) {
    const identity = key(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(value);
  }
  return result;
}

function mergeRecoveryCandidate(
  profile: PolicyOperationalProfile,
  candidate: CoverageRecoveryCandidate,
  sourceSpans: SourceSpan[],
) {
  const warnings = [...candidate.warnings];
  const spansById = new Map(sourceSpans.map((span) => [span.id, span]));
  const coverages = [...profile.coverages];
  let recoveredCoverageCount = 0;
  let recoveredTermCount = 0;
  for (const recovery of candidate.coverages) {
    const matchIndex = coverages.findIndex((primary) => sameCoverageScope(primary, recovery, spansById));
    if (matchIndex < 0) {
      coverages.push(recovery);
      recoveredCoverageCount += 1;
      recoveredTermCount += recovery.limits.length;
      continue;
    }
    const before = coverages[matchIndex]!.limits.length;
    coverages[matchIndex] = mergeCoverage(coverages[matchIndex]!, recovery, warnings);
    recoveredTermCount += coverages[matchIndex]!.limits.length - before;
  }

  const coverageSchedules = appendUnique(
    profile.coverageSchedules ?? [],
    candidate.coverageSchedules,
    (schedule) => `${schedule.kind}|${normalizedLabel(schedule.name)}|${schedule.pageStart ?? ""}|${schedule.pageEnd ?? ""}`,
  );
  const premiumBreakdown = appendUnique(
    profile.premiumBreakdown ?? [],
    candidate.premiumBreakdown,
    (row) => `${normalizedLabel(row.line)}|${normalizedLabel(row.amount)}|${row.sourceSpanIds.join(",")}`,
  );
  const taxesAndFees = appendUnique(
    profile.taxesAndFees ?? [],
    candidate.taxesAndFees,
    (row) => `${normalizedLabel(row.name)}|${normalizedLabel(row.amount)}|${row.sourceSpanIds.join(",")}`,
  );
  const totalCost = profile.totalCost ?? candidate.totalCost;
  const sourceNodeIds = uniqueStrings([
    ...profile.sourceNodeIds,
    ...coverages.flatMap((coverage) => [
      ...coverage.sourceNodeIds,
      ...coverage.limits.flatMap((term) => term.sourceNodeIds),
    ]),
    ...premiumBreakdown.flatMap((row) => row.sourceNodeIds),
    ...taxesAndFees.flatMap((row) => row.sourceNodeIds),
    ...(totalCost?.sourceNodeIds ?? []),
  ]);
  const sourceSpanIds = uniqueStrings([
    ...profile.sourceSpanIds,
    ...coverages.flatMap((coverage) => [
      ...coverage.sourceSpanIds,
      ...coverage.limits.flatMap((term) => term.sourceSpanIds),
    ]),
    ...coverageSchedules.flatMap((schedule) => [
      ...schedule.sourceSpanIds,
      ...schedule.items.flatMap((item) => item.sourceSpanIds),
    ]),
    ...premiumBreakdown.flatMap((row) => row.sourceSpanIds),
    ...taxesAndFees.flatMap((row) => row.sourceSpanIds),
    ...(totalCost?.sourceSpanIds ?? []),
  ]);

  return {
    operationalProfile: {
      ...profile,
      coverages,
      coverageSchedules,
      premiumBreakdown,
      taxesAndFees,
      totalCost,
      sourceNodeIds,
      sourceSpanIds,
      warnings: uniqueStrings([...profile.warnings, ...warnings]),
    } satisfies PolicyOperationalProfile,
    warnings,
    recoveredCoverageCount,
    recoveredTermCount,
    recoveredScheduleCount: coverageSchedules.length - (profile.coverageSchedules?.length ?? 0),
    recoveredFinancialFactCount:
      premiumBreakdown.length - (profile.premiumBreakdown?.length ?? 0)
      + taxesAndFees.length - (profile.taxesAndFees?.length ?? 0)
      + (!profile.totalCost && totalCost ? 1 : 0),
  };
}

function emptyDiagnostics(status: CoverageRecoveryDiagnostics["status"]): CoverageRecoveryDiagnostics {
  return {
    version: COVERAGE_RECOVERY_VERSION,
    status,
    regionCount: 0,
    modelCallCount: 0,
    recoveredCoverageCount: 0,
    recoveredTermCount: 0,
    recoveredScheduleCount: 0,
    recoveredFinancialFactCount: 0,
    citationRejectionCount: 0,
    warnings: [],
  };
}

export function disabledCoverageRecoveryDiagnostics(): CoverageRecoveryDiagnostics {
  return emptyDiagnostics("disabled");
}

export async function recoverOperationalProfileCoverage(params: {
  sourceTree: DocumentSourceNode[];
  sourceSpans: SourceSpan[];
  operationalProfile: PolicyOperationalProfile;
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  resolveBudget: (taskKind: ModelTaskKind, hintTokens: number) => ModelBudgetResolution;
  trackUsage: TrackUsage;
  log?: (message: string) => Promise<void>;
}): Promise<{ operationalProfile: PolicyOperationalProfile; diagnostics: CoverageRecoveryDiagnostics }> {
  const diagnostics = emptyDiagnostics("succeeded");
  try {
    const pages = documentPages(params.sourceTree, params.sourceSpans);
    const discoveredRegions: RecoveryRegion[] = [];
    for (const [batchIndex, pageBatch] of chunkValues(pages, DISCOVERY_PAGE_BATCH_SIZE).entries()) {
      const sketches = pageBatch.map((page) => pageSketch(page, params.sourceTree, params.sourceSpans));
      const budget = params.resolveBudget("extraction_coverage_recovery", 8_192);
      const startedAt = Date.now();
      diagnostics.modelCallCount += 1;
      const response = await safeGenerateObject(
        params.generateObject,
        {
          prompt: discoveryPrompt(sketches),
          schema: RecoveryRegionDiscoverySchema,
          maxTokens: budget.maxTokens,
          taskKind: "extraction_coverage_recovery",
          budgetDiagnostics: budget,
          providerOptions: params.providerOptions,
          trace: {
            phase: "coverage_recovery_discovery",
            label: "coverage_recovery_discovery",
            startPage: pageBatch[0],
            endPage: pageBatch[pageBatch.length - 1],
            batchIndex: batchIndex + 1,
            batchCount: Math.ceil(pages.length / DISCOVERY_PAGE_BATCH_SIZE),
            sourceBacked: true,
          },
        },
        { maxRetries: 0, log: params.log, retry: false },
      );
      params.trackUsage(response.usage, {
        taskKind: "extraction_coverage_recovery",
        label: "coverage_recovery_discovery",
        maxTokens: budget.maxTokens,
        durationMs: Date.now() - startedAt,
      });
      const discovery = response.object as z.infer<typeof RecoveryRegionDiscoverySchema>;
      discoveredRegions.push(...discovery.regions);
      diagnostics.warnings.push(...discovery.warnings);
    }

    const regions = splitRegions(normalizeRegions(discoveredRegions, pages));
    diagnostics.regionCount = regions.length;
    let operationalProfile = params.operationalProfile;
    for (const [regionIndex, region] of regions.entries()) {
      const evidence = regionEvidence(region, params.sourceTree, params.sourceSpans);
      const batches = evidenceBatches(evidence);
      const context = priorStructuralContext(region, params.sourceTree, params.sourceSpans);
      for (const [batchIndex, batch] of batches.entries()) {
        const budget = params.resolveBudget("extraction_coverage_recovery", 12_288);
        const startedAt = Date.now();
        diagnostics.modelCallCount += 1;
        const response = await safeGenerateObject(
          params.generateObject,
          {
            prompt: recoveryPrompt({
              region,
              context,
              evidence: batch,
              batchIndex: batchIndex + 1,
              batchCount: batches.length,
            }),
            schema: CoverageRecoveryCandidateSchema,
            maxTokens: budget.maxTokens,
            taskKind: "extraction_coverage_recovery",
            budgetDiagnostics: budget,
            providerOptions: params.providerOptions,
            trace: {
              phase: "coverage_recovery",
              label: "coverage_recovery",
              startPage: region.pageStart,
              endPage: region.pageEnd,
              batchIndex: batchIndex + 1,
              batchCount: batches.length,
              sourceBacked: true,
            },
          },
          { maxRetries: 0, log: params.log, retry: false },
        );
        params.trackUsage(response.usage, {
          taskKind: "extraction_coverage_recovery",
          label: `coverage_recovery_${regionIndex + 1}`,
          maxTokens: budget.maxTokens,
          durationMs: Date.now() - startedAt,
        });
        const validated = validateCandidate(
          response.object as CoverageRecoveryCandidate,
          params.sourceTree,
          params.sourceSpans,
        );
        diagnostics.citationRejectionCount += validated.citationRejectionCount;
        const merged = mergeRecoveryCandidate(operationalProfile, validated.candidate, params.sourceSpans);
        operationalProfile = merged.operationalProfile;
        diagnostics.recoveredCoverageCount += merged.recoveredCoverageCount;
        diagnostics.recoveredTermCount += merged.recoveredTermCount;
        diagnostics.recoveredScheduleCount += merged.recoveredScheduleCount;
        diagnostics.recoveredFinancialFactCount += merged.recoveredFinancialFactCount;
        diagnostics.warnings.push(...merged.warnings);
      }
    }
    diagnostics.warnings = uniqueStrings(diagnostics.warnings);
    return { operationalProfile, diagnostics };
  } catch (error) {
    diagnostics.status = "failed";
    diagnostics.warnings = uniqueStrings([
      ...diagnostics.warnings,
      `Coverage recovery failed: ${error instanceof Error ? error.message : String(error)}`,
    ]);
    await params.log?.(diagnostics.warnings[diagnostics.warnings.length - 1]!);
    return { operationalProfile: params.operationalProfile, diagnostics };
  }
}

export async function runCoverageRecovery(params: {
  sourceTree: DocumentSourceNode[];
  sourceSpans: SourceSpan[];
  operationalProfile: PolicyOperationalProfile;
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  modelCapabilities?: ModelCapabilities;
  modelBudgetConstraint?: ModelBudgetConstraint;
  onTokenUsage?: (usage: TokenUsage) => void;
  log?: LogFn;
}): Promise<CoverageRecoveryResult> {
  const tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const performanceReport: PerformanceReport = {
    modelCalls: [],
    totalModelCallDurationMs: 0,
  };
  const recovery = await recoverOperationalProfileCoverage({
    sourceTree: params.sourceTree,
    sourceSpans: params.sourceSpans,
    operationalProfile: params.operationalProfile,
    generateObject: params.generateObject,
    providerOptions: params.providerOptions,
    resolveBudget: (taskKind, hintTokens) => resolveModelBudget({
      taskKind,
      hintTokens,
      modelCapabilities: params.modelCapabilities,
      constraint: params.modelBudgetConstraint,
    }),
    trackUsage: (usage, report) => {
      if (usage) {
        tokenUsage.inputTokens += usage.inputTokens;
        tokenUsage.outputTokens += usage.outputTokens;
        params.onTokenUsage?.(usage);
      }
      if (report) {
        performanceReport.modelCalls.push({
          ...report,
          usage,
          usageReported: Boolean(usage),
        });
        if (report.durationMs != null) {
          performanceReport.totalModelCallDurationMs += report.durationMs;
        }
      }
    },
    log: params.log,
  });
  return {
    ...recovery,
    tokenUsage,
    performanceReport,
  };
}
