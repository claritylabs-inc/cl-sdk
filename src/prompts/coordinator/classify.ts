import { z } from "zod";
import { PolicyTypeSchema } from "../../schemas/enums";

export const ClassifyResultSchema = z.object({
  documentType: z.enum(["policy", "quote"]),
  policyTypes: z.array(PolicyTypeSchema),
  confidence: z.number(),
});
export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

export function buildClassifyPrompt(): string {
  return `You are classifying an insurance document. Examine the first few pages and determine:

1. Whether this is a POLICY (bound coverage) or QUOTE (proposed coverage)
2. What lines of business are covered

Policies typically have: policy numbers, effective/expiration dates, declarations pages, premium charges.
Quotes typically have: quote numbers, proposed dates, subjectivities, "indication" or "proposal" language.

Return JSON matching this structure:
{
  "documentType": "policy" | "quote",
  "policyTypes": ["general_liability", "commercial_property", ...],
  "confidence": 0.0-1.0
}

Use these policy type values: general_liability, commercial_property, commercial_auto, non_owned_auto, workers_comp, umbrella, excess_liability, professional_liability, cyber, epli, directors_officers, fiduciary_liability, crime_fidelity, inland_marine, builders_risk, environmental, ocean_marine, surety, product_liability, bop, management_liability_package, property, homeowners_ho3, homeowners_ho5, renters_ho4, condo_ho6, dwelling_fire, mobile_home, personal_auto, personal_umbrella, flood_nfip, flood_private, earthquake, personal_inland_marine, watercraft, recreational_vehicle, farm_ranch, pet, travel, identity_theft, title, other.

Respond with JSON only.`;
}
