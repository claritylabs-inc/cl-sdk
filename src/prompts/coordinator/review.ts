import { z } from "zod";

export const ReviewResultSchema = z.object({
  complete: z.boolean(),
  missingFields: z.array(z.string()),
  additionalTasks: z.array(z.object({
    extractorName: z.string(),
    startPage: z.number(),
    endPage: z.number(),
    description: z.string(),
  })),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export function buildReviewPrompt(templateExpected: string[], extractedKeys: string[]): string {
  return `You are reviewing an extraction for completeness. Compare what was expected vs what was found.

EXPECTED FIELDS (from document type template):
${templateExpected.map((f) => `- ${f}`).join("\n")}

FIELDS ALREADY EXTRACTED:
${extractedKeys.map((f) => `- ${f}`).join("\n")}

Determine:
1. Is the extraction complete enough? (required fields present = complete)
2. What fields are missing?
3. Should any additional extraction tasks be dispatched?

Return JSON:
{
  "complete": boolean,
  "missingFields": ["field1", "field2"],
  "additionalTasks": [
    { "extractorName": "...", "startPage": N, "endPage": N, "description": "..." }
  ]
}

If all required fields are present, set complete=true even if some optional fields are missing.

Respond with JSON only.`;
}
