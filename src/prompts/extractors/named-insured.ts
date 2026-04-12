import { z } from "zod";

const AddressSchema = z.object({
  street1: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});

export const NamedInsuredSchema = z.object({
  insuredName: z.string().describe("Name of primary named insured"),
  insuredDba: z.string().optional().describe("Doing-business-as name"),
  insuredAddress: AddressSchema.optional().describe("Primary insured mailing address"),
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
    .array(
      z.object({
        name: z.string(),
        relationship: z.string().optional().describe("e.g. subsidiary, affiliate"),
        address: AddressSchema.optional(),
      }),
    )
    .optional()
    .describe("Additional named insureds listed on the policy"),
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

Look on the declarations page, named insured schedule, and any endorsements that add or modify named insureds.

Return JSON only.`;
}
