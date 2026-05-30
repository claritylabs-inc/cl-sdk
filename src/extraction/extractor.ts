import type { ZodSchema } from "zod";
import type { GenerateObject, TokenUsage, ConvertPdfToImagesFn, PdfInput } from "../core/types";
import type { ModelBudgetResolution, ModelTaskKind } from "../core/model-budget";
import { withRetry } from "../core/retry";
import { toStrictSchema } from "../core/strict-schema";
import { extractPageRange, pdfInputToBase64 } from "./pdf";
import type { SourceSpan } from "../source";

export type PageRangeImage = { imageBase64: string; mimeType: string };

export interface ExtractorParams<T> {
  name: string;
  prompt: string;
  schema: ZodSchema<T>;
  /** PDF input as base64 string, URL, bytes, or fileId reference */
  pdfInput?: PdfInput;
  startPage: number;
  endPage: number;
  generateObject: GenerateObject<T>;
  convertPdfToImages?: ConvertPdfToImagesFn;
  maxTokens?: number;
  taskKind?: ModelTaskKind;
  budgetDiagnostics?: ModelBudgetResolution;
  providerOptions?: Record<string, unknown>;
  pageRangeCache?: Map<string, string>;
  getPageRangePdf?: (startPage: number, endPage: number) => Promise<string>;
  getPageImages?: (startPage: number, endPage: number) => Promise<PageRangeImage[]>;
  getPageRangeText?: (startPage: number, endPage: number) => Promise<string>;
}

export interface ExtractorResult<T> {
  name: string;
  data: T;
  usage?: TokenUsage;
}

function sourceSpansForPageRange(
  providerOptions: Record<string, unknown> | undefined,
  startPage: number,
  endPage: number,
): SourceSpan[] {
  const sourceSpans = providerOptions?.sourceSpans;
  if (!Array.isArray(sourceSpans)) return [];
  return (sourceSpans as SourceSpan[]).filter((span) => {
    const spanStart = span.pageStart ?? span.location?.startPage ?? span.location?.page;
    const spanEnd = span.pageEnd ?? span.location?.endPage ?? spanStart;
    if (!spanStart || !spanEnd) return false;
    return spanEnd >= startPage && spanStart <= endPage;
  });
}

function buildSourceContext(spans: SourceSpan[], maxChars = 12_000): string {
  if (spans.length === 0) return "";
  const lines: string[] = [];
  let length = 0;
  for (const span of orderSourceSpansForContext(spans)) {
    const unit = sourceUnit(span);
    const table = span.table;
    const tableContext = [
      unit ? ` unit:${unit}` : "",
      table?.tableId ? ` table:${table.tableId}` : "",
      table?.rowIndex != null ? ` row:${table.rowIndex}` : "",
      table?.columnIndex != null ? ` col:${table.columnIndex}` : "",
      table?.columnName ? ` column:${table.columnName}` : "",
      span.parentSpanId ? ` parent:${span.parentSpanId}` : "",
    ].join("");
    const header = `[sourceSpan:${span.id}${span.pageStart ? ` page:${span.pageStart}${span.pageEnd && span.pageEnd !== span.pageStart ? `-${span.pageEnd}` : ""}` : ""}${span.sectionId ? ` section:${span.sectionId}` : ""}${span.formNumber ? ` form:${span.formNumber}` : ""}${tableContext}]`;
    const text = `${header}\n${span.text}`;
    if (length + text.length > maxChars && lines.length > 0) break;
    lines.push(text);
    length += text.length;
  }
  return `\n\nSOURCE SPANS FOR THESE PAGES:\n${lines.join("\n\n")}\n\nUse sourceSpan IDs when grounding extracted contractual values.`;
}

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
}

function sourceContextRank(span: SourceSpan): number {
  switch (sourceUnit(span)) {
    case "table_row":
      return 0;
    case "table":
      return 1;
    case "section":
      return 2;
    case "page":
      return 3;
    case "key_value":
      return 4;
    case "table_cell":
      return 8;
    default:
      return 5;
  }
}

