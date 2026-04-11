import { z } from "zod";
import { EndorsementTypeSchema, EndorsementPartyRoleSchema } from "./enums";
import { AddressSchema } from "./shared";

export const EndorsementPartySchema = z.object({
  name: z.string(),
  role: EndorsementPartyRoleSchema,
  address: AddressSchema.optional(),
  relationship: z.string().optional(),
  scope: z.string().optional(),
});
export type EndorsementParty = z.infer<typeof EndorsementPartySchema>;

export const EndorsementSchema = z.object({
  formNumber: z.string(),
  editionDate: z.string().optional(),
  title: z.string(),
  endorsementType: EndorsementTypeSchema,
  effectiveDate: z.string().optional(),
  affectedCoverageParts: z.array(z.string()).optional(),
  namedParties: z.array(EndorsementPartySchema).optional(),
  keyTerms: z.array(z.string()).optional(),
  premiumImpact: z.string().optional(),
  content: z.string(),
  pageStart: z.number(),
  pageEnd: z.number().optional(),
});
export type Endorsement = z.infer<typeof EndorsementSchema>;
