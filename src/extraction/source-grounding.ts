import type { SourceSpan } from "../source";

const ARRAY_PATHS: Array<{ memoryKey: string; arrayKeys: string[] }> = [
  { memoryKey: "coverage_limits", arrayKeys: ["coverages"] },
  { memoryKey: "endorsements", arrayKeys: ["endorsements"] },
  { memoryKey: "exclusions", arrayKeys: ["exclusions"] },
  { memoryKey: "conditions", arrayKeys: ["conditions"] },
  { memoryKey: "sections", arrayKeys: ["sections"] },
  { memoryKey: "definitions", arrayKeys: ["definitions"] },
  { memoryKey: "covered_reasons", arrayKeys: ["coveredReasons", "covered_reasons"] },
  { memoryKey: "declarations", arrayKeys: ["fields"] },
  { memoryKey: "premium_breakdown", arrayKeys: ["premiumBreakdown", "taxesAndFees"] },
  { memoryKey: "supplementary", arrayKeys: ["auxiliaryFacts", "supplementaryFacts"] },
  { memoryKey: "form_inventory", arrayKeys: ["forms"] },
];

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function textValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function pageOverlaps(recordStart: number | undefined, recordEnd: number | undefined, span: SourceSpan): boolean {
  if (!recordStart && !recordEnd) return false;
  const start = recordStart ?? recordEnd!;
  const end = recordEnd ?? recordStart!;
  const spanStart = span.pageStart ?? span.location?.page ?? span.location?.startPage;
  const spanEnd = span.pageEnd ?? span.location?.page ?? span.location?.endPage ?? spanStart;
  if (!spanStart) return false;
  return start <= (spanEnd ?? spanStart) && end >= spanStart;
}

function formMatches(record: Record<string, unknown>, span: SourceSpan): boolean {
  const formNumber = textValue(record, "formNumber");
  if (!formNumber || !span.formNumber) return false;
  return normalize(formNumber) === normalize(span.formNumber);
}

function textMatches(record: Record<string, unknown>, span: SourceSpan): boolean {
  const spanText = normalize(span.text);
  const candidates = [
    textValue(record, "originalContent", "content", "definition", "value"),
    textValue(record, "name", "title", "term", "field", "coverageName"),
    textValue(record, "limit", "deductible", "premium"),
  ].filter((value): value is string => !!value && value.length >= 3);

  return candidates.some((candidate) => spanText.includes(normalize(candidate)));
}

function sourceHashFor(spans: SourceSpan[]): string | undefined {
  return spans.map((span) => span.textHash ?? span.hash).filter(Boolean).join(":") || undefined;
}

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
}

function hierarchyScore(span: SourceSpan): number {
  switch (sourceUnit(span)) {
    case "table_row":
      return 5;
    case "table":
      return 3;
    case "section":
    case "page":
      return 2;
    case "table_cell":
      return -2;
    default:
      return 0;
  }
}

function parentRowId(span: SourceSpan): string | undefined {
  return span.parentSpanId ?? span.table?.rowSpanId ?? span.metadata?.rowSpanId;
}

function preferParentRows(matches: SourceSpan[], sourceSpans: SourceSpan[]): SourceSpan[] {
  if (matches.length === 0) return matches;
  const byId = new Map(sourceSpans.map((span) => [span.id, span]));
  const expanded: SourceSpan[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const parent = sourceUnit(match) === "table_cell" ? byId.get(parentRowId(match) ?? "") : undefined;
    const preferred = parent && sourceUnit(parent) === "table_row" ? parent : match;
    if (seen.has(preferred.id)) continue;
    seen.add(preferred.id);
    expanded.push(preferred);
  }
  return expanded;
}

export function findSourceSpansForRecord(record: Record<string, unknown>, sourceSpans: SourceSpan[]): SourceSpan[] {
  if (sourceSpans.length === 0) return [];
  const pageStart = numberValue(record, "pageNumber", "pageStart");
  const pageEnd = numberValue(record, "pageNumber", "pageEnd");

  const scored = sourceSpans
    .map((span) => {
      let score = 0;
      if (pageOverlaps(pageStart, pageEnd, span)) score += 4;
      if (formMatches(record, span)) score += 3;
      if (textMatches(record, span)) score += 2;
      if (score > 0) score += hierarchyScore(span);
      return { span, score };
    })
    .filter((item) => item.score >= 2)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.span.id.localeCompare(right.span.id);
    });

  return preferParentRows(scored.slice(0, 5).map((item) => item.span), sourceSpans).slice(0, 3);
}

function groundRecord<T extends Record<string, unknown>>(record: T, sourceSpans: SourceSpan[]): T {
  if (Array.isArray(record.sourceSpanIds) && record.sourceSpanIds.length > 0 && record.sourceTextHash) {
    return record;
  }

  const matches = findSourceSpansForRecord(record, sourceSpans);
  if (matches.length === 0) return record;

  return {
    ...record,
    sourceSpanIds: Array.isArray(record.sourceSpanIds) && record.sourceSpanIds.length > 0
      ? record.sourceSpanIds
      : matches.map((span) => span.id),
    sourceTextHash: typeof record.sourceTextHash === "string" && record.sourceTextHash.trim()
      ? record.sourceTextHash
      : sourceHashFor(matches),
  };
}

export function groundExtractionMemoryWithSourceSpans(
  memory: Map<string, unknown>,
  sourceSpans: SourceSpan[],
): void {
  if (sourceSpans.length === 0) return;

  for (const { memoryKey, arrayKeys } of ARRAY_PATHS) {
    const payload = memory.get(memoryKey);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const record = payload as Record<string, unknown>;

    for (const arrayKey of arrayKeys) {
      const items = record[arrayKey];
      if (!Array.isArray(items)) continue;
      record[arrayKey] = items.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? groundRecord(item as Record<string, unknown>, sourceSpans)
          : item,
      );
    }
  }
}
