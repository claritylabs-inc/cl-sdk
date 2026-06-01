import { z } from "zod";
import {
  EntityTypeSchema,
  CoverageFormSchema,
  PolicyTermTypeSchema,
  AuditTypeSchema,
} from "./enums";
import {
  AddressSchema,
  ContactSchema,
  FormReferenceSchema,
  TaxFeeItemSchema,
  RatingBasisSchema,
  NamedInsuredSchema,
  ExtendedReportingPeriodSchema,
} from "./shared";
import { CoverageSchema, EnrichedCoverageSchema } from "./coverage";
import { EndorsementSchema, EndorsementPartySchema } from "./endorsement";
import { ExclusionSchema } from "./exclusion";
import { PolicyConditionSchema } from "./condition";
import {
  LimitScheduleSchema,
  DeductibleScheduleSchema,
  InsuredLocationSchema,
  InsuredVehicleSchema,
  ClassificationCodeSchema,
} from "./declarations";
import { DeclarationsSchema } from "./declarations/index";
import { InsurerInfoSchema, ProducerInfoSchema } from "./parties";
import { PaymentPlanSchema, LocationPremiumSchema } from "./financial";
import { LossSummarySchema, ClaimRecordSchema, ExperienceModSchema } from "./loss-history";
import {
  EnrichedSubjectivitySchema,
  EnrichedUnderwritingConditionSchema,
  BindingAuthoritySchema,
} from "./underwriting";

// ── Legacy inline schemas ──

