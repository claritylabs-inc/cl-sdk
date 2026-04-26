import { z } from "zod";

export const CoveredReasonsSchema = z.object({
  coveredReasons: z
    .array(
      z.object({
        coverageName: z.string().describe("Coverage, coverage part, or form this covered reason belongs to"),
        reasonNumber: z.string().optional().describe("Source number or letter for the covered reason, if shown"),
        title: z.string().optional().describe("Covered reason title, peril, cause of loss, trigger, or short name"),
        content: z.string().describe("Full verbatim covered-reason or insuring-agreement text"),
        conditions: z.array(z.string()).optional().describe("Conditions, timing rules, documentation requirements, or prerequisites attached to this covered reason"),
        exceptions: z.array(z.string()).optional().describe("Exceptions or limitations attached to this covered reason"),
        appliesTo: z
          .array(z.string())
          .optional()
          .describe("Covered property, persons, autos, locations, operations, or coverage parts this reason applies to"),
        pageNumber: z.number().optional().describe("Original document page number"),
        formNumber: z.string().optional().describe("Form number where this covered reason appears"),
        formTitle: z.string().optional().describe("Form title where this covered reason appears"),
        sectionRef: z.string().optional().describe("Section heading where this covered reason appears"),
        originalContent: z.string().optional().describe("Short verbatim source snippet used for this covered reason"),
      }),
    )
    .describe("Covered causes, perils, triggers, or reasons that affirmatively grant coverage"),
});

export type CoveredReasonsResult = z.infer<typeof CoveredReasonsSchema>;

export function buildCoveredReasonsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL covered reasons from this document. Preserve original wording verbatim.

A covered reason is affirmative coverage language explaining why, when, or for what cause the insurer will pay. This may be called a covered peril, covered cause of loss, accident, occurrence, loss trigger, additional coverage, expense, or insuring agreement grant.

For EACH covered reason, extract:
- coverageName: coverage, coverage part, or form this covered reason belongs to — REQUIRED
- reasonNumber: source number or letter for the covered reason, if shown
- title: covered peril, cause of loss, trigger, or short name
- content: full verbatim covered-reason or insuring-agreement text — REQUIRED
- conditions: conditions, timing rules, documentation requirements, or prerequisites attached to this covered reason
- exceptions: exceptions or limitations attached to this covered reason
- appliesTo: covered property, persons, autos, locations, operations, or coverage parts this reason applies to
- pageNumber: original document page number where this covered reason appears
- formNumber: form number where this covered reason appears, if shown
- formTitle: form title where this covered reason appears, if shown
- sectionRef: heading where this covered reason appears
- originalContent: short verbatim source snippet used for this covered reason

Focus on:
- Named perils and covered causes of loss
- Insuring agreement grants and coverage triggers
- Additional coverages and coverage extensions that state when payment applies
- Personal lines phrases such as fire, lightning, windstorm, hail, theft, collision, comprehensive, or accidental direct physical loss
- Commercial lines phrases such as bodily injury, property damage, personal and advertising injury, employee dishonesty, computer fraud, equipment breakdown, or professional services acts

Critical rules:
- Preserve the original content. Do not paraphrase content.
- Extract affirmative coverage grants, not exclusions, conditions, or declarations-only limit rows.
- Do not emit a covered reason from a table-of-contents entry, running header/footer, or reference that only points elsewhere.
- If a covered reason includes exceptions or limitations in the same clause, keep them in content and also list them in exceptions when they can be separated cleanly.
- Always include pageNumber when the covered reason appears on a specific page in the supplied document chunk.
- Preserve coverage grouping. Do not merge separate coverage parts into one generic list.

Return JSON only.`;
}
