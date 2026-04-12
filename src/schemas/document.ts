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
  content: z.string(),
});
export type Subsection = z.infer<typeof SubsectionSchema>;

export const SectionSchema = z.object({
  title: z.string(),
  sectionNumber: z.string().optional(),
  pageStart: z.number(),
  pageEnd: z.number().optional(),
  type: z.string(),
  coverageType: z.string().optional(),
  content: z.string(),
  subsections: z.array(SubsectionSchema).optional(),
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
});
export type PremiumLine = z.infer<typeof PremiumLineSchema>;

// ── Base document fields (shared between policy and quote) ──

const BaseDocumentFields = {
  id: z.string(),
  carrier: z.string(),
  security: z.string().optional(),
  insuredName: z.string(),
  premium: z.string().optional(),
  summary: z.string().optional(),
  policyTypes: z.array(z.string()).optional(),
  coverages: z.array(CoverageSchema),
  sections: z.array(SectionSchema).optional(),

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
  minimumPremium: z.string().optional(),
  depositPremium: z.string().optional(),
  paymentPlan: PaymentPlanSchema.optional(),
  auditType: AuditTypeSchema.optional(),
  ratingBasis: z.array(RatingBasisSchema).optional(),
  premiumByLocation: z.array(LocationPremiumSchema).optional(),

  lossSummary: LossSummarySchema.optional(),
  individualClaims: z.array(ClaimRecordSchema).optional(),
  experienceMod: ExperienceModSchema.optional(),

  cancellationNoticeDays: z.number().optional(),
  nonrenewalNoticeDays: z.number().optional(),
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
