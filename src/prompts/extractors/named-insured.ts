import { z } from "zod";
import { SourceBackedAddressSchema, SourceProvenanceSchema } from "../../schemas/shared";

const AdditionalNamedInsuredSchema = z.object({
  name: z.string(),
  relationship: z.string().optional().describe("e.g. subsidiary, affiliate"),
  address: SourceBackedAddressSchema.optional(),
}).merge(SourceProvenanceSchema);

const ScheduledPartySchema = z.object({
  name: z.string(),
  address: SourceBackedAddressSchema.optional(),
}).merge(SourceProvenanceSchema);

export const NamedInsuredSchema = z.object({
  insuredName: z.string().describe("Name of primary named insured"),
  insuredDba: z.string().optional().describe("Doing-business-as name"),
  insuredAddress: SourceBackedAddressSchema.optional().describe("Primary insured mailing address"),
  insuredEntityType: z
    .enum([
      "corporation",
      "llc",
      "partnership",
      "sole_proprietor",
      "joint_venture",
      "trust",
      "nonprofit",
      "municipality",
      "individual",
      "married_couple",
      "other",
    ])
    .optional()
    .describe("Legal entity type of the insured"),
  insuredFein: z.string().optional().describe("Federal Employer Identification Number"),
  insuredSicCode: z.string().optional().describe("SIC code"),
  insuredNaicsCode: z.string().optional().describe("NAICS code"),
  additionalNamedInsureds: z
    .array(AdditionalNamedInsuredSchema)
    .optional()
    .describe("Additional named insureds listed on the policy"),
  lossPayees: z
    .array(ScheduledPartySchema)
    .optional()
    .describe("Loss payees listed on the policy"),
  mortgageHolders: z
    .array(ScheduledPartySchema)
    .optional()
    .describe("Mortgage holders / lienholders listed on the policy"),
});

export type NamedInsuredResult = z.infer<typeof NamedInsuredSchema>;

export function buildNamedInsuredPrompt(): string {
  return `You are an expert insurance document analyst. Extract all named insured information from this document.

Focus on:
- Primary named insured: full legal name, DBA name, mailing address
- Entity type: corporation, LLC, partnership, sole proprietor, joint venture, trust, nonprofit, municipality, individual, married couple, or other
- FEIN (Federal Employer Identification Number) if listed
- SIC code and NAICS code if listed
- ALL additional named insureds with their relationship (subsidiary, affiliate, etc.) and address if provided
- ALL loss payees with name and address (e.g. "Loss Payee: BMO Bank of Montreal")
- ALL mortgage holders / lienholders / mortgagees with name and address

Look on the declarations page, named insured schedule, loss payee schedule, mortgagee schedule, and any endorsements that add or modify named insureds, loss payees, or mortgage holders.

Critical rules:
- Every insuredAddress, additionalNamedInsureds row, lossPayees row, and mortgageHolders row must include sourceSpanIds from the source evidence. Omit the row if source spans are unavailable.
- Prefer declaration-table labels such as "Named Insured", "Named Insured and Address", "Applicant", or "Insured" over contact blocks, notice contacts, authorized officers, licensing statements, signatures, and corporate-authority wording.
- Do not use an authorized officer, broker, producer, contact person, officer title, email address owner, or licensing/entity-status statement as the primary insured unless that exact person/entity is explicitly labeled as the named insured.
- If a row combines the insured name with a mailing address, put the legal name in insuredName and the mailing address in insuredAddress.
- Entity type must come from the insured's own legal suffix or an explicit declaration field, not from generic incorporation/licensing notices elsewhere in the policy.

Return JSON only.`;
}
