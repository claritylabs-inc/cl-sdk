import { z } from "zod";
import { PolicyTypeSchema } from "../../schemas/enums";

export const ClassifyResultSchema = z.object({
  documentType: z.enum(["policy", "quote"]).describe("Whether this is a bound policy or a proposed quote"),
  policyTypes: z
    .array(PolicyTypeSchema)
    .min(1)
    .describe("Lines of business covered — at least one required"),
  confidence: z.number().describe("Confidence score from 0.0 to 1.0"),
});
export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

export function buildClassifyPrompt(): string {
  return `You are classifying an insurance document. Examine the document and determine:

1. Whether this is a POLICY (bound coverage) or QUOTE (proposed coverage)
2. What lines of business are covered (at least one — never return an empty list)

POLICY indicators: policy numbers, effective/expiration dates, declarations pages, premium charges, "this policy" language.
QUOTE indicators: quote numbers, proposed dates, subjectivities, "indication" or "proposal" language, "quoted premium".

COMMERCIAL LINES — match these values:
- "general_liability" — CGL, commercial general liability, GL
- "commercial_property" — commercial property, building/contents coverage
- "commercial_auto" — commercial auto, business auto, CA
- "non_owned_auto" — hired & non-owned auto
- "workers_comp" — workers compensation, WC
- "umbrella" — commercial umbrella
- "excess_liability" — excess liability, follow-form excess
- "professional_liability" — E&O, errors & omissions, professional liability, malpractice
- "cyber" — cyber liability, data breach, network security
- "epli" — employment practices liability
- "directors_officers" — D&O, directors and officers
- "fiduciary_liability" — fiduciary liability
- "crime_fidelity" — crime, fidelity, employee dishonesty
- "inland_marine" — inland marine, equipment floater, contractors equipment
- "builders_risk" — builders risk, course of construction
- "environmental" — environmental, pollution liability
- "ocean_marine" — ocean marine, cargo, hull
- "surety" — surety bond
- "product_liability" — product liability, products-completed operations
- "bop" — business owners policy, BOP
- "management_liability_package" — management liability package
- "property" — standalone property

PERSONAL LINES — match these values:
- "homeowners_ho3" — HO-3, special form homeowners
- "homeowners_ho5" — HO-5, comprehensive form homeowners
- "renters_ho4" — HO-4, renters insurance
- "condo_ho6" — HO-6, condo unit-owners
- "dwelling_fire" — DP-1, DP-3, dwelling fire
- "mobile_home" — mobile home, manufactured home
- "personal_auto" — personal auto, PAP
- "personal_umbrella" — personal umbrella
- "flood_nfip" — NFIP flood
- "flood_private" — private flood
- "earthquake" — earthquake
- "personal_inland_marine" — personal articles, scheduled personal property
- "watercraft" — watercraft, boat
- "recreational_vehicle" — RV, recreational vehicle, ATV
- "farm_ranch" — farm, ranch
- "pet" — pet insurance
- "travel" — travel insurance
- "identity_theft" — identity theft
- "title" — title insurance
- "other" — only if NONE of the above match

IMPORTANT: You must identify at least one specific policy type. Only use "other" as a last resort when the document truly does not match any known type.

Return JSON only:
{
  "documentType": "policy" | "quote",
  "policyTypes": ["general_liability", ...],
  "confidence": 0.0-1.0
}`;
}
