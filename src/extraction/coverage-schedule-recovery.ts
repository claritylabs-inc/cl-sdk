import type { PageAssignment } from "../prompts/coordinator/page-map";
import type { SourceSpan } from "../source";

type CoverageRecord = Record<string, unknown>;

export interface CoverageScheduleRecoveryResult {
  recovered: CoverageRecord[];
  missingSourceRows: SourceSpan[];
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
}

function pageNumber(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.page ?? span.location?.startPage;
}

function coveragePages(pageAssignments: PageAssignment[]): Set<number> {
  const pages = new Set<number>();
  for (const assignment of pageAssignments) {
    if (assignment.extractorNames.includes("coverage_limits") || assignment.hasScheduleValues) {
      pages.add(assignment.localPageNumber);
    }
  }
  return pages;
}

function parseCurrencyAmount(value: string): number | undefined {
  const match = value.match(/(?:CAD|USD|US)?\s*\$?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function limitTypeFrom(value: string): string | undefined {
  const normalized = normalize(value);
  if (normalized.includes("/") || (normalized.includes("each claim") && normalized.includes("aggregate"))) return "scheduled";
  if (normalized.includes("each claim") || normalized.includes("per claim")) return "per_claim";
  if (normalized.includes("each occurrence") || normalized.includes("per occurrence")) return "per_occurrence";
  if (normalized.includes("aggregate")) return "aggregate";
  if (normalized.includes("shared within") || normalized.includes("within coverage")) return "scheduled";
  if (normalized.includes("/")) return "scheduled";
  return undefined;
}

function limitValueTypeFrom(value: string): string {
  const normalized = normalize(value);
  if (parseCurrencyAmount(value) !== undefined) return "numeric";
  if (normalized.includes("shared within") || normalized.includes("within coverage") || normalized.includes("shown above")) {
    return "referential";
  }
  if (normalized.includes("included")) return "included";
  if (normalized.includes("not included") || normalized === "nil" || normalized === "none") return "not_included";
  if (normalized.includes("as stated")) return "as_stated";
  return "other";
}

function cleanName(value: string): string {
  return value
    .replace(/\s*\([^)]*part of and not in addition to[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;-]+$/, "")
    .trim();
}

function isDeductibleOnly(name: string, rowText: string): boolean {
  const normalizedName = normalize(name);
  const normalizedRow = normalize(rowText);
  if (!/\b(deductible|retention|sir)\b/.test(`${normalizedName} ${normalizedRow}`)) return false;
  if (/\b(coverage|sub limit|sublimit|limit)\b/.test(normalizedName) && !/\b(enhanced|standard)\s+deductible\b/.test(normalizedName)) {
    return false;
  }
  return /\b(enhanced|standard)?\s*(deductible|retention|sir)\b/.test(normalizedName)
    || /^\s*(deductible|retention|sir)\b/.test(normalizedRow);
}

function splitRowFields(rowText: string): Array<{ key?: string; value: string }> {
  return rowText
    .split(/\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([^:]{1,100}):\s*(.*)$/);
      if (!match) return { value: part };
      return { key: match[1].trim(), value: match[2].trim() };
    });
}

function firstField(fields: Array<{ key?: string; value: string }>, patterns: RegExp[]): string | undefined {
  for (const field of fields) {
    const target = `${field.key ?? ""} ${field.value}`;
    if (patterns.some((pattern) => pattern.test(target))) return field.value || field.key;
  }
  return undefined;
}

