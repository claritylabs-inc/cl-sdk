import { z } from "zod";

export const PageExtractorSchema = z.enum([
  "carrier_info",
  "named_insured",
  "coverage_limits",
  "endorsements",
  "exclusions",
  "conditions",
  "premium_breakdown",
  "declarations",
  "loss_history",
  "sections",
  "supplementary",
]);

export const PageAssignmentSchema = z.object({
  localPageNumber: z.number().int().positive().describe("1-based page number within this supplied PDF chunk"),
  extractorNames: z.array(PageExtractorSchema).describe("Focused extractors that should inspect this page"),
  confidence: z.number().min(0).max(1).optional().describe("Confidence in the page assignment"),
  notes: z.string().optional().describe("Short explanation of what appears on the page"),
});

export const PageMapChunkSchema = z.object({
  pages: z.array(PageAssignmentSchema),
});

export type PageMapChunk = z.infer<typeof PageMapChunkSchema>;
export type PageAssignment = z.infer<typeof PageAssignmentSchema>;

export function buildPageMapPrompt(
  templateHints: string,
  startPage: number,
  endPage: number,
): string {
  return `You are mapping insurance document pages to focused extractors.

These supplied pages are ORIGINAL DOCUMENT PAGES ${startPage}-${endPage}.

DOCUMENT TYPE HINTS:
${templateHints}

For each page in this supplied PDF chunk, decide which extractor(s) should inspect it.

Available extractors:
- carrier_info
- named_insured
- coverage_limits
- endorsements
- exclusions
- conditions
- premium_breakdown
- declarations
- loss_history
- sections
- supplementary

Rules:
- Use specific extractors for declarations, schedules, endorsements, exclusions, conditions, premium pages, and loss runs.
- Use "sections" for pages that contain substantive policy text or mixed content that should still be preserved as raw sections.
- Avoid assigning broad ranges mentally; decide page by page.
- A page may map to multiple extractors if it legitimately contains multiple relevant sections.
- Prefer declarations and schedules for numeric limits/deductibles over later generic form wording.
- If a page is mostly generic form language with no declaration-specific values, do not assign "coverage_limits" unless it clearly contains schedule-specific limits.
- Return every page in the supplied chunk exactly once.

Return JSON:
{
  "pages": [
    {
      "localPageNumber": 1,
      "extractorNames": ["declarations", "carrier_info", "named_insured", "coverage_limits"],
      "confidence": 0.96,
      "notes": "Declarations page with insured, policy period, and scheduled limits"
    }
  ]
}

Respond with JSON only.`;
}
