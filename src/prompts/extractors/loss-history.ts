import { z } from "zod";

export const LossHistorySchema = z.object({
  lossSummary: z
    .string()
    .optional()
    .describe("Summary of loss history, e.g. '3 claims in past 5 years totaling $125,000'"),
  individualClaims: z
    .array(
      z.object({
        date: z.string().optional().describe("Date of loss or claim"),
        type: z.string().optional().describe("Type of claim, e.g. 'property damage', 'bodily injury'"),
        description: z.string().optional().describe("Brief description of the claim"),
        amountPaid: z.string().optional().describe("Amount paid"),
        amountReserved: z.string().optional().describe("Amount reserved"),
        status: z
          .enum(["open", "closed", "reopened"])
          .optional()
          .describe("Claim status"),
        claimNumber: z.string().optional().describe("Claim reference number"),
      }),
    )
    .optional()
    .describe("Individual claim records"),
  experienceMod: z
    .string()
    .optional()
    .describe("Experience modification factor for workers comp, e.g. '0.85'"),
});

export type LossHistoryResult = z.infer<typeof LossHistorySchema>;

export function buildLossHistoryPrompt(): string {
  return `You are an expert insurance document analyst. Extract all loss history and claims information from this document.

Focus on:
- Loss history summary: total number of claims, time period, total amounts
- Individual claim records: date of loss, claim type, description, amounts paid and reserved, status, claim number
- Experience modification factor (for workers compensation policies)
- Loss runs or claims history schedules

Look for loss history sections, claims schedules, experience modification worksheets, and loss run reports.

Return JSON only.`;
}