function coverageFromRow(span: SourceSpan): CoverageRecord | undefined {
  const rowText = span.text.trim();
  if (!rowText || sourceUnit(span) !== "table_row") return undefined;
  if (span.table?.isHeader || span.metadata?.isHeader === "true") return undefined;

  const fields = splitRowFields(rowText);
  let name: string | undefined;
  let limit: string | undefined;
  for (const field of fields) {
    const key = field.key?.trim();
    const value = field.value.trim();
    if (!key || !value) continue;
    if (!name && /^coverage$/i.test(key)) name = cleanName(value);
    if (!limit && /\blimit\b/i.test(key)) limit = value;
    if (!name && /\b(sub[-\s]?limit|aggregate|each claim)\b/i.test(key) && parseCurrencyAmount(value) !== undefined) {
      name = cleanName(key);
      limit = limit ?? value;
    }
  }

  if (!name || !limit) {
    for (const field of fields) {
      const key = field.key?.trim();
      const value = field.value.trim();
      if (!key || !value) continue;
      if (!name && /\b(sub[-\s]?limit|coverage|aggregate|each claim)\b/i.test(key) && !parseCurrencyAmount(key)) {
        name = cleanName(key);
        limit = limit ?? value;
      }
    }
  }

  if (!name || !limit) return undefined;
  if (isDeductibleOnly(name, rowText)) return undefined;

  const normalizedLimit = normalize(limit);
  const hasUsableLimit = parseCurrencyAmount(limit) !== undefined
    || /\b(shared within|within coverage|as stated|included|not included)\b/i.test(normalizedLimit);
  if (!hasUsableLimit) return undefined;

  const deductible = firstField(fields, [/\bdeductible\b/i, /\bretention\b/i, /\bsir\b/i]);
  const basis = firstField(fields, [/\bbasis\b/i]);
  const retroactiveDate = firstField(fields, [/\bretroactive date\b/i, /\bretro date\b/i]);
  const page = pageNumber(span);
  const limitAmount = parseCurrencyAmount(limit);
  const deductibleAmount = deductible ? parseCurrencyAmount(deductible) : undefined;

  return {
    name,
    limit,
    ...(limitAmount !== undefined ? { limitAmount } : {}),
    ...(limitTypeFrom(`${name} ${limit}`) ? { limitType: limitTypeFrom(`${name} ${limit}`) } : {}),
    limitValueType: limitValueTypeFrom(limit),
    ...(deductible && !/^nil|none$/i.test(deductible.trim()) ? { deductible } : {}),
    ...(deductibleAmount !== undefined ? { deductibleAmount } : {}),
    ...(deductible ? { deductibleValueType: limitValueTypeFrom(deductible) } : {}),
    ...(basis && /claims[- ]made/i.test(basis) ? { trigger: "claims_made" } : {}),
    ...(retroactiveDate ? { retroactiveDate } : {}),
    ...(span.formNumber ? { formNumber: span.formNumber } : {}),
    ...(page ? { pageNumber: page } : {}),
    sectionRef: span.sectionId ?? "SCHEDULE",
    originalContent: rowText,
    sourceSpanIds: [span.id],
    sourceTextHash: span.textHash ?? span.hash,
  };
}

function coverageKey(coverage: CoverageRecord): string {
  return [
    textValue(coverage.name) ?? "",
    textValue(coverage.limit) ?? "",
    textValue(coverage.limitType) ?? "",
    numberValue(coverage.pageNumber) ?? "",
  ].map((part) => normalize(String(part))).join("|");
}

function rowMatchesExisting(row: CoverageRecord, existing: CoverageRecord[]): boolean {
  const rowKey = coverageKey(row);
  const rowName = normalize(textValue(row.name) ?? "");
  const rowLimit = normalize(textValue(row.limit) ?? "");
  return existing.some((coverage) => {
    if (coverageKey(coverage) === rowKey) return true;
    const name = normalize(textValue(coverage.name) ?? "");
    const limit = normalize(textValue(coverage.limit) ?? "");
    return Boolean(rowName && rowLimit && name === rowName && limit === rowLimit);
  });
}

export function recoverCoverageScheduleRows(params: {
  memory: Map<string, unknown>;
  sourceSpans: SourceSpan[];
  pageAssignments: PageAssignment[];
}): CoverageScheduleRecoveryResult {
  const payload = params.memory.get("coverage_limits") as { coverages?: CoverageRecord[] } | undefined;
  const existing = Array.isArray(payload?.coverages) ? payload.coverages : [];
  const pages = coveragePages(params.pageAssignments);
  const candidates = params.sourceSpans
    .filter((span) => sourceUnit(span) === "table_row")
    .filter((span) => {
      const page = pageNumber(span);
      return page !== undefined && pages.has(page);
    })
    .map(coverageFromRow)
    .filter((coverage): coverage is CoverageRecord => Boolean(coverage));

  const recovered: CoverageRecord[] = [];
  for (const coverage of candidates) {
    if (rowMatchesExisting(coverage, [...existing, ...recovered])) continue;
    recovered.push(coverage);
  }

  if (recovered.length > 0) {
    params.memory.set("coverage_limits", {
      ...(payload ?? {}),
      coverages: [...existing, ...recovered],
    });
  }

  return {
    recovered,
    missingSourceRows: recovered
      .map((coverage) => {
        const id = Array.isArray(coverage.sourceSpanIds) ? coverage.sourceSpanIds[0] : undefined;
        return params.sourceSpans.find((span) => span.id === id);
      })
      .filter((span): span is SourceSpan => Boolean(span)),
  };
}
