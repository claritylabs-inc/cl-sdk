import { z } from "zod";
import { RatingBasisTypeSchema } from "./enums";

export const SourceProvenanceSchema = z.object({
  sourceSpanIds: z.array(z.string().min(1)).min(1),
  documentNodeId: z.string().optional(),
  sourceTextHash: z.string().optional(),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
});
export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

export const AddressSchema = z.object({
  street1: z.string(),
  street2: z.string().optional(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string().optional(),
});
export type Address = z.infer<typeof AddressSchema>;

export const SourceBackedAddressSchema = AddressSchema.merge(SourceProvenanceSchema);
export type SourceBackedAddress = z.infer<typeof SourceBackedAddressSchema>;

export const ContactSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
  email: z.string().optional(),
  address: AddressSchema.optional(),
  hours: z.string().optional(),
}).merge(SourceProvenanceSchema);
export type Contact = z.infer<typeof ContactSchema>;

export const FormReferenceSchema = z.object({
  formNumber: z.string(),
  editionDate: z.string().optional(),
  title: z.string().optional(),
  formType: z.enum(["coverage", "endorsement", "declarations", "application", "notice", "other"]),
  pageStart: z.number().optional(),
  pageEnd: z.number().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type FormReference = z.infer<typeof FormReferenceSchema>;

export const TaxFeeItemSchema = z.object({
  name: z.string(),
  amount: z.string(),
  amountValue: z.number().optional(),
  type: z.enum(["tax", "fee", "surcharge", "assessment"]).optional(),
  description: z.string().optional(),
  documentNodeId: z.string().optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  sourceTextHash: z.string().optional(),
});
export type TaxFeeItem = z.infer<typeof TaxFeeItemSchema>;

export const RatingBasisSchema = z.object({
  type: RatingBasisTypeSchema,
  amount: z.string().optional(),
  description: z.string().optional(),
});
export type RatingBasis = z.infer<typeof RatingBasisSchema>;

export const SublimitSchema = z.object({
  name: z.string(),
  limit: z.string(),
  appliesTo: z.string().optional(),
  deductible: z.string().optional(),
});
export type Sublimit = z.infer<typeof SublimitSchema>;

export const SharedLimitSchema = z.object({
  description: z.string(),
  limit: z.string(),
  coverageParts: z.array(z.string()),
});
export type SharedLimit = z.infer<typeof SharedLimitSchema>;

export const ExtendedReportingPeriodSchema = z.object({
  basicDays: z.number().optional(),
  supplementalYears: z.number().optional(),
  supplementalPremium: z.string().optional(),
});
export type ExtendedReportingPeriod = z.infer<typeof ExtendedReportingPeriodSchema>;

export const NamedInsuredSchema = z.object({
  name: z.string(),
  relationship: z.string().optional(),
  address: AddressSchema.optional(),
}).merge(SourceProvenanceSchema);
export type NamedInsured = z.infer<typeof NamedInsuredSchema>;
