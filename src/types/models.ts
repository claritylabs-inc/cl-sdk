import type { LanguageModel } from "ai";

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