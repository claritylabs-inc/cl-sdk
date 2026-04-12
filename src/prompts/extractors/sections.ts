import { z } from "zod";

const SubsectionSchema = z.object({
  title: z.string().describe("Subsection title"),
  sectionNumber: z.string().optional().describe("Subsection number"),
  pageNumber: z.number().optional().describe("Page number"),
  content: z.string().describe("Full verbatim text"),
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
            "exclusion",
            "condition",
            "definition",
            "schedule",
            "notice",
            "regulatory",
            "other",
          ])
          .describe("Section type classification"),
        content: z.string().describe("Full verbatim text of the section"),
        pageStart: z.number().describe("Starting page number"),
        pageEnd: z.number().optional().describe("Ending page number"),
        subsections: z.array(SubsectionSchema).optional().describe("Subsections within this section"),
      }),
    )
    .describe("All document sections"),
});

export type SectionsResult = z.infer<typeof SectionsSchema>;

export function buildSectionsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL sections, clauses, endorsements, and schedules from this document. Preserve the original language verbatim — do not summarize or paraphrase.

For each section, classify its type:
- "declarations" — declarations page(s) listing named insured, policy period, limits, premiums
- "policy_form" — named ISO or proprietary forms (e.g. CG 00 01, IL 00 17). All sections within a named form should be typed as "policy_form"
- "endorsement" — standalone endorsements modifying the base policy
- "application" — the insurance application or supplemental application
- "insuring_agreement" — the insuring agreement clause (only if standalone, not inside a policy_form)
- "exclusion", "condition", "definition" — for standalone sections only
- "schedule" — coverage or rating schedules
- "notice", "regulatory" — notice provisions or regulatory disclosures
- "other" — anything that doesn't fit the above categories

Include accurate page numbers for every section. Include subsections only if the section has clearly defined subsections with their own titles.
If a page begins or ends in the middle of a section, treat it as a continuation of the existing section instead of creating a new orphan section from the fragment.

Critical rules:
- Ignore table-of-contents entries, page-number references, repeating headers/footers, and other navigational artifacts.
- Do not create a new section from a lone continuation fragment such as a single paragraph tail or list item that clearly belongs to the previous page's section.
- When a section spans multiple pages, keep it as one section with pageStart/pageEnd covering the full span represented in this extraction.

Return JSON only.`;
}
