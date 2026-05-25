import { z } from "zod";

const SubsectionSchema = z.object({
  title: z.string().describe("Subsection title"),
  sectionNumber: z.string().optional().describe("Subsection number"),
  pageNumber: z.number().optional().describe("Page number"),
  excerpt: z.string().optional().describe("Short source excerpt, not full verbatim text"),
  content: z.string().optional().describe("Legacy fallback only; do not return full text when sourceSpanIds are available"),
  sourceSpanIds: z.array(z.string()).optional().describe("Source span IDs grounding this subsection"),
  sourceTextHash: z.string().optional().describe("Hash of the source text when available"),
});

export const SectionsSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().describe("Section title"),
        type: z
          .enum([
            "declarations",
            "insuring_agreement",
            "policy_form",
            "endorsement",
            "application",
            "covered_reason",
            "exclusion",
            "condition",
            "definition",
            "schedule",
            "notice",
            "regulatory",
            "other",
          ])
          .describe("Section type classification"),
        excerpt: z.string().optional().describe("Short source excerpt, not full verbatim text"),
        content: z.string().optional().describe("Legacy fallback only; do not return full text when sourceSpanIds are available"),
        pageStart: z.number().describe("Starting page number"),
        pageEnd: z.number().optional().describe("Ending page number"),
        sourceSpanIds: z.array(z.string()).optional().describe("Source span IDs grounding this section"),
        sourceTextHash: z.string().optional().describe("Hash of the source text when available"),
        subsections: z.array(SubsectionSchema).optional().describe("Subsections within this section"),
      }),
    )
    .describe("All document sections"),
});

export type SectionsResult = z.infer<typeof SectionsSchema>;

export function buildSectionsPrompt(): string {
  return `You are an expert insurance document analyst. Build a compact source-backed section index for this document. Do not reproduce full policy language in the JSON output.

For each section, classify its type:
- "declarations" — declarations page(s) listing named insured, policy period, limits, premiums
- "policy_form" — named ISO or proprietary forms (e.g. CG 00 01, IL 00 17). All sections within a named form should be typed as "policy_form"
- "endorsement" — standalone endorsements modifying the base policy
- "application" — the insurance application or supplemental application
- "covered_reason" — affirmative grants of coverage, covered causes of loss, covered perils, or named covered events
- "insuring_agreement" — the insuring agreement clause (only if standalone, not inside a policy_form)
- "exclusion", "condition", "definition" — for standalone sections only
- "schedule" — coverage or rating schedules
- "notice", "regulatory" — notice provisions or regulatory disclosures
- "other" — anything that doesn't fit the above categories

Include accurate page numbers for every section. Include sourceSpanIds from the provided SOURCE SPANS whenever available. Include subsections only if the section has clearly defined subsections with their own titles.
If a page begins or ends in the middle of a section, treat it as a continuation of the existing section instead of creating a new orphan section from the fragment.

Critical rules:
- Return compact metadata plus source references. The original policy wording lives in source spans.
- Use excerpt only for a short identifying snippet, capped at 300 characters.
- Do not return full section text in content when sourceSpanIds are available. Leave content omitted/null in source-backed mode.
- Ignore table-of-contents entries, page-number references, repeating headers/footers, and other navigational artifacts.
- Do not create a new section from a lone continuation fragment such as a single paragraph tail or list item that clearly belongs to the previous page's section.
- When a section spans multiple pages, keep it as one section with pageStart/pageEnd covering the full span represented in this extraction.

Return JSON only.`;
}
