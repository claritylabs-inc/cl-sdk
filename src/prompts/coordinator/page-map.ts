import { z } from "zod";

export const PageExtractorSchema = z.enum([
  "carrier_info",
  "named_insured",
  "coverage_limits",
  "covered_reasons",
  "definitions",
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
  pageRole: z.enum([
    "declarations_schedule",
    "endorsement_schedule",
    "policy_form",
    "endorsement_form",
    "condition_exclusion_form",
    "supplementary",
    "other",
  ]).optional().describe("Primary role of the page"),
  hasScheduleValues: z.boolean().optional().describe("True only when the page contains insured-specific declaration or schedule values, tables, or rows to extract"),
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
  formInventoryHint?: string,
): string {
  const inventoryBlock = formInventoryHint
    ? `\nFORM INVENTORY (already identified — use this to constrain your assignments):\n${formInventoryHint}\n`
    : "";

  return `You are mapping insurance document pages to focused extractors.

These supplied pages are ORIGINAL DOCUMENT PAGES ${startPage}-${endPage}.

DOCUMENT TYPE HINTS:
${templateHints}
${inventoryBlock}
For each page in this supplied PDF chunk, decide which extractor(s) should inspect it.

Available extractors:
- carrier_info
- named_insured
- coverage_limits
- covered_reasons
- definitions
- endorsements
- exclusions
- conditions
- premium_breakdown
- declarations
- loss_history
- sections
- supplementary

Rules:
- Identify the broad section or form context first, then assign focused extractors within that context.
- Use specific extractors for declarations, schedules, endorsements, exclusions, conditions, premium pages, and loss runs.
- Use "sections" for pages that contain substantive policy text or mixed content that should still be preserved as raw sections.
- Use "definitions" for policy-form pages containing defined terms, definitions sections, or term meaning clauses.
- Use "covered_reasons" for pages listing covered causes of loss, covered reasons, covered perils, named perils, covered events, or covered loss triggers.
- Avoid assigning broad ranges mentally; decide page by page.
- A page may map to multiple extractors if it legitimately contains multiple relevant sections.
- Prefer declarations and schedules for numeric limits/deductibles over later generic form wording.
- Assign "coverage_limits" only when the page itself contains insured-specific declaration or schedule values to capture, such as location/building rows, coverage tables, limits, deductibles, coinsurance percentages, or scheduled amounts tied to this policy.
- Do NOT assign "coverage_limits" for generic policy-form or endorsement text that merely explains how limits, deductibles, waiting periods, or coinsurance work, or that says values are "shown in the declarations", "shown in the schedule", "as stated", or "if applicable".
- Headings like "Limits of Insurance", "Deductible", "Coinsurance", "Loss Conditions", or "Definitions" inside a policy form usually indicate form language, not declarations or schedules.
- Continuation pages near the end of a form should stay mapped to "sections" plus "conditions"/"exclusions" when applicable, even if they mention limits or deductibles.
- Covered causes/reasons and definitions often span a whole form section; tag every substantive page in that section, not just the heading page.
- When a form inventory entry identifies a page range as a specific form type (e.g., endorsement, coverage, application), use that classification to guide your extractor choice. Do not assign "coverage_limits" to pages the inventory identifies as endorsement or condition/exclusion forms unless the page contains actual schedule values.
- Do not tag a page with "exclusions" or "conditions" if it only contains a table of contents, page-number reference, running header/footer, or a heading that points to another page without substantive wording.
- If a page appears to be part of a larger exclusion, conditions, or endorsement section within the same form, keep the assignment consistent across nearby pages in that section rather than isolating a single page fragment.
- Return every page in the supplied chunk exactly once.

Return JSON:
{
  "pages": [
    {
      "localPageNumber": 1,
      "extractorNames": ["declarations", "carrier_info", "named_insured", "coverage_limits"],
      "pageRole": "declarations_schedule",
      "hasScheduleValues": true,
      "confidence": 0.96,
      "notes": "Declarations page with insured, policy period, and scheduled limits"
    }
  ]
}

Respond with JSON only.`;
}

/** Format form inventory entries as a concise hint for the page-map prompt. */
export function formatFormInventoryForPageMap(
  forms: Array<{
    formNumber: string;
    formType: string;
    title?: string;
    pageStart?: number;
    pageEnd?: number;
  }>,
): string {
  if (forms.length === 0) return "";

  return forms
    .filter((f) => f.pageStart != null)
    .map((f) => {
      const range = f.pageEnd && f.pageEnd !== f.pageStart
        ? `pages ${f.pageStart}-${f.pageEnd}`
        : `page ${f.pageStart}`;
      const title = f.title ? ` "${f.title}"` : "";
      return `- ${f.formNumber}${title} [${f.formType}] → ${range}`;
    })
    .join("\n");
}
