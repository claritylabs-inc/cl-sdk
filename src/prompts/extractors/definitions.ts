import { z } from "zod";

export const DefinitionsSchema = z.object({
  definitions: z
    .array(
      z.object({
        term: z.string().describe("Defined term exactly as shown in the document"),
        definition: z.string().describe("Full verbatim definition text, preserving original wording"),
        pageNumber: z.number().optional().describe("Original document page number"),
        formNumber: z.string().optional().describe("Form number where this definition appears"),
        formTitle: z.string().optional().describe("Form title where this definition appears"),
        sectionRef: z.string().optional().describe("Definition section heading or subsection reference"),
        originalContent: z.string().optional().describe("Short verbatim source snippet containing the term and definition"),
      }),
    )
    .describe("All substantive insurance definitions found in the document"),
});

export type DefinitionsResult = z.infer<typeof DefinitionsSchema>;

export function buildDefinitionsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL substantive defined terms from this document. Preserve original wording verbatim.

For EACH definition, extract:
- term: defined term exactly as shown — REQUIRED
- definition: full verbatim definition text including all included subparts — REQUIRED
- pageNumber: original document page number where the definition appears
- formNumber: form number where the definition appears, if shown
- formTitle: form title where the definition appears, if shown
- sectionRef: heading such as "Definitions", "Words and Phrases Defined", or coverage-specific definition section
- originalContent: short verbatim source snippet containing the term and definition

Focus on:
- Terms in sections titled Definitions, Words and Phrases Defined, Glossary, or similar
- Coverage-specific defined terms embedded in insuring agreements, endorsements, exclusions, or conditions
- Multi-part definitions with numbered, lettered, or bulleted clauses
- Definitions that affect coverage triggers, covered property, insured status, exclusions, limits, or duties

Critical rules:
- Preserve the original content. Do not paraphrase content.
- Keep all subparts of a definition together in one item when they define the same term.
- Ignore table-of-contents entries, running headers/footers, indexes, and cross-references that do not include substantive definition text.
- Do not emit generic headings like "Definitions" as a term unless the page defines an actual term.
- Always include pageNumber when the definition appears on a specific page in the supplied document chunk.
- Use definition as the canonical full text. Do not return a separate content field.

Return JSON only.`;
}
