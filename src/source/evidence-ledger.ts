import { stableHash } from "./ids";
import type { DocumentSourceNode, SourceSpan } from "./schemas";

export type ExtractionEvidenceField =
  | "policy_number"
  | "named_insured"
  | "carrier"
  | "effective_date"
  | "expiration_date";

export type SourceCoverageAssignment = "core" | "coverage" | "both" | "catch_all";

export type EvidenceLedgerCandidate = {
  value: string;
  normalizedValue: string;
  sourceSpanIds: string[];
  sourceNodeIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type EvidenceLedgerFieldResult = {
  status: "observed" | "not_observed";
  candidates: EvidenceLedgerCandidate[];
  ambiguous: boolean;
};

export type CoverageRegionEvidence = {
  label: string;
  sourceSpanIds: string[];
  sourceNodeIds: string[];
  pageStart?: number;
  pageEnd?: number;
};

export type ExtractionEvidenceLedger = {
  version: "evidence-ledger-v1";
  sourceFingerprint: string;
  ledgerHash: string;
  completeSourceCoverage: boolean;
  eligibleSourceSpanIds: string[];
  projectedSourceSpanIds: string[];
  fields: Record<ExtractionEvidenceField, EvidenceLedgerFieldResult>;
  coverageRegions: {
    status: "observed" | "not_observed";
    candidates: CoverageRegionEvidence[];
  };
  ambiguous: boolean;
};

export type ExtractionSourceCoverageEntry = {
  sourceSpanId: string;
  assignment: SourceCoverageAssignment;
};

export type ExtractionSourceCoverageMap = {
  version: "source-coverage-v1";
  sourceFingerprint: string;
  eligibleSourceSpanIds: string[];
  entries: ExtractionSourceCoverageEntry[];
  shards: {
    core: string[];
    coverage: string[];
    both: string[];
    catchAll: string[];
  };
  complete: boolean;
};

type LedgerOptions = {
  /** Span IDs actually processed by completed extraction sections. */
  processedSourceSpanIds?: readonly string[];
};

type SpanProjection = {
  span: SourceSpan;
  nodes: DocumentSourceNode[];
  context: string;
};

const CORE_CONTEXT = /\b(?:policy\s*(?:number|no\.?|#)|named\s+insured|insured\s+name|carrier|insurer|insurance\s+company|policy\s+period|effective\s+date|expiration\s+date|expiry\s+date|producer|broker|general\s+agent|declarations?)\b/i;
const COVERAGE_CONTEXT = /\b(?:coverage|coverages|covered|limit(?:s)?\s+of\s+(?:insurance|liability)|deductible|retention|insuring\s+agreement|schedule\s+of|vehicle\s+schedule|auto\s+schedule|property\s+schedule|location\s+schedule|coverage\s+part|premium\s+schedule)\b/i;
const PARTY_CHANGING_ENDORSEMENT = /\b(?:endorsement|additional\s+insured|named\s+insured|loss\s+payee|mortgagee|carrier|insurer|producer|broker|general\s+agent|changes?\s+the\s+policy)\b/i;

const FIELD_PATTERNS: Record<ExtractionEvidenceField, RegExp[]> = {
  policy_number: [
    /\bpolicy\s*(?:number|no\.?|#)\s*[:#-]?\s*([^\n|;]{2,80})/i,
  ],
  named_insured: [
    /\b(?:first\s+)?named\s+insured(?:\s+name)?\s*[:#-]?\s*([^\n|;]{2,160})/i,
    /\binsured\s+name\s*[:#-]?\s*([^\n|;]{2,160})/i,
  ],
  carrier: [
    /\b(?:carrier|insurer|insurance\s+company|company\s+name)\s*[:#-]?\s*([^\n|;]{2,180})/i,
  ],
  effective_date: [
    /\b(?:policy\s+)?effective\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*([^\n|;]{4,80})/i,
    /\b(?:policy\s+)?(?:period|term)\s+(?:from|begin(?:s|ning)?)\s*[:#-]?\s*([^\n|;]{4,80})/i,
  ],
  expiration_date: [
    /\b(?:policy\s+)?(?:expiration|expiry)\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*([^\n|;]{4,80})/i,
    /\b(?:policy\s+)?(?:period|term)\s+(?:to|end(?:s|ing)?)\s*[:#-]?\s*([^\n|;]{4,80})/i,
  ],
};

const LABEL_ONLY: Record<ExtractionEvidenceField, RegExp> = {
  policy_number: /^\s*policy\s*(?:number|no\.?|#)\s*[:#-]?\s*$/i,
  named_insured: /^\s*(?:first\s+)?named\s+insured(?:\s+name)?\s*[:#-]?\s*$/i,
  carrier: /^\s*(?:carrier|insurer|insurance\s+company|company\s+name)\s*[:#-]?\s*$/i,
  effective_date: /^\s*(?:policy\s+)?effective\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*$/i,
  expiration_date: /^\s*(?:policy\s+)?(?:expiration|expiry)\s+date(?:\s*\/\s*time)?\s*[:#-]?\s*$/i,
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedCandidate(field: ExtractionEvidenceField, value: string): string {
  const cleaned = cleanText(value)
    .replace(/^[\s:#-]+/, "")
    .replace(/[\s|;,]+$/, "")
    .trim();
  if (field === "policy_number") {
    return cleaned.replace(/\s+/g, "").toUpperCase();
  }
  if (field === "effective_date" || field === "expiration_date") {
    return cleaned.toUpperCase();
  }
  return cleaned.toLowerCase();
}

function plausibleValue(field: ExtractionEvidenceField, value: string): boolean {
  const cleaned = cleanText(value);
  if (!cleaned || cleaned.length > 180) return false;
  if (LABEL_ONLY[field].test(cleaned)) return false;
  if (field === "policy_number") {
    return /[A-Z0-9]/i.test(cleaned) && !/^\W+$/.test(cleaned);
  }
  if (field === "effective_date" || field === "expiration_date") {
    return /\d/.test(cleaned) && /(?:\d{1,2}[/-]\d{1,2}|\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(cleaned);
  }
  return /[A-Z]/i.test(cleaned);
}

function spanPageStart(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.page ?? span.location?.startPage;
}

function spanOrdinal(span: SourceSpan): number | undefined {
  const match = span.id.match(/:span:[^:]+:(\d+):[^:]+$/);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function eligibleSpans(sourceSpans: readonly SourceSpan[]): SourceSpan[] {
  return sourceSpans
    .map((span, inputIndex) => ({ span, inputIndex }))
    .filter(({ span }) => cleanText(span.text).length > 0)
    .sort((left, right) => {
      const pageOrder = (spanPageStart(left.span) ?? Number.MAX_SAFE_INTEGER)
        - (spanPageStart(right.span) ?? Number.MAX_SAFE_INTEGER);
      if (pageOrder !== 0) return pageOrder;
      const leftTableId = left.span.table?.tableId;
      const rightTableId = right.span.table?.tableId;
      if (leftTableId && leftTableId === rightTableId) {
        const rowOrder = (left.span.table?.rowIndex ?? 0)
          - (right.span.table?.rowIndex ?? 0);
        if (rowOrder !== 0) return rowOrder;
        const columnOrder = (left.span.table?.columnIndex ?? 0)
          - (right.span.table?.columnIndex ?? 0);
        if (columnOrder !== 0) return columnOrder;
      }
      const lineOrder = (left.span.location?.lineStart ?? Number.MAX_SAFE_INTEGER)
        - (right.span.location?.lineStart ?? Number.MAX_SAFE_INTEGER);
      if (lineOrder !== 0) return lineOrder;
      const characterOrder = (left.span.location?.charStart ?? Number.MAX_SAFE_INTEGER)
        - (right.span.location?.charStart ?? Number.MAX_SAFE_INTEGER);
      if (characterOrder !== 0) return characterOrder;
      const ordinalOrder = (spanOrdinal(left.span) ?? Number.MAX_SAFE_INTEGER)
        - (spanOrdinal(right.span) ?? Number.MAX_SAFE_INTEGER);
      return ordinalOrder || left.inputIndex - right.inputIndex;
    })
    .map(({ span }) => span);
}

function fingerprint(spans: readonly SourceSpan[]): string {
  return stableHash(spans.map((span) => ({
    id: span.id,
    hash: span.textHash ?? span.hash,
    pageStart: span.pageStart ?? span.location?.page,
    pageEnd: span.pageEnd ?? span.location?.endPage,
  })));
}

function projections(
  sourceSpans: readonly SourceSpan[],
  sourceTree: readonly DocumentSourceNode[],
): SpanProjection[] {
  const nodesBySpan = new Map<string, DocumentSourceNode[]>();
  for (const node of sourceTree) {
    for (const sourceSpanId of node.sourceSpanIds) {
      const nodes = nodesBySpan.get(sourceSpanId) ?? [];
      nodes.push(node);
      nodesBySpan.set(sourceSpanId, nodes);
    }
  }
  return eligibleSpans(sourceSpans).map((span) => {
    const nodes = (nodesBySpan.get(span.id) ?? [])
      .slice()
      .sort((left, right) => left.order - right.order || compareText(left.id, right.id));
    return {
      span,
      nodes,
      context: cleanText([
        ...nodes.flatMap((node) => [node.title, node.description, node.textExcerpt ?? "", node.path]),
        span.text,
      ].join(" ")),
    };
  });
}

function candidate(
  field: ExtractionEvidenceField,
  value: string,
  evidence: readonly SpanProjection[],
): EvidenceLedgerCandidate | null {
  const cleaned = cleanText(value);
  if (!plausibleValue(field, cleaned)) return null;
  const sourceSpanIds = [...new Set(evidence.map(({ span }) => span.id))].sort();
  const sourceNodeIds = [...new Set(evidence.flatMap(({ nodes }) => nodes.map((node) => node.id)))].sort();
  if (sourceSpanIds.length === 0 || sourceNodeIds.length === 0) return null;
  const pages = evidence.flatMap(({ span }) => [
    span.pageStart ?? span.location?.page ?? span.location?.startPage,
    span.pageEnd ?? span.location?.endPage,
  ]).filter((page): page is number => typeof page === "number");
  return {
    value: cleaned,
    normalizedValue: normalizedCandidate(field, cleaned),
    sourceSpanIds,
    sourceNodeIds,
    ...(pages.length ? { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) } : {}),
  };
}

function dedupeCandidates(candidates: readonly EvidenceLedgerCandidate[]): EvidenceLedgerCandidate[] {
  const byKey = new Map<string, EvidenceLedgerCandidate>();
  for (const item of candidates) {
    const key = `${item.normalizedValue}\u0000${item.sourceSpanIds.join(",")}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort((left, right) =>
    (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.normalizedValue, right.normalizedValue)
    || compareText(left.sourceSpanIds.join(","), right.sourceSpanIds.join(",")));
}

function inlineCandidates(
  field: ExtractionEvidenceField,
  projected: readonly SpanProjection[],
): EvidenceLedgerCandidate[] {
  const values: EvidenceLedgerCandidate[] = [];
  for (const projection of projected) {
    if (projection.nodes.length === 0) continue;
    for (const pattern of FIELD_PATTERNS[field]) {
      const match = pattern.exec(projection.span.text);
      if (!match?.[1]) continue;
      const item = candidate(field, match[1], [projection]);
      if (item) values.push(item);
    }
  }
  return values;
}

function adjacentCandidates(
  field: ExtractionEvidenceField,
  projected: readonly SpanProjection[],
): EvidenceLedgerCandidate[] {
  const values: EvidenceLedgerCandidate[] = [];
  for (let index = 0; index < projected.length - 1; index += 1) {
    const label = projected[index]!;
    const value = projected[index + 1]!;
    if (label.nodes.length === 0 || value.nodes.length === 0) continue;
    if (!LABEL_ONLY[field].test(label.span.text)) continue;
    const labelPage = label.span.pageStart ?? label.span.location?.page;
    const valuePage = value.span.pageStart ?? value.span.location?.page;
    if (labelPage !== undefined && valuePage !== undefined && labelPage !== valuePage) continue;
    const sameRow = Boolean(
      label.span.table?.rowSpanId
      && label.span.table.rowSpanId === value.span.table?.rowSpanId,
    );
    if (!sameRow && label.span.table?.tableId && label.span.table.tableId !== value.span.table?.tableId) {
      continue;
    }
    const item = candidate(field, value.span.text, [label, value]);
    if (item) values.push(item);
  }
  return values;
}

function fieldResult(
  field: ExtractionEvidenceField,
  projected: readonly SpanProjection[],
): EvidenceLedgerFieldResult {
  const candidates = dedupeCandidates([
    ...inlineCandidates(field, projected),
    ...adjacentCandidates(field, projected),
  ]);
  return {
    status: candidates.length ? "observed" : "not_observed",
    candidates,
    ambiguous: new Set(candidates.map((item) => item.normalizedValue)).size > 1,
  };
}

function coverageRegions(projected: readonly SpanProjection[]): CoverageRegionEvidence[] {
  const regions: CoverageRegionEvidence[] = [];
  for (const projection of projected) {
    if (projection.nodes.length === 0 || !COVERAGE_CONTEXT.test(projection.context)) continue;
    const pages = [
      projection.span.pageStart ?? projection.span.location?.page,
      projection.span.pageEnd ?? projection.span.location?.endPage,
    ].filter((page): page is number => typeof page === "number");
    regions.push({
      label: cleanText(projection.span.text).slice(0, 240),
      sourceSpanIds: [projection.span.id],
      sourceNodeIds: [...new Set(projection.nodes.map((node) => node.id))].sort(),
      ...(pages.length ? { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) } : {}),
    });
  }
  const seen = new Set<string>();
  return regions.filter((region) => {
    const key = region.sourceSpanIds.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) =>
    (left.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.pageStart ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.sourceSpanIds[0] ?? "", right.sourceSpanIds[0] ?? ""));
}

export function buildExtractionSourceCoverageMap(
  sourceSpans: readonly SourceSpan[],
  sourceTree: readonly DocumentSourceNode[],
): ExtractionSourceCoverageMap {
  const projected = projections(sourceSpans, sourceTree);
  const entries = projected.map(({ span, nodes }): ExtractionSourceCoverageEntry => {
    const spanText = cleanText(span.text);
    const nodeContext = cleanText(nodes.flatMap((node) => [
      node.title,
      node.description,
      node.path,
    ]).join(" "));
    const context = `${spanText} ${nodeContext}`;
    const inEndorsement = nodes.some((node) =>
      node.kind === "endorsement" || /\bendorsement\b/i.test(`${node.title} ${node.path}`));
    const core = CORE_CONTEXT.test(context);
    const coverage = COVERAGE_CONTEXT.test(context);
    const partyChangingEndorsement = inEndorsement
      && PARTY_CHANGING_ENDORSEMENT.test(context);
    const assignment: SourceCoverageAssignment = partyChangingEndorsement || (core && coverage)
      ? "both"
      : core
        ? "core"
        : coverage
          ? "coverage"
          : "catch_all";
    return { sourceSpanId: span.id, assignment };
  });
  const eligibleSourceSpanIds = projected.map(({ span }) => span.id);
  const assigned = new Set(entries.map((entry) => entry.sourceSpanId));
  return {
    version: "source-coverage-v1",
    sourceFingerprint: fingerprint(projected.map(({ span }) => span)),
    eligibleSourceSpanIds,
    entries,
    shards: {
      core: entries.filter((entry) => entry.assignment === "core").map((entry) => entry.sourceSpanId),
      coverage: entries.filter((entry) => entry.assignment === "coverage").map((entry) => entry.sourceSpanId),
      both: entries.filter((entry) => entry.assignment === "both").map((entry) => entry.sourceSpanId),
      catchAll: entries.filter((entry) => entry.assignment === "catch_all").map((entry) => entry.sourceSpanId),
    },
    complete: eligibleSourceSpanIds.every((sourceSpanId) => assigned.has(sourceSpanId)),
  };
}

export function buildExtractionEvidenceLedger(
  sourceSpans: readonly SourceSpan[],
  sourceTree: readonly DocumentSourceNode[],
  options: LedgerOptions = {},
): ExtractionEvidenceLedger {
  const projected = projections(sourceSpans, sourceTree);
  const eligibleSourceSpanIds = projected.map(({ span }) => span.id);
  const projectedSourceSpanIds = projected
    .filter(({ nodes }) => nodes.length > 0)
    .map(({ span }) => span.id);
  const processed = options.processedSourceSpanIds
    ? new Set(options.processedSourceSpanIds)
    : undefined;
  const completeSourceCoverage =
    eligibleSourceSpanIds.length > 0
    && projectedSourceSpanIds.length === eligibleSourceSpanIds.length
    && (!processed || eligibleSourceSpanIds.every((sourceSpanId) => processed.has(sourceSpanId)));
  const fields = {
    policy_number: fieldResult("policy_number", projected),
    named_insured: fieldResult("named_insured", projected),
    carrier: fieldResult("carrier", projected),
    effective_date: fieldResult("effective_date", projected),
    expiration_date: fieldResult("expiration_date", projected),
  } satisfies Record<ExtractionEvidenceField, EvidenceLedgerFieldResult>;
  const regions = coverageRegions(projected);
  const ledgerWithoutHash = {
    version: "evidence-ledger-v1" as const,
    sourceFingerprint: fingerprint(projected.map(({ span }) => span)),
    completeSourceCoverage,
    eligibleSourceSpanIds,
    projectedSourceSpanIds,
    fields,
    coverageRegions: {
      status: regions.length ? "observed" as const : "not_observed" as const,
      candidates: regions,
    },
    ambiguous: Object.values(fields).some((field) => field.ambiguous),
  };
  return {
    ...ledgerWithoutHash,
    ledgerHash: stableHash(ledgerWithoutHash),
  };
}
