import { z } from "zod";
import { CoverageValueTypeSchema } from "../../schemas/coverage";

/**
 * Extractor output schema for resolving referential coverage limits.
 *
 * When a coverage declares its limit or deductible as "As stated in Policy",
 * "As stated in Section 4 of Policy", or similar referential wording, this
 * schema captures the concrete values found after a targeted lookup in the
 * referenced section.
 */
export const ReferentialLookupSchema = z.object({
  resolvedCoverages: z.array(
    z.object({
      coverageName: z
        .string()
        .describe("The coverage name that was referenced"),
      resolvedLimit: z
        .string()
        .optional()
        .describe("The concrete limit value found, if any"),
      resolvedLimitValueType: CoverageValueTypeSchema.optional(),
      resolvedDeductible: z
        .string()
        .optional()
        .describe("The concrete deductible value found, if any"),
      resolvedDeductibleValueType: CoverageValueTypeSchema.optional(),
      pageNumber: z
        .number()
        .optional()
        .describe("Page where the resolved value was found"),
      originalContent: z
        .string()
        .optional()
        .describe("Verbatim source text for the resolved value"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("Confidence in the resolution"),
    }),
  ),
});

export type ReferentialLookupResult = z.infer<typeof ReferentialLookupSchema>;

/**
 * Builds a prompt for resolving referential coverage limits.
 *
 * Accepts the list of coverages whose limit or deductible contained
 * referential wording (e.g. "As stated in Policy") and produces a prompt
 * that instructs the LLM to locate the actual concrete values in the
 * referenced section of the document.
 */
export function buildReferentialLookupPrompt(
  coverages: Array<{
    name: string;
    limit: string;
    deductible?: string;
    sectionRef?: string;
  }>,
): string {
  const coverageList = coverages
    .map((c, i) => {
      const parts = [`  ${i + 1}. Coverage: "${c.name}" — Limit: "${c.limit}"`];
      if (c.deductible) {
        parts.push(`     Deductible: "${c.deductible}"`);
      }
      if (c.sectionRef) {
        parts.push(`     Referenced section: "${c.sectionRef}"`);
      }
      return parts.join("\n");
    })
    .join("\n");

  return `You are an expert insurance document analyst. You are looking at a specific section of an insurance document to resolve referential coverage limits.

The following coverages had referential limits or deductibles (e.g. "As stated in Policy", "As stated in Section 4 of Policy", "See Declarations") instead of concrete values:

${coverageList}

Your task:
- Find the concrete/actual limit and deductible values for each coverage listed above.
- Search the declarations page, coverage schedules, and any referenced sections for the real numeric or defined values.
- Only return values you can actually find in the document — do not guess or infer values that are not explicitly stated.
- For each resolved coverage, include:
  - pageNumber: the page where the resolved value appears
  - originalContent: the verbatim text snippet containing the resolved value
  - confidence: "high" if the value is clearly and unambiguously stated, "medium" if it requires interpretation, "low" if uncertain
- If a coverage cannot be resolved (no concrete value found), still include it with confidence "low" and omit the resolved fields.
- Classify resolvedLimitValueType and resolvedDeductibleValueType as numeric, included, not_included, as_stated, waiting_period, referential, or other.

Return JSON only.`;
}
