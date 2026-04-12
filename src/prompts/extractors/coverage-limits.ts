import { z } from "zod";

export const CoverageLimitsSchema = z.object({
  coverages: z
    .array(
      z.object({
        name: z.string().describe("Coverage name"),
        limit: z.string().describe("Coverage limit, e.g. '$1,000,000'"),
        deductible: z.string().optional().describe("Deductible amount"),
        coverageCode: z.string().optional().describe("Coverage code or class code"),
        formNumber: z.string().optional().describe("Associated form number, e.g. 'CG 00 01'"),
      }),
    )
    .describe("All coverages with their limits"),
  coverageForm: z
    .enum(["occurrence", "claims_made", "accident"])
    .optional()
    .describe("Primary coverage trigger type"),
  retroactiveDate: z
    .string()
    .optional()
    .describe("Retroactive date for claims-made policies (MM/DD/YYYY)"),
});

export type CoverageLimitsResult = z.infer<typeof CoverageLimitsSchema>;

export function buildCoverageLimitsPrompt(): string {
  return `You are an expert insurance document analyst. Extract all coverage limits and deductibles from this document.

Focus on:
- Every coverage listed on the declarations page or coverage schedule
- Per-occurrence, aggregate, and sub-limits for each coverage
- Deductible or self-insured retention for each coverage
- Coverage form type: occurrence-based, claims-made, or accident
- Retroactive date for claims-made policies
- Form numbers associated with each coverage (e.g. CG 00 01, HO 00 03)
- Standard limit fields: per occurrence, general aggregate, products/completed ops aggregate, personal & advertising injury, fire damage, medical expense, combined single limit, BI/PD splits, umbrella each occurrence/aggregate/retention, statutory (WC), employers liability
- Defense cost treatment: inside limits, outside limits, or supplementary

Extract ALL coverages — do not omit any coverage line that appears in the document.

Return JSON only.`;
}
