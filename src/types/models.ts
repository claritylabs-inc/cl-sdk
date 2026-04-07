import type { LanguageModel } from "ai";

/**
 * Detect if a LanguageModel is from Anthropic based on its provider ID.
 */
export function isAnthropicModel(model: LanguageModel): boolean {
  const provider = (model as any).provider || (model as any).providerId || "";
  return provider.toLowerCase().includes("anthropic");
}

export interface ModelConfig {
  /** Pass 0: document type classification (fast, cheap model) */
  classification: LanguageModel;
  /** Pass 1: metadata extraction (capable model) */
  metadata: LanguageModel;
  /** Pass 2: chunked section extraction (fast, cheap model) */
  sections: LanguageModel;
  /** Pass 2 fallback when sections model truncates */
  sectionsFallback: LanguageModel;
  /** Pass 3: supplementary field enrichment (fast, cheap model) */
  enrichment: LanguageModel;
}

/**
 * Format for sending PDF content to the model.
 *
 * - `auto` (default): Auto-detect based on model provider. Uses `anthropic-file` for
 *   Anthropic models, `image` for others (if convertPdfToImages provided), else `text`.
 *
 * - `anthropic-file`: Anthropic's native PDF file format `{ type: "file", data, mediaType }`.
 *   Only works with Anthropic/Claude models. Best quality and most efficient.
 *
 * - `image`: Convert PDF pages to base64-encoded images. Works with most providers
 *   (OpenAI, Kimi, DeepSeek, etc.) that support vision/image inputs. Requires
 *   providing `convertPdfToImages` callback.
 *
 * - `text`: Extract text from PDF and send as text content. Universal compatibility
 *   but loses visual layout information (tables, formatting).
 */
export type PdfContentFormat = "auto" | "anthropic-file" | "image" | "text";

/**
 * Callback function to convert PDF pages to base64-encoded images.
 *
 * @param pdfBase64 - Base64-encoded PDF document
 * @param startPage - First page to convert (1-indexed)
 * @param endPage - Last page to convert (1-indexed)
 * @returns Array of base64-encoded images (one per page) with MIME type
 */
export type ConvertPdfToImagesFn = (
  pdfBase64: string,
  startPage: number,
  endPage: number,
) => Promise<Array<{ imageBase64: string; mimeType: string }>>;

/** Create a ModelConfig where every role uses the same model. */
export function createUniformModelConfig(model: LanguageModel): ModelConfig {
  return {
    classification: model,
    metadata: model,
    sections: model,
    sectionsFallback: model,
    enrichment: model,
  };
}

/** Token limits per role — determined by the task, not the provider. */
export const MODEL_TOKEN_LIMITS = {
  classification: 512,
  metadata: 4096,
  sections: 8192,
  sectionsFallback: 16384,
  enrichment: 4096,
} as const;