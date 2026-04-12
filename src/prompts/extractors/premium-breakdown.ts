import { z } from "zod";

export const PremiumBreakdownSchema = z.object({
  premium: z.string().optional().describe("Total premium amount, e.g. '$5,000'"),
  totalCost: z
    .string()
    .optional()
    .describe("Total cost including taxes and fees, e.g. '$5,250'"),
  premiumBreakdown: z
    .array(
      z.object({
        line: z.string().describe("Coverage line name"),
        amount: z.string().describe("Premium amount for this line"),
      }),
    )
    .optional()
    .describe("Per-coverage-line premium breakdown"),
  taxesAndFees: z
    .array(
      z.object({
        name: z.string().describe("Fee or tax name"),
        amount: z.string().describe("Dollar amount"),
        type: z
          .enum(["tax", "fee", "surcharge", "assessment"])
          .optional()
          .describe("Fee category"),
      }),
    )
    .optional()
    .describe("Taxes, fees, surcharges, and assessments"),
  minimumPremium: z.string().optional().describe("Minimum premium if stated"),
  depositPremium: z.string().optional().describe("Deposit premium if stated"),
  paymentPlan: z.string().optional().describe("Payment plan description"),
  auditType: z
    .enum(["annual", "semi_annual", "quarterly", "monthly", "final", "self"])
    .optional()
    .describe("Premium audit type"),
  ratingBasis: z
    .string()
    .optional()
    .describe("Rating basis, e.g. payroll, revenue, area, units"),
});

export type PremiumBreakdownResult = z.infer<typeof PremiumBreakdownSchema>;

export function buildPremiumBreakdownPrompt(): string {
  return `You are an expert insurance document analyst. Extract all premium and cost information from this document.

Focus on:
- Total premium and total cost (including taxes/fees)
- Per-coverage-line premium breakdown if available
- Taxes, fees, surcharges, and assessments with their amounts and types
- Minimum premium and deposit premium if stated
- Payment plan details (installment options, due dates)
- Audit type: annual, semi-annual, quarterly, monthly, final, or self-audit
- Rating basis: payroll, revenue, area, units, or other

Look on the declarations page, premium summary, and any premium/cost schedules.

Return JSON only.`;
}
