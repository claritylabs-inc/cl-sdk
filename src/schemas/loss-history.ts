import { z } from "zod";
import { ClaimStatusSchema } from "./enums";

export const ClaimRecordSchema = z.object({
  dateOfLoss: z.string(),
  claimNumber: z.string().optional(),
  description: z.string(),
  status: ClaimStatusSchema,
  paid: z.string().optional(),
  reserved: z.string().optional(),
  incurred: z.string().optional(),
  claimant: z.string().optional(),
  coverageLine: z.string().optional(),
});
export type ClaimRecord = z.infer<typeof ClaimRecordSchema>;

export const LossSummarySchema = z.object({
  period: z.string().optional(),
  totalClaims: z.number().optional(),
  totalIncurred: z.string().optional(),
  totalPaid: z.string().optional(),
  totalReserved: z.string().optional(),
  lossRatio: z.string().optional(),
});
export type LossSummary = z.infer<typeof LossSummarySchema>;

export const ExperienceModSchema = z.object({
  factor: z.number(),
  effectiveDate: z.string().optional(),
  state: z.string().optional(),
});
export type ExperienceMod = z.infer<typeof ExperienceModSchema>;
