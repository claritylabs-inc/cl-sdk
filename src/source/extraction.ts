import {
  SourceChunkSchema,
  SourceSpanSchema,
  type SourceChunk,
  type SourceKind,
  type SourceSpan,
  type SourceSpanTableLocation,
  type SourceSpanUnit,
} from "./schemas";
import { sourceSpanTextHash, stableHash } from "./ids";

export interface SourceTextUnitInput {
  documentId: string;
  sourceKind: SourceKind;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  sourceUnit?: SourceSpanUnit;
  parentSpanId?: string;
  table?: SourceSpanTableLocation;
  metadata?: Record<string, string>;
}

export interface SourcePageInput {
  documentId: string;
  sourceKind?: SourceKind;
  pageNumber: number;
  text: string;
  sectionId?: string;
  formNumber?: string;
  metadata?: Record<string, string>;
}

export interface SectionSourceSpanOptions {
  minSectionChars?: number;
  headingPattern?: RegExp;
}

export interface SourceChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

type SourceSpanWithOriginalIndex = SourceSpan & { __originalIndex: number };

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function buildSourceSpan(input: SourceTextUnitInput, localIndex = 0): SourceSpan {
  const text = normalizeWhitespace(input.text);
  const textHash = sourceSpanTextHash(text);
  const pagePart = input.pageStart ?? "na";
  const id = [
    sanitizeIdPart(input.documentId),
    "span",
    pagePart,
    localIndex,
    textHash.slice(0, 12),
  ].join(":");

  return SourceSpanSchema.parse({
    id,
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    kind: input.sourceKind.endsWith("_pdf") ? "pdf_text" : "plain_text",
    text,
    hash: textHash,
    textHash,
    pageStart: input.pageStart,
    pageEnd: input.pageEnd,
    sectionId: input.sectionId,
    formNumber: input.formNumber,
    sourceUnit: input.sourceUnit,
    parentSpanId: input.parentSpanId,
    table: input.table,
    location: {
      page: input.pageStart === input.pageEnd ? input.pageStart : undefined,
      startPage: input.pageStart,
      endPage: input.pageEnd,
      fieldPath: input.sectionId,
    },
    metadata: input.metadata,
  });
}

export function buildPageSourceSpans(pages: SourcePageInput[]): SourceSpan[] {
  return pages
    .filter((page) => normalizeWhitespace(page.text).length > 0)
    .map((page, index) =>
      buildSourceSpan(
        {
          documentId: page.documentId,
          sourceKind: page.sourceKind ?? "policy_pdf",
          text: page.text,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          sectionId: page.sectionId,
          formNumber: page.formNumber,
          sourceUnit: "page",
          metadata: {
            ...(page.metadata ?? {}),
            sourceUnit: page.metadata?.sourceUnit ?? "page",
          },
        },
        index,
      ),
    );
}

export function buildSectionSourceSpans(
  pages: SourcePageInput[],
  options: SectionSourceSpanOptions = {},
): SourceSpan[] {
  const headingPattern = options.headingPattern ?? /^(?:SECTION|COVERAGE|EXCLUSION|EXCLUSIONS|CONDITION|CONDITIONS|ENDORSEMENT|ENDORSEMENTS|DEFINITION|DEFINITIONS|DECLARATIONS?|SCHEDULE|FORM)\b[\s:.-]*(.*)$/i;
  const minSectionChars = options.minSectionChars ?? 120;
  const spans: SourceSpan[] = [];

  for (const page of pages) {
    const sections = splitPageIntoSections(page.text, headingPattern, minSectionChars);
    for (const section of sections) {
      spans.push(buildSourceSpan(
        {
          documentId: page.documentId,
          sourceKind: page.sourceKind ?? "policy_pdf",
          text: section.text,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          sectionId: section.title,
          formNumber: inferFormNumber(section.text),
          sourceUnit: "section",
          metadata: {
            ...(page.metadata ?? {}),
            sourceUnit: "section_candidate",
          },
        },
        spans.length,
      ));
    }
  }

  return spans;
}

export function buildTextSourceSpans(input: SourceTextUnitInput, options: SourceChunkOptions = {}): SourceSpan[] {
  const maxChars = options.maxChars ?? 4000;
  const overlapChars = Math.min(options.overlapChars ?? 0, Math.max(0, maxChars - 1));
  const text = normalizeWhitespace(input.text);
  if (!text) return [];

  const spans: SourceSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + maxChars);
    const unitText = text.slice(cursor, end);
    spans.push(buildSourceSpan({ ...input, text: unitText }, spans.length));
    if (end === text.length) break;
    cursor = end - overlapChars;
  }

  return spans;
}

