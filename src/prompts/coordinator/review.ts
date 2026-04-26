import { z } from "zod";

export const ReviewResultSchema = z.object({
  complete: z.boolean(),
  missingFields: z.array(z.string()),
  qualityIssues: z.array(z.string()).optional(),
  additionalTasks: z.array(z.object({
    extractorName: z.string(),
    startPage: z.number(),
    endPage: z.number(),
    description: z.string(),
  })),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export function buildReviewPrompt(
  templateExpected: string[],
  extractedKeys: string[],
  extractionSummary: string,
  pageMapSummary: string,
  extractorCatalog: string,
): string {
  return `You are the extraction coordinator for an insurance-document agent system. Review the current extraction state, decide whether the result is complete enough, and choose any follow-up extractor tasks needed to improve it.

EXPECTED FIELDS (from document type template):
${templateExpected.map((f) => `- ${f}`).join("\n")}

AVAILABLE FOLLOW-UP EXTRACTORS:
${extractorCatalog}

FIELDS ALREADY EXTRACTED:
${extractedKeys.map((f) => `- ${f}`).join("\n")}

PAGE MAP SUMMARY:
${pageMapSummary}

CURRENT EXTRACTION SUMMARY:
${extractionSummary}

Determine:
1. Is the extraction complete enough?
2. What fields are missing?
3. What quality issues are present?
4. Which follow-up extraction tasks, if any, should be dispatched?

Mark the extraction as NOT complete if any of these are true:
- required fields are missing
- extracted values are generic placeholders like "shown in declarations", "per schedule", "if applicable", "as stated"
- coverage limits or deductibles appear to come from generic form language instead of declaration/schedule-specific values
- definitions pages were mapped but no definition records or definition-type sections were extracted
- covered causes/reasons pages were mapped but no covered reason, covered peril, covered cause, or matching section records were extracted
- page assignments suggest declaration, schedule, endorsement, exclusion, or condition pages were not actually extracted with the matching focused extractor
- a focused extractor exists but returned too little substance for the relevant pages

When reviewing CURRENT EXTRACTION SUMMARY, compare the page-map counts to extracted counts. If an assigned extractor produced no useful records, produce a quality issue and a narrow follow-up task over the mapped page range.

Choose follow-up tasks from AVAILABLE FOLLOW-UP EXTRACTORS. You may dispatch any listed extractor when the page map, current extraction summary, or quality evidence shows that the focused extraction is missing, generic, referential, or too thin. Do not invent extractor names.

Return JSON:
{
  "complete": boolean,
  "missingFields": ["field1", "field2"],
  "qualityIssues": ["issue 1", "issue 2"],
  "additionalTasks": [
    { "extractorName": "...", "startPage": N, "endPage": N, "description": "..." }
  ]
}

Use the page map to target follow-up extraction pages precisely. Prefer narrow, declaration/schedule-focused follow-up tasks over broad page ranges. If no additional model work is likely to improve the extraction, return an empty additionalTasks array.

Respond with JSON only.`;
}
