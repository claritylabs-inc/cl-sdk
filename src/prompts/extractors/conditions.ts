import { z } from "zod";

export const ConditionsSchema = z.object({
  conditions: z
    .array(
      z.object({
        type: z
          .enum([
            "duties_after_loss",
            "cooperation",
            "cancellation",
            "nonrenewal",
            "subrogation",
            "other_insurance",
            "transfer_of_rights",
            "examination_under_oath",
            "arbitration",
            "suit_against_us",
            "liberalization",
            "other",
          ])
          .optional()
          .describe("Condition category"),
        title: z.string().describe("Condition title"),
        content: z.string().optional().describe("Full verbatim condition text"),
        noticeDays: z
          .number()
          .optional()
          .describe("Notice period in days if specified (e.g. cancellation notice)"),
      }),
    )
    .describe("All policy conditions found in the document"),
});

export type ConditionsResult = z.infer<typeof ConditionsSchema>;

export function buildConditionsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL policy conditions from this document. Preserve original language verbatim.

Focus on:
- Duties after loss / notice of occurrence conditions
- Cooperation clause
- Cancellation and nonrenewal conditions (extract notice period in days)
- Subrogation / transfer of rights
- Other insurance clause
- Examination under oath
- Arbitration or appraisal provisions
- Suit against us / legal action conditions
- Liberalization clause
- Any other named conditions

For cancellation and nonrenewal conditions, extract the specific notice period in days if stated.

Return JSON only.`;
}
