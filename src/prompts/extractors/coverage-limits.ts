import { z } from "zod";
import { CoverageSchema } from "../../schemas/coverage";

/**
 * Extractor output schema for coverage limits. The per-coverage fields are
 * derived from the canonical CoverageSchema so that extraction output is
 * directly assignable to the document's coverages array.
 *
 * `coverageCode` is added here because it is only relevant during extraction
 * (it maps to `EnrichedCoverage.coverageCode` during enrichment).
 */
const ExtractorCoverageSchema = CoverageSchema.extend({
  coverageCode: z.string().optional().describe("Coverage code or class code"),
});

export const CoverageLimitsSchema = z.object({
  coverages: z
    .array(ExtractorCoverageSchema)
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

Extract only insured-specific declaration, schedule, or endorsement entries that state actual coverage terms for this policy.

Focus on:
- Every coverage listed on the declarations page or coverage schedule
- Per-occurrence, aggregate, and sub-limits for each coverage
- Deductible or self-insured retention for each coverage
- Coverage form type: occurrence-based, claims-made, or accident
- Retroactive date for claims-made policies
- Form numbers associated with each coverage (e.g. CG 00 01, HO 00 03)
- Standard limit fields: per occurrence, general aggregate, products/completed ops aggregate, personal & advertising injury, fire damage, medical expense, combined single limit, BI/PD splits, umbrella each occurrence/aggregate/retention, statutory (WC), employers liability
- Defense cost treatment: inside limits, outside limits, or supplementary

For EACH coverage, also extract:
- pageNumber: the original page number where the coverage row/value appears
- sectionRef: the declarations/schedule/endorsement section heading where it appears
- originalContent: the verbatim row or short source snippet used for this coverage
- limitValueType: classify the limit as numeric, included, not_included, as_stated, waiting_period, referential, or other
- deductibleValueType: classify the deductible/value term similarly when deductible is present

Critical rules:
- Do not extract table-of-contents lines, index entries, headers, footers, page labels, or cross-references as coverages.
- Do not create a coverage entry from generic policy-form text that only says a limit/deductible is "shown in the declarations", "shown in the Business Income Declarations", "as stated", "if applicable", or similar referential wording.
- Do not treat a generic waiting period, deductible explanation, limits clause, coinsurance clause, or definitions text as a standalone coverage unless the page contains an actual policy-specific schedule row or declaration entry.
- Values like "Included" or "Not Included" are valid only when they appear as an explicit declarations/schedule/endorsement entry for a named coverage. Do not infer them from narrative form language.
- If a waiting period or hour deductible is shown as part of a specific declarations/schedule row, it may be captured in deductible. Otherwise omit it.
- Use limitValueType or deductibleValueType to preserve non-numeric terms precisely instead of forcing them into numeric semantics.
- Preserve one row per real coverage entry. Do not merge adjacent schedule rows into malformed names.

Return JSON only.`;
}
