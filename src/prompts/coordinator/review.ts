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
): string {
  return `You are reviewing an extraction for completeness and quality. Compare what was expected vs what was found.

EXPECTED FIELDS (from document type template):
${templateExpected.map((f) => `- ${f}`).join("\n")}

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
4. Should any additional extraction tasks be dispatched?

Mark the extraction as NOT complete if any of these are true:
- required fields are missing
- extracted values are generic placeholders like "shown in declarations", "per schedule", "if applicable", "as stated"
- coverage limits or deductibles appear to come from generic form language instead of declaration/schedule-specific values
- page assignments suggest declaration, schedule, endorsement, exclusion, or condition pages were not actually extracted with the matching focused extractor
- a focused extractor exists but returned too little substance for the relevant pages

Return JSON:
{
  "complete": boolean,
  "missingFields": ["field1", "field2"],
  "qualityIssues": ["issue 1", "issue 2"],
  "additionalTasks": [
    { "extractorName": "...", "startPage": N, "endPage": N, "description": "..." }
  ]
}

Use the page map to target follow-up extraction pages precisely. Prefer narrow, declaration/schedule-focused follow-up tasks over broad page ranges.

Respond with JSON only.`;
}
