import { z } from "zod";

export const EndorsementsSchema = z.object({
  endorsements: z
    .array(
      z.object({
        formNumber: z.string().describe("Form number, e.g. 'CG 21 47'"),
        editionDate: z.string().optional().describe("Edition date, e.g. '12 07'"),
        title: z.string().describe("Endorsement title"),
        endorsementType: z
          .enum([
            "additional_insured",
            "waiver_of_subrogation",
            "primary_noncontributory",
            "blanket_additional_insured",
            "loss_payee",
            "mortgage_holder",
            "broadening",
            "restriction",
            "exclusion",
            "amendatory",
            "notice_of_cancellation",
            "designated_premises",
            "classification_change",
            "schedule_update",
            "deductible_change",
            "limit_change",
            "territorial_extension",
            "other",
          ])
          .describe("Endorsement type classification"),
        effectiveDate: z.string().optional().describe("Endorsement effective date"),
        affectedCoverageParts: z
          .array(z.string())
          .optional()
          .describe("Coverage parts affected by this endorsement"),
        namedParties: z
          .array(
            z.object({
              name: z.string().describe("Party name"),
              role: z
                .enum([
                  "additional_insured",
                  "loss_payee",
                  "mortgage_holder",
                  "certificate_holder",
                  "waiver_beneficiary",
                  "designated_person",
                  "other",
                ])
                .describe("Party role"),
              relationship: z.string().optional().describe("Relationship to insured"),
              scope: z.string().optional().describe("Scope of coverage for this party"),
            }),
          )
          .optional()
          .describe("Named parties (additional insureds, loss payees, etc.)"),
        keyTerms: z
          .array(z.string())
          .optional()
          .describe("Key terms or notable provisions in the endorsement"),
        premiumImpact: z.string().optional().describe("Additional premium or credit"),
        excerpt: z.string().optional().describe("Short source excerpt, not full verbatim text"),
        content: z.string().optional().describe("Legacy fallback only; do not return full text when sourceSpanIds are available"),
        pageStart: z.number().describe("Starting page number of this endorsement"),
        pageEnd: z.number().optional().describe("Ending page number of this endorsement"),
        sourceSpanIds: z.array(z.string()).optional().describe("Source span IDs grounding this endorsement"),
        sourceTextHash: z.string().optional().describe("Hash of the source text when available"),
      }),
    )
    .describe("All endorsements found in the document"),
});

export type EndorsementsResult = z.infer<typeof EndorsementsSchema>;

export function buildEndorsementsPrompt(): string {
  return `You are an expert insurance document analyst. Build a compact source-backed endorsement index for this document. Do not reproduce full endorsement language in the JSON output.

For EACH endorsement, extract:
- formNumber: the form identifier (e.g. "CG 21 47") — REQUIRED
- editionDate: the edition date if present (e.g. "12 07")
- title: endorsement title — REQUIRED
- endorsementType: classify as one of: additional_insured, waiver_of_subrogation, primary_noncontributory, blanket_additional_insured, loss_payee, mortgage_holder, broadening, restriction, exclusion, amendatory, notice_of_cancellation, designated_premises, classification_change, schedule_update, deductible_change, limit_change, territorial_extension, other
- effectiveDate: endorsement effective date if shown
- affectedCoverageParts: which coverage parts are modified
- namedParties: for each party, extract name, role (additional_insured, loss_payee, mortgage_holder, certificate_holder, waiver_beneficiary, designated_person, other), relationship, and scope
- keyTerms: notable provisions or key terms
- premiumImpact: additional premium or credit if shown
- excerpt: short identifying source excerpt, capped at 300 characters
- sourceSpanIds: source span IDs from the provided SOURCE SPANS that ground this endorsement
- content: legacy fallback only; omit/null when sourceSpanIds are available
- pageStart: page number where endorsement begins — REQUIRED
- pageEnd: page number where endorsement ends

PERSONAL LINES ENDORSEMENT RECOGNITION:
- HO 04 XX series: homeowners endorsements
- PP 03 XX series: personal auto endorsements
- HO 17 XX series: mobilehome endorsements
- DP 04 XX series: dwelling fire endorsements

Critical rules:
- Return compact metadata plus source references. The original endorsement wording lives in source spans.
- Do not return full endorsement text in content when sourceSpanIds are available.
- Prefer sourceSpanIds over generated prose for evidence.

Return JSON only.`;
}
