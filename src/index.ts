// Prompts
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

export {
  buildSystemPrompt,
  buildPolicyContext,
  buildDocumentContext,
  buildConversationMemoryContext,
} from "./prompts/agent";

export { CLASSIFY_EMAIL_PROMPT } from "./prompts/classifier";

// Extraction pipeline
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
  callClaude,
  callClaudeText,
  enrichSupplementaryFields,
  classifyDocumentType,
  extractFromPdf,
  extractSectionsOnly,
  extractQuoteFromPdf,
} from "./extraction/pipeline";

export type { LogFn, PromptBuilder } from "./extraction/pipeline";

// PDF filling
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

// Types — policy
export {
  POLICY_TYPE_LABELS,
  INSURANCE_KEYWORDS,
  POLICY_SECTION_TYPE_LABELS,
  POLICY_SECTION_TYPE_COLORS,
  QUOTE_SECTION_TYPE_LABELS,
  QUOTE_SECTION_TYPE_COLORS,
  INSURANCE_SENDER_PATTERNS,
} from "./types/policy";

export type { PolicyDocument, QuoteDocument } from "./types/policy";

// Types — application
export {
  isTableField,
  isDeclarationField,
  isConditionalField,
} from "./types/application";

export type {
  FieldType,
  SimpleField,
  TableField,
  DeclarationField,
  FormField,
  QuestionBatch,
} from "./types/application";

// Types — industry
export { INDUSTRIES } from "./types/industry";
export type { Industry, Vertical } from "./types/industry";
