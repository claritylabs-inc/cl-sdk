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

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
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
