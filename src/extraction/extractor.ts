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
  pdfInput: PdfInput;
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
  for (const span of spans) {
    const header = `[sourceSpan:${span.id}${span.pageStart ? ` page:${span.pageStart}${span.pageEnd && span.pageEnd !== span.pageStart ? `-${span.pageEnd}` : ""}` : ""}${span.sectionId ? ` section:${span.sectionId}` : ""}${span.formNumber ? ` form:${span.formNumber}` : ""}]`;
    const text = `${header}\n${span.text}`;
    if (length + text.length > maxChars && lines.length > 0) break;
    lines.push(text);
    length += text.length;
  }
  return `\n\nSOURCE SPANS FOR THESE PAGES:\n${lines.join("\n\n")}\n\nUse sourceSpan IDs when grounding extracted contractual values.`;
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

  // Convert PdfInput to base64 for image conversion or page extraction
  // FileId references cannot be used for partial page extraction
  const needsPdfBase64 = (convertPdfToImages && !params.getPageImages) || (!convertPdfToImages && !params.getPageRangePdf);
  const pdfBase64 = needsPdfBase64 ? await pdfInputToBase64(pdfInput) : undefined;

  if (convertPdfToImages) {
    const images = params.getPageImages
      ? await params.getPageImages(startPage, endPage)
      : await convertPdfToImages(pdfBase64!, startPage, endPage);
    extractorProviderOptions.images = images;
    fullPrompt = `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as images.]`;
  } else {
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
      providerOptions: extractorProviderOptions,
    })
  );

  return {
    name,
    data: result.object,
    usage: result.usage,
  };
}
