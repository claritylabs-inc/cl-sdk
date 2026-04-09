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
 *   Anthropic models, `image` for others. Non-Anthropic models require a
 *   `convertPdfToImages` callback.
 *
 * - `anthropic-file`: Anthropic's native PDF file format `{ type: "file", data, mediaType }`.
 *   Only works with Anthropic/Claude models. Best quality and most efficient.
 *
 * - `image`: Convert PDF pages to base64-encoded images. Works with most providers
 *   (OpenAI, Kimi, DeepSeek, etc.) that support vision/image inputs. Requires
 *   providing `convertPdfToImages` callback.
 */
export type PdfContentFormat = "auto" | "anthropic-file" | "image";

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

/** Token limits per extraction role. All fields optional — defaults applied by resolveTokenLimits. */
export type TokenLimits = {
  classification?: number;
  metadata?: number;
  sections?: number;
  sectionsFallback?: number;
  enrichment?: number;
};

/** Default token limits per role. Override via ExtractOptions.tokenLimits. */
export const DEFAULT_TOKEN_LIMITS: Required<TokenLimits> = {
  classification: 512,
  metadata: 16384,
  sections: 8192,
  sectionsFallback: 16384,
  enrichment: 4096,
};

/** Resolve token limits with overrides merged over defaults. */
export function resolveTokenLimits(overrides?: TokenLimits): Required<TokenLimits> {
  return {
    classification: overrides?.classification ?? 512,
    metadata: overrides?.metadata ?? 16384,
    sections: overrides?.sections ?? 8192,
    sectionsFallback: overrides?.sectionsFallback ?? 16384,
    enrichment: overrides?.enrichment ?? 4096,
  };
}

/**
 * @deprecated Use DEFAULT_TOKEN_LIMITS instead. Kept for backward compatibility.
 */
export const MODEL_TOKEN_LIMITS = DEFAULT_TOKEN_LIMITS;