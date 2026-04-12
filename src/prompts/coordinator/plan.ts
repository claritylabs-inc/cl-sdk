import { z } from "zod";

export const ExtractionTaskSchema = z.object({
  extractorName: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  description: z.string(),
});

export const PageMapEntrySchema = z.object({
  section: z.string(),
  pages: z.string(),
});

export const ExtractionPlanSchema = z.object({
  tasks: z.array(ExtractionTaskSchema),
  pageMap: z.array(PageMapEntrySchema).optional(),
});
export type ExtractionPlan = z.infer<typeof ExtractionPlanSchema>;

export function buildPlanPrompt(templateHints: string): string {
  return `You are planning the extraction of an insurance document. You have already classified this document. Now scan the full document and create a page map + extraction plan.

DOCUMENT TYPE HINTS:
${templateHints}

For each section of the document, decide which extractor should handle it and which pages to send.

Available extractors:
- carrier_info: Carrier name, legal name, NAIC, AM Best rating, admitted status, MGA, underwriter
- named_insured: Insured name, DBA, address, entity type, FEIN, SIC/NAICS codes, additional named insureds
- coverage_limits: Coverage names, limits, deductibles, coverage form, triggers
- endorsements: Endorsement forms, titles, types, content, affected parties
- exclusions: Exclusion titles, content, applicability
- conditions: Policy conditions (duties after loss, cancellation, etc.)
- premium_breakdown: Premium amounts, taxes, fees, payment plans, rating basis
- declarations: Line-specific structured declarations data (varies by policy type)
- loss_history: Loss runs, claim records, experience modification
- sections: Raw section content (for sections that don't fit other extractors)
- supplementary: Regulatory context, contacts, claims contacts, third-party administrators

Return JSON:
{
  "tasks": [
    { "extractorName": "carrier_info", "startPage": 1, "endPage": 2, "description": "Extract carrier details from declarations page" },
    ...
  ],
  "pageMap": [
    { "section": "declarations", "pages": "pages 1-3" },
    { "section": "endorsements", "pages": "pages 15-22" }
  ]
}

Create tasks that cover the entire document. Prefer specific extractors over generic "sections" where possible. Keep page ranges tight — only include pages relevant to each extractor.

Respond with JSON only.`;
}
