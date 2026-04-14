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

HOMEOWNER FORM CLASSIFICATION — pay close attention to these distinctions:
- "homeowners_ho3" — HO-3 Special Form. Standard homeowner policy for OWNER-OCCUPIED dwellings.
  Key indicators: Coverage A (Dwelling) present, open-peril dwelling coverage, named-peril personal property,
  references to "special form", "HO 00 03", or "HO-3". The insured OWNS the home.
- "homeowners_ho5" — HO-5 Comprehensive Form. Premium homeowner policy for OWNER-OCCUPIED dwellings.
  Key indicators: Coverage A (Dwelling) present, BOTH dwelling AND personal property on open-peril basis,
  references to "comprehensive form", "HO 00 05", or "HO-5". Higher coverage than HO-3.
- "renters_ho4" — HO-4 Contents Broad Form. Renters/tenants insurance — NO dwelling coverage.
  Key indicators: NO Coverage A (Dwelling), only Coverage C (Personal Property) and Coverage E/F (Liability/Medical),
  references to "contents broad form", "HO 00 04", "HO-4", "renters", "tenants". The insured RENTS, does not own.
- "condo_ho6" — HO-6 Unit-Owners Form. Condo/co-op unit-owner insurance.
  Key indicators: Coverage A applies to interior walls/improvements only (not full structure),
  references to "unit-owners form", "HO 00 06", "HO-6", "condominium", "co-op unit". The building's
  master policy covers the structure; HO-6 covers the unit interior, personal property, and liability.

DISAMBIGUATION RULES for homeowner forms:
1. If the document has Coverage A (Dwelling) with full structure coverage → HO-3 or HO-5 (check if open-peril on personal property → HO-5, named-peril → HO-3)
2. If NO Coverage A / no dwelling coverage and the insured is a renter/tenant → renters_ho4
3. If Coverage A covers only unit interior/improvements and mentions condo/co-op → condo_ho6
4. Look for the actual form number (HO 00 03, HO 00 04, HO 00 05, HO 00 06) on the declarations page — this is the most reliable indicator
5. Do NOT default to homeowners_ho3 when uncertain — check for the distinguishing signals above

- "dwelling_fire" — DP-1, DP-3, dwelling fire (non-owner-occupied or investment property)
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
- "pet" — standalone pet insurance policy. Key indicators: named pet, species/breed, accident/illness coverage,
  wellness plans, per-incident or annual limits for veterinary costs. Do NOT confuse with pet liability endorsements
  on a homeowners policy — those are still homeowner policies (ho3/ho4/ho5/ho6), not "pet".
  Only classify as "pet" when the ENTIRE policy is dedicated to pet health/accident coverage.
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
