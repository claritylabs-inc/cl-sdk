import { z } from "zod";

export const ExclusionsSchema = z.object({
  exclusions: z
    .array(
      z.object({
        title: z.string().describe("Exclusion title or short description"),
        content: z.string().optional().describe("Full verbatim exclusion text"),
        formNumber: z
          .string()
          .optional()
          .describe("Form number if part of a named endorsement"),
        appliesTo: z
          .string()
          .optional()
          .describe("Coverage type this exclusion applies to"),
      }),
    )
    .describe("All exclusions found in the document"),
});

export type ExclusionsResult = z.infer<typeof ExclusionsSchema>;

export function buildExclusionsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL exclusions from this document. Preserve original language verbatim.

Focus on:
- Named exclusions from exclusion schedules
- Exclusions embedded within endorsements
- Exclusions within insuring agreements or conditions if clearly labeled
- Full verbatim exclusion text — do not summarize
- Form number if the exclusion is part of a named endorsement
- Which coverage line the exclusion applies to, if specific

Common personal lines exclusion patterns: animal liability, business pursuits, home daycare, watercraft, aircraft.

Return JSON only.`;
}
