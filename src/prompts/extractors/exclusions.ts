import { z } from "zod";

export const ExclusionsSchema = z.object({
  exclusions: z
    .array(
      z.object({
        name: z.string().describe("Exclusion title or short description"),
        formNumber: z
          .string()
          .optional()
          .describe("Form number if part of a named endorsement"),
        excludedPerils: z
          .array(z.string())
          .optional()
          .describe("Specific perils excluded"),
        isAbsolute: z
          .boolean()
          .optional()
          .describe("Whether the exclusion is absolute (no exceptions)"),
        exceptions: z
          .array(z.string())
          .optional()
          .describe("Exceptions to the exclusion, if any"),
        buybackAvailable: z
          .boolean()
          .optional()
          .describe("Whether coverage can be bought back via endorsement"),
        buybackEndorsement: z
          .string()
          .optional()
          .describe("Form number of the buyback endorsement if available"),
        appliesTo: z
          .array(z.string())
          .optional()
          .describe("Coverage types this exclusion applies to"),
        content: z.string().describe("Full verbatim exclusion text"),
        pageNumber: z.number().optional().describe("Page number where exclusion appears"),
      }),
    )
    .describe("All exclusions found in the document"),
});

export type ExclusionsResult = z.infer<typeof ExclusionsSchema>;

export function buildExclusionsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL exclusions from this document. Preserve original language verbatim.

For EACH exclusion, extract:
- name: exclusion title or short description — REQUIRED
- formNumber: form number if the exclusion is part of a named endorsement
- excludedPerils: specific perils being excluded
- isAbsolute: true if the exclusion has no exceptions, false if exceptions exist
- exceptions: any exceptions to the exclusion (things still covered despite the exclusion)
- buybackAvailable: whether coverage can be purchased back via endorsement
- buybackEndorsement: the form number of the buyback endorsement if known
- appliesTo: which coverage types or lines this exclusion applies to (as an array)
- content: full verbatim exclusion text — REQUIRED
- pageNumber: page number where the exclusion appears

Focus on:
- Named exclusions from exclusion schedules
- Exclusions embedded within endorsements
- Exclusions within insuring agreements or conditions if clearly labeled
- Full verbatim exclusion text — do not summarize

Critical rules:
- Ignore table-of-contents entries, running headers/footers, and references that only point to another page or section.
- Do not emit a standalone exclusion from a fragment unless the fragment itself contains substantive exclusion wording.
- Always include pageNumber when the exclusion appears on a specific page in the supplied document chunk.

Common personal lines exclusion patterns: animal liability, business pursuits, home daycare, watercraft, aircraft.

Return JSON only.`;
}