function orderSourceSpansForContext(spans: SourceSpan[]): SourceSpan[] {
  const parentRows = new Set(
    spans
      .filter((span) => sourceUnit(span) === "table_row")
      .map((span) => span.id),
  );
  const filtered = spans.filter((span) => {
    if (sourceUnit(span) !== "table_cell") return true;
    const parent = span.parentSpanId ?? span.table?.rowSpanId ?? span.metadata?.rowSpanId;
    return !parent || !parentRows.has(parent);
  });
  return [...filtered].sort((left, right) => {
    const leftPage = left.pageStart ?? left.location?.startPage ?? left.location?.page ?? 0;
    const rightPage = right.pageStart ?? right.location?.startPage ?? right.location?.page ?? 0;
    if (leftPage !== rightPage) return leftPage - rightPage;
    const leftRank = sourceContextRank(left);
    const rightRank = sourceContextRank(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftRow = left.table?.rowIndex ?? Number(left.metadata?.rowIndex ?? Number.NaN);
    const rightRow = right.table?.rowIndex ?? Number(right.metadata?.rowIndex ?? Number.NaN);
    if (Number.isFinite(leftRow) && Number.isFinite(rightRow) && leftRow !== rightRow) return leftRow - rightRow;
    return left.id.localeCompare(right.id);
  });
}

/**
 * Run a single focused extractor against a page range of a PDF.
 *
 * The PDF content is passed to `generateObject` via `providerOptions`:
 * - If `convertPdfToImages` is provided: converts pages to images, passes as `providerOptions.images`
 * - Otherwise: extracts the page range as PDF, passes as `providerOptions.pdfBase64`
 *
 * The consumer's `generateObject` callback must handle these fields to deliver
 * the document content to the model (e.g. as multi-part message content).
 */
export async function runExtractor<T>(params: ExtractorParams<T>): Promise<ExtractorResult<T>> {
  const {
    name,
    prompt,
    schema,
    pdfInput,
    startPage,
    endPage,
    generateObject,
    convertPdfToImages,
    maxTokens = 4096,
    taskKind,
    budgetDiagnostics,
    providerOptions,
    pageRangeCache,
  } = params;

  // Build provider options with PDF content for the model
  const extractorProviderOptions: Record<string, unknown> = { ...providerOptions };
  let fullPrompt: string;

  if (params.getPageRangeText) {
    const pageText = await params.getPageRangeText(startPage, endPage);
    extractorProviderOptions.doclingText = pageText;
    extractorProviderOptions.doclingPageRange = { startPage, endPage };
    fullPrompt = `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided below as Docling-extracted text.]\n\n${pageText || "(No Docling text was available for this page range.)"}`;
  } else if (convertPdfToImages) {
    if (!pdfInput) {
      throw new Error("pdfInput is required when extracting page images.");
    }
    const needsPdfBase64 = !params.getPageImages;
    const pdfBase64 = needsPdfBase64 ? await pdfInputToBase64(pdfInput) : undefined;
    const images = params.getPageImages
      ? await params.getPageImages(startPage, endPage)
      : await convertPdfToImages(pdfBase64!, startPage, endPage);
    extractorProviderOptions.images = images;
    fullPrompt = `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as images.]`;
  } else {
    if (!pdfInput) {
      throw new Error("pdfInput is required when extracting page PDFs.");
    }
    // Convert PdfInput to base64 for page extraction. FileId references cannot
    // be used for partial page extraction.
    const pdfBase64 = params.getPageRangePdf ? undefined : await pdfInputToBase64(pdfInput);
    const cacheKey = `${startPage}-${endPage}`;
    const cachedPagesPdf = pageRangeCache?.get(cacheKey);
    const pagesPdf = cachedPagesPdf
      ?? (params.getPageRangePdf
        ? await params.getPageRangePdf(startPage, endPage)
        : await extractPageRange(pdfBase64!, startPage, endPage));
    if (!cachedPagesPdf) pageRangeCache?.set(cacheKey, pagesPdf);
    extractorProviderOptions.pdfBase64 = pagesPdf;
    fullPrompt = `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as a PDF file.]`;
  }

  const sourceContext = buildSourceContext(sourceSpansForPageRange(providerOptions, startPage, endPage));
  if (sourceContext) {
    fullPrompt += sourceContext;
  }

  const strictSchema = toStrictSchema(schema) as typeof schema;

  const result = await withRetry(() =>
    generateObject({
      prompt: fullPrompt,
      schema: strictSchema,
      maxTokens,
      taskKind,
      budgetDiagnostics,
      trace: {
        label: `${name} pages ${startPage}-${endPage}`,
        extractorName: name,
        startPage,
        endPage,
        phase: "extractor",
        sourceBacked: !!sourceContext,
      },
      providerOptions: extractorProviderOptions,
    })
  );

  return {
    name,
    data: result.object,
    usage: result.usage,
  };
}
