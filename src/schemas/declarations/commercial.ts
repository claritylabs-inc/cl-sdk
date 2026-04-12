import { z } from "zod";
import {
  CoverageFormSchema,
  DefenseCostTreatmentSchema,
  ValuationMethodSchema,
} from "../enums";
import { ExtendedReportingPeriodSchema } from "../shared";
import { ExperienceModSchema } from "../loss-history";
import {
  InsuredLocationSchema,
  InsuredVehicleSchema,
  ClassificationCodeSchema,
  EmployersLiabilityLimitsSchema,
} from "./shared";

// ── General Liability ──

export const GLDeclarationsSchema = z.object({
  line: z.literal("gl"),
  coverageForm: CoverageFormSchema.optional(),
  perOccurrenceLimit: z.string().optional(),
  generalAggregate: z.string().optional(),
  productsCompletedOpsAggregate: z.string().optional(),
  personalAdvertisingInjury: z.string().optional(),
  fireDamage: z.string().optional(),
  medicalExpense: z.string().optional(),
  defenseCostTreatment: DefenseCostTreatmentSchema.optional(),
  deductible: z.string().optional(),
  classifications: z.array(ClassificationCodeSchema).optional(),
  retroactiveDate: z.string().optional(),
});
export type GLDeclarations = z.infer<typeof GLDeclarationsSchema>;

// ── Commercial Property ──

export const CommercialPropertyDeclarationsSchema = z.object({
  line: z.literal("commercial_property"),
  causesOfLossForm: z.enum(["basic", "broad", "special"]).optional(),
  coinsurancePercent: z.number().optional(),
  valuationMethod: ValuationMethodSchema.optional(),
  locations: z.array(InsuredLocationSchema),
  blanketLimit: z.string().optional(),
  businessIncomeLimit: z.string().optional(),
  extraExpenseLimit: z.string().optional(),
});
export type CommercialPropertyDeclarations = z.infer<typeof CommercialPropertyDeclarationsSchema>;

// ── Commercial Auto ──

export const CommercialAutoDeclarationsSchema = z.object({
  line: z.literal("commercial_auto"),
  vehicles: z.array(InsuredVehicleSchema),
  coveredAutoSymbols: z.array(z.number()).optional(),
  liabilityLimit: z.string().optional(),
  umLimit: z.string().optional(),
  uimLimit: z.string().optional(),
  hiredAutoLiability: z.boolean().optional(),
  nonOwnedAutoLiability: z.boolean().optional(),
});
export type CommercialAutoDeclarations = z.infer<typeof CommercialAutoDeclarationsSchema>;

// ── Workers' Compensation ──

export const WorkersCompDeclarationsSchema = z.object({
  line: z.literal("workers_comp"),
  coveredStates: z.array(z.string()).optional(),
  classifications: z.array(ClassificationCodeSchema),
  experienceMod: ExperienceModSchema.optional(),
  employersLiability: EmployersLiabilityLimitsSchema.optional(),
});
export type WorkersCompDeclarations = z.infer<typeof WorkersCompDeclarationsSchema>;

// ── Umbrella/Excess ──

export const UmbrellaExcessDeclarationsSchema = z.object({
  line: z.literal("umbrella_excess"),
  perOccurrenceLimit: z.string().optional(),
  aggregateLimit: z.string().optional(),
  retention: z.string().optional(),
  underlyingPolicies: z.array(z.object({
    carrier: z.string().optional(),
    policyNumber: z.string().optional(),
    policyType: z.string().optional(),
    limits: z.string().optional(),
  })),
});
export type UmbrellaExcessDeclarations = z.infer<typeof UmbrellaExcessDeclarationsSchema>;

// ── Professional Liability ──

export const ProfessionalLiabilityDeclarationsSchema = z.object({
  line: z.literal("professional_liability"),
  perClaimLimit: z.string().optional(),
  aggregateLimit: z.string().optional(),
  retroactiveDate: z.string().optional(),
  defenseCostTreatment: DefenseCostTreatmentSchema.optional(),
  extendedReportingPeriod: ExtendedReportingPeriodSchema.optional(),
});
export type ProfessionalLiabilityDeclarations = z.infer<typeof ProfessionalLiabilityDeclarationsSchema>;

// ── Cyber ──

export const CyberDeclarationsSchema = z.object({
  line: z.literal("cyber"),
  aggregateLimit: z.string().optional(),
  retroactiveDate: z.string().optional(),
  waitingPeriodHours: z.number().optional(),
  sublimits: z.array(z.object({
    coverageName: z.string(),
    limit: z.string(),
  })).optional(),
});
export type CyberDeclarations = z.infer<typeof CyberDeclarationsSchema>;

// ── Directors & Officers ──

export const DODeclarationsSchema = z.object({
  line: z.literal("directors_officers"),
  sideALimit: z.string().optional(),
  sideBLimit: z.string().optional(),
  sideCLimit: z.string().optional(),
  sideARetention: z.string().optional(),
  sideBRetention: z.string().optional(),
  sideCRetention: z.string().optional(),
  continuityDate: z.string().optional(),
});
export type DODeclarations = z.infer<typeof DODeclarationsSchema>;

// ── Crime ──

export const CrimeDeclarationsSchema = z.object({
  line: z.literal("crime"),
  formType: z.enum(["discovery", "loss_sustained"]).optional(),
  agreements: z.array(z.object({
    agreement: z.string(),
    coverageName: z.string(),
    limit: z.string(),
    deductible: z.string(),
  })),
});
export type CrimeDeclarations = z.infer<typeof CrimeDeclarationsSchema>;