export function chunkSourceSpans(spans: SourceSpan[], options: SourceChunkOptions = {}): SourceChunk[] {
  const maxChars = options.maxChars ?? 6000;
  const chunks: SourceChunk[] = [];
  let current: SourceSpan[] = [];
  let currentLength = 0;
  const spansForChunking = filterChunkableSourceSpans(spans);

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((span) => span.text).join("\n\n");
    const textHash = sourceSpanTextHash(text);
    const pageStart = firstNumber(current.map((span) => span.pageStart));
    const pageEnd = lastNumber(current.map((span) => span.pageEnd ?? span.pageStart));
    const chunk: SourceChunk = {
      id: `${sanitizeIdPart(current[0].documentId)}:source_chunk:${chunks.length}:${stableHash({
        sourceSpanIds: current.map((span) => span.id),
        textHash,
      }).slice(0, 12)}`,
      documentId: current[0].documentId,
      sourceSpanIds: current.map((span) => span.id),
      text,
      textHash,
      pageStart,
      pageEnd,
      metadata: mergeMetadata(current),
    };
    chunks.push(SourceChunkSchema.parse(chunk));
    current = [];
    currentLength = 0;
  };

  for (const span of spansForChunking) {
    const nextLength = currentLength + span.text.length + (current.length > 0 ? 2 : 0);
    if (current.length > 0 && nextLength > maxChars) {
      flush();
    }
    current.push(span);
    currentLength += span.text.length + (current.length > 1 ? 2 : 0);
  }
  flush();

  return chunks;
}

export function normalizeSourceSpans(spans: SourceSpan[]): SourceSpan[] {
  const droppedParentSpanIds = new Set<string>();
  const cleaned: SourceSpanWithOriginalIndex[] = [];

  for (const [index, span] of spans.entries()) {
    if (span.parentSpanId && droppedParentSpanIds.has(span.parentSpanId)) continue;
    const normalized = normalizeSourceSpanText(span);
    if (!normalized) {
      droppedParentSpanIds.add(span.id);
      continue;
    }
    cleaned.push({ ...normalized, __originalIndex: index });
  }

  return mergeTextRuns(cleaned).map(({ __originalIndex: _index, ...span }) => span);
}

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
}

function spanPage(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.page ?? span.location?.startPage;
}

function normalizeSourceSpanText(span: SourceSpan): SourceSpan | undefined {
  const unit = sourceUnit(span);
  const text = normalizeWhitespace(span.text);
  if (!text) return undefined;
  if (isDiscardableBoilerplate(text, unit)) return undefined;

  const cleanedText = cleanBoilerplateLines(text);
  if (!cleanedText) return undefined;
  if (cleanedText === text) return span;

  return retextSpan(span, cleanedText, {
    boilerplateRemoved: "true",
    removedBoilerplateText: removedBoilerplateLines(text).join(" | ").slice(0, 500),
  });
}

function isDiscardableBoilerplate(text: string, unit?: string): boolean {
  const cleaned = normalizeWhitespace(text.replace(/\bColumn\s+\d+:\s*/gi, ""));
  if (/^SPECIMEN POLICY\s+[-—]\s+FOR TESTING ONLY$/i.test(cleaned)) return true;
  if (/^Page\s+\d+\s+of\s+\d+$/i.test(cleaned)) return true;
  if (/^[A-Z]{2,}(?:-[A-Z0-9]{2,})+\s+\d{2}\s+\d{2}$/i.test(cleaned)) return true;
  if (/^[A-Z]{2,}(?:-[A-Z0-9]{2,})+\s+\d{2}\s+\d{2}\s*\|\s*Page\s+\d+\s+of\s+\d+$/i.test(cleaned)) return true;
  if (unit === "table_row" && /^[^|]{0,40}\|\s*Page\s+\d+\s+of\s+\d+$/i.test(cleaned)) return true;
  return false;
}

function isBoilerplateLine(line: string): boolean {
  const cleaned = normalizeWhitespace(line.replace(/\bColumn\s+\d+:\s*/gi, ""));
  return isDiscardableBoilerplate(cleaned) ||
    /^THIS IS A CLAIMS-MADE AND REPORTED POLICY\.? PLEASE READ IT CAREFULLY\.?$/i.test(cleaned);
}

function removedBoilerplateLines(text: string): string[] {
  return text
    .split(/\s{2,}|\r?\n/)
    .map(normalizeWhitespace)
    .filter((line) => line && isBoilerplateLine(line));
}

function cleanBoilerplateLines(text: string): string {
  const withoutInlineBoilerplate = text
    .replace(/\b(?:Column\s+\d+:\s*)?[A-Z]{2,}(?:-[A-Z0-9]{2,})+\s+\d{2}\s+\d{2}\s+(?:\|\s*)?(?:Column\s+\d+:\s*)?Page\s+\d+\s+of\s+\d+\b/gi, " ")
    .replace(/\bSPECIMEN POLICY\s+[-—]\s+FOR TESTING ONLY\b/gi, " ")
    .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, " ");
  const lines = withoutInlineBoilerplate.split(/\r?\n/);
  const filtered = lines
    .map(normalizeWhitespace)
    .filter((line) => line && !isBoilerplateLine(line));
  return normalizeWhitespace(filtered.join(" "));
}