export const SubsectionSchema = z.object({
  title: z.string(),
  sectionNumber: z.string().optional(),
  pageNumber: z.number().optional(),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type Subsection = z.infer<typeof SubsectionSchema>;

export const SectionSchema = z.object({
  title: z.string(),
  sectionNumber: z.string().optional(),
  pageStart: z.number(),
  pageEnd: z.number().optional(),
  type: z.string(),
  coverageType: z.string().optional(),
  excerpt: z.string().optional(),
  content: z.string().optional(),
  subsections: z.array(SubsectionSchema).optional(),
  recordId: z.string().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type Section = z.infer<typeof SectionSchema>;

export const SubjectivitySchema = z.object({
  description: z.string(),
  category: z.string().optional(),
});
export type Subjectivity = z.infer<typeof SubjectivitySchema>;

export const UnderwritingConditionSchema = z.object({
  description: z.string(),
});
export type UnderwritingCondition = z.infer<typeof UnderwritingConditionSchema>;

export const PremiumLineSchema = z.object({
  line: z.string(),
  amount: z.string(),
  amountValue: z.number().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type PremiumLine = z.infer<typeof PremiumLineSchema>;

export const AuxiliaryFactSchema = z.object({
  key: z.string(),
  value: z.string(),
  subject: z.string().optional(),
  context: z.string().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type AuxiliaryFact = z.infer<typeof AuxiliaryFactSchema>;

export const DefinitionSchema = z.object({
  term: z.string(),
  definition: z.string(),
  pageNumber: z.number().optional(),
  formNumber: z.string().optional(),
  formTitle: z.string().optional(),
  sectionRef: z.string().optional(),
  originalContent: z.string().optional(),
  recordId: z.string().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type Definition = z.infer<typeof DefinitionSchema>;

export const CoveredReasonSchema = z.object({
  coverageName: z.string(),
  reasonNumber: z.string().optional(),
  title: z.string().optional(),
  content: z.string(),
  conditions: z.array(z.string()).optional(),
  exceptions: z.array(z.string()).optional(),
  appliesTo: z.array(z.string()).optional(),
  pageNumber: z.number().optional(),
  formNumber: z.string().optional(),
  formTitle: z.string().optional(),
  sectionRef: z.string().optional(),
  originalContent: z.string().optional(),
  recordId: z.string().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type CoveredReason = z.infer<typeof CoveredReasonSchema>;

export const DocumentTableOfContentsEntrySchema = z.object({
  title: z.string(),
  level: z.number().int().positive().optional(),
  pageStart: z.number().optional(),
  pageEnd: z.number().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
});
export type DocumentTableOfContentsEntry = z.infer<typeof DocumentTableOfContentsEntrySchema>;

export const DocumentPageMapEntrySchema = z.object({
  page: z.number().int().positive(),
  label: z.string().optional(),
  formNumber: z.string().optional(),
  formTitle: z.string().optional(),
  sectionTitle: z.string().optional(),
  extractorNames: z.array(z.string()).optional(),
  sourceSpanIds: z.array(z.string()).optional(),
});
export type DocumentPageMapEntry = z.infer<typeof DocumentPageMapEntrySchema>;

export const DocumentAgentGuidanceSchema = z.object({
  kind: z.string(),
  title: z.string(),
  detail: z.string(),
  sourceSpanIds: z.array(z.string()).optional(),
});
export type DocumentAgentGuidance = z.infer<typeof DocumentAgentGuidanceSchema>;

export const DocumentMetadataSchema = z.object({
  sourceTreeVersion: z.string().optional(),
  sourceTreeCanonical: z.boolean().optional(),
  formInventory: z.array(FormReferenceSchema).optional(),
  tableOfContents: z.array(DocumentTableOfContentsEntrySchema).optional(),
  pageMap: z.array(DocumentPageMapEntrySchema).optional(),
  agentGuidance: z.array(DocumentAgentGuidanceSchema).optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

export type DocumentNode = {
  id: string;
  title: string;
  originalTitle?: string;
  type?: string;
  label?: string;
  level?: number;
  sectionNumber?: string;
  pageStart?: number;
  pageEnd?: number;
  formNumber?: string;
  formTitle?: string;
  excerpt?: string;
  content?: string;
  interpretationLabels?: string[];
  sourceSpanIds?: string[];
  sourceTextHash?: string;
  children?: DocumentNode[];
};

export const DocumentNodeSchema: z.ZodType<DocumentNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    originalTitle: z.string().optional(),
    type: z.string().optional(),
    label: z.string().optional(),
    level: z.number().int().positive().optional(),
    sectionNumber: z.string().optional(),
    pageStart: z.number().optional(),
    pageEnd: z.number().optional(),
    formNumber: z.string().optional(),
    formTitle: z.string().optional(),
    excerpt: z.string().optional(),
    content: z.string().optional(),
    interpretationLabels: z.array(z.string()).optional(),
    sourceSpanIds: z.array(z.string()).optional(),
    sourceTextHash: z.string().optional(),
    children: z.array(DocumentNodeSchema).optional(),
  }),
);

// ── Base document fields (shared between policy and quote) ──

const BaseDocumentFields = {
  id: z.string(),
  carrier: z.string(),
  security: z.string().optional(),
  insuredName: z.string(),
  premium: z.string().optional(),
  premiumAmount: z.number().optional(),
  summary: z.string().optional(),
  policyTypes: z.array(z.string()).optional(),
  coverages: z.array(CoverageSchema),
  documentMetadata: DocumentMetadataSchema,
  documentOutline: z.array(DocumentNodeSchema),
  sections: z.array(SectionSchema).optional(),
  definitions: z.array(DefinitionSchema).optional(),
  coveredReasons: z.array(CoveredReasonSchema).optional(),

  // Enriched fields (v1.2+)
  carrierLegalName: z.string().optional(),
  carrierNaicNumber: z.string().optional(),
  carrierAmBestRating: z.string().optional(),
  carrierAdmittedStatus: z.string().optional(),
  mga: z.string().optional(),
  underwriter: z.string().optional(),
  brokerAgency: z.string().optional(),
  brokerContactName: z.string().optional(),
  brokerLicenseNumber: z.string().optional(),
  priorPolicyNumber: z.string().optional(),
  programName: z.string().optional(),
  isRenewal: z.boolean().optional(),
  isPackage: z.boolean().optional(),

  insuredDba: z.string().optional(),
  insuredAddress: AddressSchema.optional(),
  insuredEntityType: EntityTypeSchema.optional(),
  additionalNamedInsureds: z.array(NamedInsuredSchema).optional(),
  insuredSicCode: z.string().optional(),
  insuredNaicsCode: z.string().optional(),
  insuredFein: z.string().optional(),

  enrichedCoverages: z.array(EnrichedCoverageSchema).optional(),
  endorsements: z.array(EndorsementSchema).optional(),
  exclusions: z.array(ExclusionSchema).optional(),
  conditions: z.array(PolicyConditionSchema).optional(),
  limits: LimitScheduleSchema.optional(),
  deductibles: DeductibleScheduleSchema.optional(),
  locations: z.array(InsuredLocationSchema).optional(),
  vehicles: z.array(InsuredVehicleSchema).optional(),
  classifications: z.array(ClassificationCodeSchema).optional(),
  formInventory: z.array(FormReferenceSchema).optional(),

  declarations: DeclarationsSchema.optional(),

  coverageForm: CoverageFormSchema.optional(),
  retroactiveDate: z.string().optional(),
  extendedReportingPeriod: ExtendedReportingPeriodSchema.optional(),

  insurer: InsurerInfoSchema.optional(),
  producer: ProducerInfoSchema.optional(),
  claimsContacts: z.array(ContactSchema).optional(),
  regulatoryContacts: z.array(ContactSchema).optional(),
  thirdPartyAdministrators: z.array(ContactSchema).optional(),
  additionalInsureds: z.array(EndorsementPartySchema).optional(),
  lossPayees: z.array(EndorsementPartySchema).optional(),
  mortgageHolders: z.array(EndorsementPartySchema).optional(),

  taxesAndFees: z.array(TaxFeeItemSchema).optional(),
  totalCost: z.string().optional(),
  totalCostAmount: z.number().optional(),
  minimumPremium: z.string().optional(),
  minimumPremiumAmount: z.number().optional(),
  depositPremium: z.string().optional(),
  depositPremiumAmount: z.number().optional(),
  paymentPlan: PaymentPlanSchema.optional(),
  auditType: AuditTypeSchema.optional(),
  ratingBasis: z.array(RatingBasisSchema).optional(),
  premiumByLocation: z.array(LocationPremiumSchema).optional(),

  lossSummary: LossSummarySchema.optional(),
  individualClaims: z.array(ClaimRecordSchema).optional(),
  experienceMod: ExperienceModSchema.optional(),

  cancellationNoticeDays: z.number().optional(),
  nonrenewalNoticeDays: z.number().optional(),
  supplementaryFacts: z.array(AuxiliaryFactSchema).optional(),
};

// ── PolicyDocument ──

export const PolicyDocumentSchema = z.object({
  ...BaseDocumentFields,
  type: z.literal("policy"),
  policyNumber: z.string(),
  effectiveDate: z.string(),
  expirationDate: z.string().optional(),
  policyTermType: PolicyTermTypeSchema.optional(),
  nextReviewDate: z.string().optional(),
  effectiveTime: z.string().optional(),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

// ── QuoteDocument ──

export const QuoteDocumentSchema = z.object({
  ...BaseDocumentFields,
  type: z.literal("quote"),
  quoteNumber: z.string(),
  proposedEffectiveDate: z.string().optional(),
  proposedExpirationDate: z.string().optional(),
  quoteExpirationDate: z.string().optional(),
  subjectivities: z.array(SubjectivitySchema).optional(),
  underwritingConditions: z.array(UnderwritingConditionSchema).optional(),
  premiumBreakdown: z.array(PremiumLineSchema).optional(),

  // Enriched quote fields (v1.2+)
  enrichedSubjectivities: z.array(EnrichedSubjectivitySchema).optional(),
  enrichedUnderwritingConditions: z.array(EnrichedUnderwritingConditionSchema).optional(),
  warrantyRequirements: z.array(z.string()).optional(),
  lossControlRecommendations: z.array(z.string()).optional(),
  bindingAuthority: BindingAuthoritySchema.optional(),
});
export type QuoteDocument = z.infer<typeof QuoteDocumentSchema>;

// ── Discriminated union ──

export const InsuranceDocumentSchema = z.discriminatedUnion("type", [
  PolicyDocumentSchema,
  QuoteDocumentSchema,
]);
export type InsuranceDocument = z.infer<typeof InsuranceDocumentSchema>;
