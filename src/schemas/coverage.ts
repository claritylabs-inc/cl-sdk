import { z } from "zod";
import {
  LimitTypeSchema,
  DeductibleTypeSchema,
  CoverageTriggerSchema,
  ValuationMethodSchema,
} from "./enums";

export const CoverageSchema = z.object({
  name: z.string(),
  limit: z.string(),
  deductible: z.string().optional(),
  pageNumber: z.number().optional(),
  sectionRef: z.string().optional(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const EnrichedCoverageSchema = z.object({
  name: z.string(),
  coverageCode: z.string().optional(),
  formNumber: z.string().optional(),
  formEditionDate: z.string().optional(),
  limit: z.string(),
  limitType: LimitTypeSchema.optional(),
  deductible: z.string().optional(),
  deductibleType: DeductibleTypeSchema.optional(),
  sir: z.string().optional(),
  sublimit: z.string().optional(),
  coinsurance: z.string().optional(),
  valuation: ValuationMethodSchema.optional(),
  territory: z.string().optional(),
  trigger: CoverageTriggerSchema.optional(),
  retroactiveDate: z.string().optional(),
  included: z.boolean(),
  premium: z.string().optional(),
  pageNumber: z.number().optional(),
  sectionRef: z.string().optional(),
});
export type EnrichedCoverage = z.infer<typeof EnrichedCoverageSchema>;
