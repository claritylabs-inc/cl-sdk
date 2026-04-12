import type { ZodSchema } from "zod";
import type { GenerateObject, TokenUsage, ConvertPdfToImagesFn } from "../core/types";
import { withRetry } from "../core/retry";
import { toStrictSchema } from "../core/strict-schema";
import { extractPageRange } from "./pdf";

export interface ExtractorParams<T> {
  name: string;
  prompt: string;
  schema: ZodSchema<T>;
  pdfBase64: string;
  startPage: number;
  endPage: number;
  generateObject: GenerateObject<T>;
  convertPdfToImages?: ConvertPdfToImagesFn;
  maxTokens?: number;
  providerOptions?: Record<string, unknown>;
}

export interface ExtractorResult<T> {
  name: string;
  data: T;
  usage?: TokenUsage;
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
    pdfBase64,
    startPage,
    endPage,
    generateObject,
    convertPdfToImages,
    maxTokens = 4096,
    providerOptions,
  } = params;

  // Build provider options with PDF content for the model
  const extractorProviderOptions: Record<string, unknown> = { ...providerOptions };
  let fullPrompt: string;

  if (convertPdfToImages) {
    const images = await convertPdfToImages(pdfBase64, startPage, endPage);
    extractorProviderOptions.images = images;
    fullPrompt = `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as images.]`;
  } else {
    const pagesPdf = await extractPageRange(pdfBase64, startPage, endPage);
    extractorProviderOptions.pdfBase64 = pagesPdf;
    fullPrompt = `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as a PDF file.]`;
  }

  const strictSchema = toStrictSchema(schema) as typeof schema;

  const result = await withRetry(() =>
    generateObject({
      prompt: fullPrompt,
      schema: strictSchema,
      maxTokens,
      providerOptions: extractorProviderOptions,
    })
  );

  return {
    name,
    data: result.object,
    usage: result.usage,
  };
}
