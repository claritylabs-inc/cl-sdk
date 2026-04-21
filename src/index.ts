// src/index.ts — v6 barrel exports

// ── Core types ──
export type { GenerateText, GenerateObject, EmbedText, ConvertPdfToImagesFn, TokenUsage, LogFn, PdfInput } from "./core/types";

// ── Core utilities ──
export { withRetry } from "./core/retry";
export { pLimit } from "./core/concurrency";
export { stripFences } from "./core/strip-fences";
export { sanitizeNulls } from "./core/sanitize";
export { safeGenerateObject } from "./core/safe-generate";
export type { SafeGenerateOptions, SafeGenerateParams } from "./core/safe-generate";
export { toStrictSchema } from "./core/strict-schema";
export { createPipelineContext } from "./core/pipeline";
export type { PipelineCheckpoint, PipelineContext, PipelineContextOptions } from "./core/pipeline";

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
export type { ExtractorConfig, ExtractionResult, ExtractionState, ExtractOptions } from "./extraction/coordinator";
export { chunkDocument } from "./extraction/chunking";

// ── PDF operations ──
export {
  getAcroFormFields,
  fillAcroForm,
  overlayTextOnPdf,
  extractPageRange,
  getPdfPageCount,
  pdfInputToBytes,
  pdfInputToBase64,
  isFileReference,
  getFileIdentifier,
} from "./extraction/pdf";
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

// ── Application pipeline ──
export { createApplicationPipeline } from "./application/coordinator";
export type {
  ApplicationPipelineConfig,
  ProcessApplicationInput,
  ProcessApplicationResult,
  ProcessReplyInput,
  ProcessReplyResult,
} from "./application/types";
export type { ApplicationStore, ApplicationListFilters, BackfillProvider, PriorAnswer } from "./application/store";
export * from "./schemas/application";

// ── Application prompts (for advanced use) ──
export * from "./prompts/application/index";

// ── Query agent pipeline ──
export { createQueryAgent } from "./query/coordinator";
export type { QueryConfig, QueryInput, QueryOutput } from "./query/types";
export * from "./schemas/query";

// ── Query prompts ──
export { buildQueryClassifyPrompt } from "./prompts/query/classify";
export { buildInterpretAttachmentPrompt } from "./prompts/query/interpret-attachment";
export { buildReasonPrompt } from "./prompts/query/reason";
export { buildVerifyPrompt } from "./prompts/query/verify";
export { buildRespondPrompt } from "./prompts/query/respond";

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
