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

// Types - Enums
export type {
  PolicyType,
  EndorsementType,
  ConditionType,
  PolicySectionType,
  QuoteSectionType,
  CoverageForm,
  PolicyTermType,
  CoverageTrigger,
  LimitType,
  DeductibleType,
  ValuationMethod,
  DefenseCostTreatment,
  EntityType,
  AdmittedStatus,
  AuditType,
  EndorsementPartyRole,
  ClaimStatus,
  SubjectivityCategory,
  DocumentType,
  ChunkType,
  RatingBasisType,
  VehicleCoverageType,
  HomeownersFormType,
  DwellingFireFormType,
  FloodZone,
  ConstructionType,
  RoofType,
  FoundationType,
  PersonalAutoUsage,
  LossSettlement,
  BoatType,
  RVType,
  ScheduledItemCategory,
  TitlePolicyType,
  PetSpecies,
} from "./types/enums";

export { POLICY_TYPES } from "./types/enums";

// Types - Shared
export type {
  Address,
  Contact,
  FormReference,
  TaxFeeItem,
  RatingBasis,
  Sublimit,
  SharedLimit,
  ExtendedReportingPeriod,
  NamedInsured,
} from "./types/shared";

// Types - Declarations
export type {
  LimitSchedule,
  DeductibleSchedule,
  EmployersLiabilityLimits,
  InsuredLocation,
  InsuredVehicle,
  VehicleCoverage,
  ClassificationCode,
} from "./types/declarations";

// Types - Declarations (typed union, v1.3+)
export type {
  Declarations,
  DwellingDetails,
  DriverRecord,
  PersonalVehicleDetails,
  HomeownersDeclarations,
  PersonalAutoDeclarations,
  DwellingFireDeclarations,
  FloodDeclarations,
  EarthquakeDeclarations,
  PersonalUmbrellaDeclarations,
  PersonalArticlesDeclarations,
  WatercraftDeclarations,
  RecreationalVehicleDeclarations,
  FarmRanchDeclarations,
  TitleDeclarations,
  PetDeclarations,
  TravelDeclarations,
  IdentityTheftDeclarations,
  GLDeclarations,
  CommercialPropertyDeclarations,
  CommercialAutoDeclarations,
  WorkersCompDeclarations,
  UmbrellaExcessDeclarations,
  ProfessionalLiabilityDeclarations,
  CyberDeclarations,
  DODeclarations,
  CrimeDeclarations,
} from "./types/declarations/index";

// Types - Coverage
export type { EnrichedCoverage } from "./types/coverage";

// Types - Endorsement
export type { Endorsement, EndorsementParty } from "./types/endorsement";

// Types - Exclusion
export type { Exclusion } from "./types/exclusion";

// Types - Condition
export type { PolicyCondition } from "./types/condition";

// Types - Parties
export type { InsurerInfo, ProducerInfo } from "./types/parties";

// Types - Financial
export type { PaymentPlan, PaymentInstallment, LocationPremium } from "./types/financial";

// Types - Loss History
export type { LossSummary, ClaimRecord, ExperienceMod } from "./types/loss-history";

// Types - Underwriting
export type { EnrichedSubjectivity, EnrichedUnderwritingCondition, BindingAuthority } from "./types/underwriting";

// Types - Context Keys
export type { ContextKeyMapping } from "./types/context-keys";
export { CONTEXT_KEY_MAP } from "./types/context-keys";

// Types - Platform
export type {
  Platform,
  CommunicationIntent,
  PlatformConfig,
  AgentContext,
} from "./types/platform";

export { PLATFORM_CONFIGS } from "./types/platform";

// Types - Models
export type { ModelConfig, PdfContentFormat, ConvertPdfToImagesFn, TokenLimits } from "./types/models";
export { createUniformModelConfig, MODEL_TOKEN_LIMITS, DEFAULT_TOKEN_LIMITS, resolveTokenLimits, supportsNativePdf, isAnthropicModel } from "./types/models";

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
  buildPersonalLinesHint,
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
  extractPageRange,
  getPdfPageCount,
} from "./extraction/pdf";

export type {
  AcroFormFieldInfo,
  FieldMapping,
  TextOverlay,
} from "./extraction/pdf";
