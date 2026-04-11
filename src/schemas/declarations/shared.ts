import { z } from "zod";
import {
  ConstructionTypeSchema,
  RoofTypeSchema,
  FoundationTypeSchema,
  PersonalAutoUsageSchema,
  DefenseCostTreatmentSchema,
  VehicleCoverageTypeSchema,
} from "../enums";
import { AddressSchema, SublimitSchema, SharedLimitSchema } from "../shared";
import { EndorsementPartySchema } from "../endorsement";

// ── EmployersLiabilityLimits ──

export const EmployersLiabilityLimitsSchema = z.object({
  eachAccident: z.string(),
  diseasePolicyLimit: z.string(),
  diseaseEachEmployee: z.string(),
});
export type EmployersLiabilityLimits = z.infer<typeof EmployersLiabilityLimitsSchema>;

// ── LimitSchedule ──

export const LimitScheduleSchema = z.object({
  perOccurrence: z.string().optional(),
  generalAggregate: z.string().optional(),
  productsCompletedOpsAggregate: z.string().optional(),
  personalAdvertisingInjury: z.string().optional(),
  eachEmployee: z.string().optional(),
  fireDamage: z.string().optional(),
  medicalExpense: z.string().optional(),
  combinedSingleLimit: z.string().optional(),
  bodilyInjuryPerPerson: z.string().optional(),
  bodilyInjuryPerAccident: z.string().optional(),
  propertyDamage: z.string().optional(),
  eachOccurrenceUmbrella: z.string().optional(),
  umbrellaAggregate: z.string().optional(),
  umbrellaRetention: z.string().optional(),
  statutory: z.boolean().optional(),
  employersLiability: EmployersLiabilityLimitsSchema.optional(),
  sublimits: z.array(SublimitSchema).optional(),
  sharedLimits: z.array(SharedLimitSchema).optional(),
  defenseCostTreatment: DefenseCostTreatmentSchema.optional(),
});
export type LimitSchedule = z.infer<typeof LimitScheduleSchema>;

// ── DeductibleSchedule ──

export const DeductibleScheduleSchema = z.object({
  perClaim: z.string().optional(),
  perOccurrence: z.string().optional(),
  aggregateDeductible: z.string().optional(),
  selfInsuredRetention: z.string().optional(),
  corridorDeductible: z.string().optional(),
  waitingPeriod: z.string().optional(),
  appliesTo: z.enum(["damages_only", "damages_and_defense", "defense_only"]).optional(),
});
export type DeductibleSchedule = z.infer<typeof DeductibleScheduleSchema>;

// ── InsuredLocation ──

export const InsuredLocationSchema = z.object({
  number: z.number(),
  address: AddressSchema,
  description: z.string().optional(),
  buildingValue: z.string().optional(),
  contentsValue: z.string().optional(),
  businessIncomeValue: z.string().optional(),
  constructionType: z.string().optional(),
  yearBuilt: z.number().optional(),
  squareFootage: z.number().optional(),
  protectionClass: z.string().optional(),
  sprinklered: z.boolean().optional(),
  alarmType: z.string().optional(),
  occupancy: z.string().optional(),
});
export type InsuredLocation = z.infer<typeof InsuredLocationSchema>;

// ── VehicleCoverage ──

export const VehicleCoverageSchema = z.object({
  type: VehicleCoverageTypeSchema,
  limit: z.string().optional(),
  deductible: z.string().optional(),
  included: z.boolean(),
});
export type VehicleCoverage = z.infer<typeof VehicleCoverageSchema>;

// ── InsuredVehicle ──

export const InsuredVehicleSchema = z.object({
  number: z.number(),
  year: z.number(),
  make: z.string(),
  model: z.string(),
  vin: z.string(),
  costNew: z.string().optional(),
  statedValue: z.string().optional(),
  garageLocation: z.number().optional(),
  coverages: z.array(VehicleCoverageSchema).optional(),
  radius: z.string().optional(),
  vehicleType: z.string().optional(),
});
export type InsuredVehicle = z.infer<typeof InsuredVehicleSchema>;

// ── ClassificationCode ──

export const ClassificationCodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  premiumBasis: z.string(),
  basisAmount: z.string().optional(),
  rate: z.string().optional(),
  premium: z.string().optional(),
  locationNumber: z.number().optional(),
});
export type ClassificationCode = z.infer<typeof ClassificationCodeSchema>;

// ── DwellingDetails ──

export const DwellingDetailsSchema = z.object({
  constructionType: ConstructionTypeSchema.optional(),
  yearBuilt: z.number().optional(),
  squareFootage: z.number().optional(),
  stories: z.number().optional(),
  roofType: RoofTypeSchema.optional(),
  roofAge: z.number().optional(),
  heatingType: z.enum(["central", "baseboard", "radiant", "space_heater", "heat_pump", "other"]).optional(),
  foundationType: FoundationTypeSchema.optional(),
  plumbingType: z.enum(["copper", "pex", "galvanized", "polybutylene", "cpvc", "other"]).optional(),
  electricalType: z.enum(["circuit_breaker", "fuse_box", "knob_and_tube", "other"]).optional(),
  electricalAmps: z.number().optional(),
  hasSwimmingPool: z.boolean().optional(),
  poolType: z.enum(["in_ground", "above_ground"]).optional(),
  hasTrampoline: z.boolean().optional(),
  hasDog: z.boolean().optional(),
  dogBreed: z.string().optional(),
  protectiveDevices: z.array(z.string()).optional(),
  distanceToFireStation: z.string().optional(),
  distanceToHydrant: z.string().optional(),
  fireProtectionClass: z.string().optional(),
});
export type DwellingDetails = z.infer<typeof DwellingDetailsSchema>;

// ── DriverRecord ──

export const DriverRecordSchema = z.object({
  name: z.string(),
  dateOfBirth: z.string().optional(),
  licenseNumber: z.string().optional(),
  licenseState: z.string().optional(),
  relationship: z.enum(["named_insured", "spouse", "child", "other_household", "other"]).optional(),
  yearsLicensed: z.number().optional(),
  gender: z.string().optional(),
  maritalStatus: z.string().optional(),
  goodStudentDiscount: z.boolean().optional(),
  defensiveDriverDiscount: z.boolean().optional(),
  violations: z.array(z.object({
    date: z.string().optional(),
    type: z.string().optional(),
    description: z.string().optional(),
  })).optional(),
  accidents: z.array(z.object({
    date: z.string().optional(),
    atFault: z.boolean().optional(),
    description: z.string().optional(),
    amountPaid: z.string().optional(),
  })).optional(),
  sr22Required: z.boolean().optional(),
});
export type DriverRecord = z.infer<typeof DriverRecordSchema>;

// ── PersonalVehicleDetails ──

export const PersonalVehicleDetailsSchema = z.object({
  number: z.number().optional(),
  year: z.number().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  vin: z.string().optional(),
  bodyType: z.string().optional(),
  garagingAddress: AddressSchema.optional(),
  usage: PersonalAutoUsageSchema.optional(),
  annualMileage: z.number().optional(),
  odometerReading: z.number().optional(),
  driverAssignment: z.string().optional(),
  lienHolder: EndorsementPartySchema.optional(),
  collisionDeductible: z.string().optional(),
  comprehensiveDeductible: z.string().optional(),
  rentalReimbursement: z.boolean().optional(),
  towing: z.boolean().optional(),
});
export type PersonalVehicleDetails = z.infer<typeof PersonalVehicleDetailsSchema>;
