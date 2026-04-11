// src/index.ts — v6 barrel exports

// ── Core types ──
export type { GenerateText, GenerateObject, EmbedText, ConvertPdfToImagesFn, TokenUsage, LogFn } from "./core/types";

// ── Core utilities ──
export { withRetry } from "./core/retry";
export { pLimit } from "./core/concurrency";
export { stripFences } from "./core/strip-fences";
export { sanitizeNulls } from "./core/sanitize";

// ── Schemas (Zod) + derived types ──
export * from "./schemas/enums";
export * from "./schemas/shared";
export * from "./schemas/coverage";
export * from "./schemas/endorsement";
export * from "./schemas/exclusion";
export * from "./schemas/condition";
export * from "./schemas/parties";
export * from "./schemas/financial";
export * from "./schemas/loss-history";
export * from "./schemas/underwriting";
export * from "./schemas/declarations/index";
export * from "./schemas/document";
export * from "./schemas/platform";
export type { ContextKeyMapping } from "./schemas/context-keys";
export { CONTEXT_KEY_MAP } from "./schemas/context-keys";

// ── Extraction pipeline ──
export { createExtractor } from "./extraction/coordinator";
export type { ExtractorConfig, ExtractionResult } from "./extraction/coordinator";
export { chunkDocument } from "./extraction/chunking";

// ── PDF operations ──
export { getAcroFormFields, fillAcroForm, overlayTextOnPdf, extractPageRange, getPdfPageCount } from "./extraction/pdf";
export type { AcroFormFieldInfo, FieldMapping, TextOverlay } from "./extraction/pdf";

// ── Storage interfaces ──
export type { DocumentStore, MemoryStore } from "./storage/interfaces";
export type { DocumentChunk, ConversationTurn, ChunkFilter, DocumentFilters } from "./storage/chunk-types";

// ── Agent prompts ──
export {
  buildAgentSystemPrompt,
  buildIdentityPrompt,
  buildSafetyPrompt,
  buildFormattingPrompt,
  buildCoverageGapPrompt,
  buildCoiRoutingPrompt,
  buildQuotesPoliciesPrompt,
  buildConversationMemoryGuidance,
  buildIntentPrompt,
} from "./prompts/agent/index";

// ── Application prompts ──
export * from "./prompts/application/index";

// ── Intent classification ──
export { buildClassifyMessagePrompt } from "./prompts/intent";

// ── Tool definitions ──
export type { ToolDefinition } from "./tools/definitions";
export { DOCUMENT_LOOKUP_TOOL, COI_GENERATION_TOOL, COVERAGE_COMPARISON_TOOL, AGENT_TOOLS } from "./tools/definitions";

// ── Extraction prompts (for advanced use) ──
export { getExtractor } from "./prompts/extractors/index";
export type { ExtractorDef } from "./prompts/extractors/index";
export { getTemplate } from "./prompts/templates/index";
export type { DocumentTemplate } from "./prompts/templates/index";
