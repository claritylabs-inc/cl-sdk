import type { ZodSchema } from "zod";

/**
 * PDF input format that supports multiple delivery methods.
 * This allows consumers to use memory-efficient file APIs (OpenAI Files API,
 * Anthropic document blocks) instead of base64 encoding when desired.
 *
 * - `string` — base64-encoded PDF (backward compatible, default)
 * - `URL` — file:// or https:// URL to the PDF
 * - `Uint8Array` — raw PDF bytes
 * - `{ fileId: string }` — provider-specific file reference (e.g., OpenAI file_id)
 */
export type PdfInput =
  | string
  | URL
  | Uint8Array
  | { fileId: string; mimeType?: string };

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
 * The extraction and query pipelines may pass document content via `providerOptions`:
 * - `providerOptions.pdfBase64` — base64-encoded PDF to include as document context
 * - `providerOptions.pdfUrl` — `URL` object (file:// or https://) for file-based APIs
 * - `providerOptions.pdfBytes` — `Uint8Array` of raw PDF bytes
 * - `providerOptions.fileId` — provider-specific file reference (e.g., OpenAI file_id)
 * - `providerOptions.images` — `Array<{ imageBase64: string; mimeType: string }>` page images
 * - `providerOptions.attachments` — generic multimodal attachments such as
 *   `Array<{ kind: "image" | "pdf" | "text"; name?: string; mimeType?: string; base64?: string; text?: string; description?: string }>`
 *
 * Your callback should check for these fields and include them as multi-part
 * message content (e.g. file/image parts) when calling your AI provider.
 *
 * For memory-efficient file handling, check `providerOptions.fileId` or `providerOptions.pdfUrl`
 * first before falling back to `pdfBase64`. This allows you to use native Files APIs when available.
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
