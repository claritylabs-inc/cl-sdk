import { z } from "zod";

export const PremiumBreakdownSchema = z.object({
  premium: z.string().optional().describe("Total premium amount, e.g. '$5,000'"),
  premiumAmount: z.number().optional().describe("Total premium as a plain number with no currency symbols or commas"),
  totalCost: z
    .string()
    .optional()
    .describe("Total cost including taxes and fees, e.g. '$5,250'"),
  totalCostAmount: z.number().optional().describe("Total cost as a plain number with no currency symbols or commas"),
  premiumBreakdown: z
    .array(
      z.object({
        line: z.string().describe("Coverage line name"),
        amount: z.string().describe("Premium amount for this line"),
        amountValue: z.number().optional().describe("Premium amount as a plain number with no currency symbols or commas"),
      }),
    )
    .optional()
    .describe("Per-coverage-line premium breakdown"),
  taxesAndFees: z
    .array(
      z.object({
        name: z.string().describe("Fee or tax name"),
        amount: z.string().describe("Dollar amount"),
        amountValue: z.number().optional().describe("Fee or tax amount as a plain number with no currency symbols or commas"),
        type: z
          .enum(["tax", "fee", "surcharge", "assessment"])
          .optional()
          .describe("Fee category"),
      }),
    )
    .optional()
    .describe("Taxes, fees, surcharges, and assessments"),
  minimumPremium: z.string().optional().describe("Minimum premium if stated"),
  minimumPremiumAmount: z.number().optional().describe("Minimum premium as a plain number when the source states a fixed amount"),
  depositPremium: z.string().optional().describe("Deposit premium if stated"),
  depositPremiumAmount: z.number().optional().describe("Deposit premium as a plain number when the source states a fixed amount"),
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
- Plain numeric amount fields for stated money values, without currency symbols or commas
- Per-coverage-line premium breakdown if available
- Taxes, fees, surcharges, and assessments with their amounts and types
- Minimum premium and deposit premium if stated
- Payment plan details (installment options, due dates)
- Audit type: annual, semi-annual, quarterly, monthly, final, or self-audit
- Rating basis: payroll, revenue, area, units, or other

Look on the declarations page, premium summary, and any premium/cost schedules.
Prefer premium tables and schedules over definitions, exclusions, rating-basis narratives, licensing statements, or descriptions of premium trust funds. Do not use unrelated business volume, controlled written premium, deductible, limit, tax-only, fee-only, or percentage-only values as the policy premium.

Return JSON only.`;
}
