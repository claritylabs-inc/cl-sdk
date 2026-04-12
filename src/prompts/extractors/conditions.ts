import { z } from "zod";

export const ConditionsSchema = z.object({
  conditions: z
    .array(
      z.object({
        name: z.string().describe("Condition title"),
        conditionType: z
          .enum([
            "duties_after_loss",
            "notice_requirements",
            "other_insurance",
            "cancellation",
            "nonrenewal",
            "transfer_of_rights",
            "liberalization",
            "arbitration",
            "concealment_fraud",
            "examination_under_oath",
            "legal_action",
            "loss_payment",
            "appraisal",
            "mortgage_holders",
            "policy_territory",
            "separation_of_insureds",
            "other",
          ])
          .describe("Condition category"),
        content: z.string().describe("Full verbatim condition text"),
        keyValues: z
          .array(
            z.object({
              key: z.string().describe("Key name (e.g. 'noticePeriod', 'suitDeadline')"),
              value: z.string().describe("Value (e.g. '30 days', '2 years')"),
            }),
          )
          .optional()
          .describe("Key values extracted from the condition (notice periods, deadlines, etc.)"),
        pageNumber: z.number().optional().describe("Page number where condition appears"),
      }),
    )
    .describe("All policy conditions found in the document"),
});

export type ConditionsResult = z.infer<typeof ConditionsSchema>;

export function buildConditionsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL policy conditions from this document. Preserve original language verbatim.

For EACH condition, extract:
- name: condition title — REQUIRED
- conditionType: classify as one of: duties_after_loss, notice_requirements, other_insurance, cancellation, nonrenewal, transfer_of_rights, liberalization, arbitration, concealment_fraud, examination_under_oath, legal_action, loss_payment, appraisal, mortgage_holders, policy_territory, separation_of_insureds, other — REQUIRED
- content: full verbatim condition text — REQUIRED
- keyValues: extract specific values as key-value pairs (e.g. noticePeriod: "30 days", suitDeadline: "2 years")
- pageNumber: original document page number where the substantive condition text appears

Focus on:
- Duties after loss / notice of occurrence conditions
- Notice requirements (extract notice period as keyValue)
- Cancellation and nonrenewal conditions (extract notice period in days as keyValue)
- Other insurance clause
- Subrogation / transfer of rights
- Examination under oath
- Arbitration or appraisal provisions
- Suit against us / legal action conditions
- Liberalization clause
- Concealment or fraud clause
- Loss payment conditions
- Mortgage holders clause
- Any other named conditions

Critical rules:
- Ignore table-of-contents entries, section indexes, running headers/footers, and page references such as "Appraisal ..... 19".
- Do not emit a condition unless the page contains substantive condition text, not just a heading or reference.
- If a condition continues from a prior page, keep the substantive text together and use the page where the condition text appears in this extracted chunk.

Return JSON only.`;
}
