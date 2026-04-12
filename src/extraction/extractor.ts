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

  const pagesPdf = await extractPageRange(pdfBase64, startPage, endPage);

  const fullPrompt = convertPdfToImages
    ? `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as images above.]`
    : `${prompt}\n\n[Document pages ${startPage}-${endPage} are provided as a PDF file above.]`;

  const strictSchema = toStrictSchema(schema) as typeof schema;

  const result = await withRetry(() =>
    generateObject({
      prompt: fullPrompt,
      schema: strictSchema,
      maxTokens,
      providerOptions,
    })
  );

  return {
    name,
    data: result.object,
    usage: result.usage,
  };
}
