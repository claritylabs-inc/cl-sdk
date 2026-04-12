import { z } from "zod";

export const PaymentInstallmentSchema = z.object({
  dueDate: z.string(),
  amount: z.string(),
  description: z.string().optional(),
});
export type PaymentInstallment = z.infer<typeof PaymentInstallmentSchema>;

export const PaymentPlanSchema = z.object({
  installments: z.array(PaymentInstallmentSchema),
  financeCharge: z.string().optional(),
});
export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;

export const LocationPremiumSchema = z.object({
  locationNumber: z.number(),
  premium: z.string(),
  description: z.string().optional(),
});
export type LocationPremium = z.infer<typeof LocationPremiumSchema>;