function shouldMergeTextSpan(left: SourceSpanWithOriginalIndex, right: SourceSpanWithOriginalIndex): boolean {
  if (sourceUnit(left) !== "text" || sourceUnit(right) !== "text") return false;
  if (spanPage(left) !== spanPage(right)) return false;
  if ((left.metadata?.elementType === "title") || (right.metadata?.elementType === "title")) return false;
  const leftText = normalizeWhitespace(left.text);
  const rightText = normalizeWhitespace(right.text);
  if (!leftText || !rightText) return false;
  if (/[:.;!?)]$/.test(leftText)) return false;
  if (/^(?:[A-Z][A-Z0-9 &/(),.-]{8,}|Item\s+\d+|Section\s+\d+|Part\s+[A-Z]\b)/.test(rightText)) return false;
  return /^[a-z(]/.test(rightText) ||
    /\b(?:a|an|and|any|as|at|by|for|from|in|into|may|must|of|or|that|the|this|to|with|within|you|your)$/i.test(leftText);
}

function mergeTextRuns(spans: SourceSpanWithOriginalIndex[]): SourceSpanWithOriginalIndex[] {
  const result: SourceSpanWithOriginalIndex[] = [];
  let current: SourceSpanWithOriginalIndex | undefined;

  for (const span of spans) {
    if (current && shouldMergeTextSpan(current, span)) {
      current = mergeTextSpanPair(current, span);
      continue;
    }
    if (current) result.push(current);
    current = span;
  }
  if (current) result.push(current);
  return result;
}

function mergeTextSpanPair(left: SourceSpanWithOriginalIndex, right: SourceSpanWithOriginalIndex): SourceSpanWithOriginalIndex {
  const text = normalizeWhitespace(`${left.text} ${right.text}`);
  const merged = retextSpan(left, text, {
    mergedSourceSpanIds: [left.metadata?.mergedSourceSpanIds, left.id, right.id, right.metadata?.mergedSourceSpanIds]
      .filter(Boolean)
      .join(","),
    sourceSpanNormalization: "merged_text_run",
  });
  return {
    ...merged,
    bbox: [...(left.bbox ?? []), ...(right.bbox ?? [])],
    pageEnd: right.pageEnd ?? left.pageEnd,
    location: {
      ...left.location,
      endPage: right.location?.endPage ?? right.pageEnd ?? left.location?.endPage,
    },
    __originalIndex: left.__originalIndex,
  };
}

function retextSpan(span: SourceSpan, text: string, metadata: Record<string, string>): SourceSpan {
  const textHash = sourceSpanTextHash(text);
  return SourceSpanSchema.parse({
    ...span,
    id: `${span.id.split(":").slice(0, -1).join(":")}:${textHash.slice(0, 12)}`,
    text,
    hash: textHash,
    textHash,
    metadata: {
      ...(span.metadata ?? {}),
      ...metadata,
    },
  });
}

function filterChunkableSourceSpans(spans: SourceSpan[]): SourceSpan[] {
  const rowIds = new Set(
    spans
      .filter((span) => sourceUnit(span) === "table_row")
      .map((span) => span.id),
  );
  if (rowIds.size === 0) return spans;
  return spans.filter((span) => {
    if (sourceUnit(span) !== "table_cell") return true;
    const rowId = span.parentSpanId ?? span.table?.rowSpanId ?? span.metadata?.rowSpanId;
    return !rowId || !rowIds.has(rowId);
  });
}

function splitPageIntoSections(
  text: string,
  headingPattern: RegExp,
  minSectionChars: number,
): Array<{ title: string; text: string }> {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(headingPattern);
    if (match) {
      if (current) sections.push(current);
      const suffix = match[1]?.trim();
      current = {
        title: normalizeWhitespace(suffix ? `${line}` : line).slice(0, 120),
        lines: [line],
      };
      continue;
    }
    current?.lines.push(rawLine);
  }
  if (current) sections.push(current);

  return sections
    .map((section) => ({
      title: section.title,
      text: normalizeWhitespace(section.lines.join("\n")),
    }))
    .filter((section) => section.text.length >= minSectionChars);
}

function inferFormNumber(text: string): string | undefined {
  return text.match(/\b[A-Z]{2,8}\s+\d{2,5}(?:\s+\d{2,4})?\b/)?.[0];
}

function firstNumber(values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => typeof value === "number");
}

function lastNumber(values: Array<number | undefined>): number | undefined {
  return [...values].reverse().find((value): value is number => typeof value === "number");
}

function mergeMetadata(spans: SourceSpan[]): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const span of spans) {
    for (const [key, value] of Object.entries(span.metadata ?? {})) {
      metadata[key] = metadata[key] ? `${metadata[key]},${value}` : value;
    }
    if (span.formNumber) metadata.formNumber = span.formNumber;
    if (span.sectionId) metadata.sectionId = span.sectionId;
    if (span.sourceKind) metadata.sourceKind = span.sourceKind;
  }
  return metadata;
}
