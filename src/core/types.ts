import type { ZodSchema } from "zod";

/** Callback to generate text from a prompt. Provider-agnostic. */
export type GenerateText = (params: {
  prompt: string;
  system?: string;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{
  text: string;
  usage?: TokenUsage;
}>;

/**
 * Callback to generate a typed object from a prompt + Zod schema. Provider-agnostic.
 *
 * The extraction pipeline passes document content via `providerOptions`:
 * - `providerOptions.pdfBase64` — base64-encoded PDF to include as document context
 * - `providerOptions.images` — `Array<{ imageBase64: string; mimeType: string }>` page images
 *
 * Your callback should check for these fields and include them as multi-part
 * message content (e.g. file/image parts) when calling your AI provider.
 */
export type GenerateObject<T = unknown> = (params: {
  prompt: string;
  system?: string;
  schema: ZodSchema<T>;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{
  object: T;
  usage?: TokenUsage;
}>;

/** Callback to generate embeddings for text. */
export type EmbedText = (text: string) => Promise<number[]>;

/** Callback to convert PDF pages to base64-encoded images. */
export type ConvertPdfToImagesFn = (
  pdfBase64: string,
  startPage: number,
  endPage: number,
) => Promise<Array<{ imageBase64: string; mimeType: string }>>;

/** Token usage reported by model calls. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Logging function for pipeline status messages. */
export type LogFn = (message: string) => Promise<void>;
