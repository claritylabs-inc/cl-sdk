// Types - Documents
export type {
  Coverage,
  Subsection,
  Section,
  Subjectivity,
  UnderwritingCondition,
  PremiumLine,
  BaseDocument,
  PolicyDocument,
  QuoteDocument,
  InsuranceDocument,
} from "./types/document";

// Types - Platform
export type {
  Platform,
  CommunicationIntent,
  PlatformConfig,
  AgentContext,
} from "./types/platform";

export { PLATFORM_CONFIGS } from "./types/platform";

// Types - Models
export type { ModelConfig } from "./types/models";
export { createUniformModelConfig, createDefaultModelConfig, MODEL_TOKEN_LIMITS } from "./types/models";

// Extraction Prompts
export {
  EXTRACTION_PROMPT,
  CLASSIFY_DOCUMENT_PROMPT,
  METADATA_PROMPT,
  QUOTE_METADATA_PROMPT,
  buildSectionsPrompt,
  buildPolicySectionsPrompt,
  buildQuoteSectionsPrompt,
  buildSupplementaryEnrichmentPrompt,
} from "./prompts/extraction";

// Application Prompts
export {
  APPLICATION_CLASSIFY_PROMPT,
  buildFieldExtractionPrompt,
  buildAutoFillPrompt,
  buildQuestionBatchPrompt,
  buildAnswerParsingPrompt,
  buildConfirmationSummaryPrompt,
  buildBatchEmailGenerationPrompt,
  buildReplyIntentClassificationPrompt,
  buildFieldExplanationPrompt,
  buildFlatPdfMappingPrompt,
  buildAcroFormMappingPrompt,
  buildLookupFillPrompt,
} from "./prompts/application";

// Agent System (new API)
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

// Agent System (legacy, deprecated)
export {
  buildSystemPrompt,
  buildPolicyContext,
  buildDocumentContext,
  buildConversationMemoryContext,
} from "./prompts/agent";

// Intent Classification
export { buildClassifyMessagePrompt } from "./prompts/intent";

// Intent Classification (legacy, deprecated)
export { CLASSIFY_EMAIL_PROMPT } from "./prompts/classifier";

// Tool Definitions
export type { ToolDefinition } from "./tools/index";
export {
  DOCUMENT_LOOKUP_TOOL,
  COI_GENERATION_TOOL,
  COVERAGE_COMPARISON_TOOL,
  AGENT_TOOLS,
} from "./tools/index";

// Extraction Pipeline
export {
  SONNET_MODEL,
  HAIKU_MODEL,
  stripFences,
  sanitizeNulls,
  applyExtracted,
  applyExtractedQuote,
  mergeChunkedSections,
  mergeChunkedQuoteSections,
  getPageChunks,
  enrichSupplementaryFields,
  classifyDocumentType,
  extractFromPdf,
  extractSectionsOnly,
  extractQuoteFromPdf,
} from "./extraction/pipeline";

export type { LogFn, PromptBuilder, ExtractOptions, ExtractSectionsOptions, ClassifyOptions, TokenUsage } from "./extraction/pipeline";

// PDF Operations
export {
  getAcroFormFields,
  fillAcroForm,
  overlayTextOnPdf,
} from "./extraction/pdf";

export type {
  AcroFormFieldInfo,
  FieldMapping,
  TextOverlay,
} from "./extraction/pdf";
