import { z } from "zod";
import {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  AcordLobCodeSchema,
} from "../../schemas/lines-of-business";

export const ClassifyResultSchema = z.object({
  documentType: z.enum(["policy", "quote"]).describe("Whether this is a bound policy or a proposed quote"),
  linesOfBusiness: z
    .array(AcordLobCodeSchema)
    .min(1)
    .describe("ACORD lines of business covered — at least one code required"),
  confidence: z.number().describe("Confidence score from 0.0 to 1.0"),
});
export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

export function buildClassifyPrompt(): string {
  const codeReference = ACORD_LOB_CODES
    .map((code) => `- "${code}" — ${ACORD_LOB_LABELS[code]}`)
    .join("\n");
  return `You are classifying an insurance document. Examine the document and determine:

1. Whether this is a POLICY (bound coverage) or QUOTE (proposed coverage)
2. What lines of business are covered (at least one — never return an empty list)

POLICY indicators: policy numbers, effective/expiration dates, declarations pages, premium charges, "this policy" language.
QUOTE indicators: quote numbers, proposed dates, subjectivities, "indication" or "proposal" language, "quoted premium".

COMMERCIAL LINES — return ACORD codes:
- "CGL" — commercial general liability, GL
- "PROP" — commercial property, building/contents coverage
- "AUTOB" — commercial auto, business auto, CA, hired/non-owned auto
- "WORK" — workers compensation, WC
- "UMBRC" — commercial umbrella
- "EXLIA" — excess liability, follow-form excess
- "PL" — professional liability or malpractice
- "EO" — errors and omissions or E&O
- "CYBER" — cyber liability, data breach, network security, privacy liability
- "OLIB" — other liability, including environmental/pollution or product liability when no more specific current code fits
- "EPLI" — employment practices liability
- "DO" — D&O, directors and officers
- "FIDUC" — fiduciary liability
- "CRIM" — crime or employee dishonesty
- "CRIME" — crime including burglary
- "FIDTY" — fidelity
- "INMRC" — inland marine, equipment floater, contractors equipment, builders risk
- "COMR" — ocean marine
- "CARGO" — cargo
- "SURE" — surety bond
- "BOP" — business owners policy, BOP
- "MGMLI" — management liability
- "PROP" — generic standalone property when commercial/personal form is not clear

PERSONAL LINES — match these values:

HOMEOWNER FORM CLASSIFICATION — pay close attention to these distinctions:
- "HOME" — HO-3 Special Form. Standard homeowner policy for OWNER-OCCUPIED dwellings.
  Key indicators: Coverage A (Dwelling) present, open-peril dwelling coverage, named-peril personal property,
  references to "special form", "HO 00 03", or "HO-3". The insured OWNS the home.
- "HOME" — HO-5 Comprehensive Form. Premium homeowner policy for OWNER-OCCUPIED dwellings.
  Key indicators: Coverage A (Dwelling) present, BOTH dwelling AND personal property on open-peril basis,
  references to "comprehensive form", "HO 00 05", or "HO-5". Higher coverage than HO-3.
- "HOME" — HO-4 Contents Broad Form. Renters/tenants insurance — NO dwelling coverage.
  Key indicators: NO Coverage A (Dwelling), only Coverage C (Personal Property) and Coverage E/F (Liability/Medical),
  references to "contents broad form", "HO 00 04", "HO-4", "renters", "tenants". The insured RENTS, does not own.
- "HOME" — HO-6 Unit-Owners Form. Condo/co-op unit-owner insurance.
  Key indicators: Coverage A applies to interior walls/improvements only (not full structure),
  references to "unit-owners form", "HO 00 06", "HO-6", "condominium", "co-op unit". The building's
  master policy covers the structure; HO-6 covers the unit interior, personal property, and liability.

DISAMBIGUATION RULES for homeowner forms:
1. If the document has Coverage A (Dwelling) with full structure coverage → HO-3 or HO-5 (check if open-peril on personal property → HO-5, named-peril → HO-3)
2. If NO Coverage A / no dwelling coverage and the insured is a renter/tenant → renters_ho4
3. If Coverage A covers only unit interior/improvements and mentions condo/co-op → condo_ho6
4. Look for the actual form number (HO 00 03, HO 00 04, HO 00 05, HO 00 06) on the declarations page — this is the most reliable indicator
5. Do NOT default to homeowners_ho3 when uncertain — check for the distinguishing signals above

- "DFIRE" — DP-1, DP-3, dwelling fire (non-owner-occupied or investment property)
- "MHOME" — mobile home, manufactured home
- "AUTOP" — personal auto, PAP
- "UMBRP" — personal umbrella
- "FLOOD" — NFIP or private flood
- "EQ" — earthquake
- "INMRP" — personal articles, scheduled personal property
- "BOAT" — watercraft, boat
- "RECV" — RV, recreational vehicle, ATV
- "CFRM" — farm, ranch
- "TRVL" — travel insurance, including trip cancellation, interruption, or delay
- "UN" — standalone pet insurance policy. Key indicators: named pet, species/breed, accident/illness coverage,
  wellness plans, per-incident or annual limits for veterinary costs. Do NOT confuse with pet liability endorsements
  on a homeowners policy — those are still HOME policies, not UN.
  Only classify as UN when the ENTIRE policy is dedicated to pet health/accident coverage.
- "UN" — life, long-term care, pet, identity theft, title, or another line with no current ACORD match
- "DISAB" — disability or critical illness

CURRENT ACORD LOBCd REFERENCE — return only codes from this list:
${codeReference}

IMPORTANT: You must identify at least one ACORD line of business code. Only use "UN" when the document truly does not match any supported extractable code.

Return JSON only:
{
  "documentType": "policy" | "quote",
  "linesOfBusiness": ["CGL", ...],
  "confidence": 0.0-1.0
}`;
}
