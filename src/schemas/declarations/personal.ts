import { z } from "zod";
import {
  HomeownersFormTypeSchema,
  DwellingFireFormTypeSchema,
  FloodZoneSchema,
  LossSettlementSchema,
  BoatTypeSchema,
  RVTypeSchema,
  ScheduledItemCategorySchema,
  TitlePolicyTypeSchema,
  PetSpeciesSchema,
} from "../enums";
import { AddressSchema } from "../shared";
import { EndorsementPartySchema } from "../endorsement";
import { DwellingDetailsSchema, DriverRecordSchema, PersonalVehicleDetailsSchema } from "./shared";

// ── Homeowners ──

export const HomeownersDeclarationsSchema = z.object({
  line: z.literal("homeowners"),
  formType: HomeownersFormTypeSchema,
  coverageA: z.string().optional(),
  coverageB: z.string().optional(),
  coverageC: z.string().optional(),
  coverageD: z.string().optional(),
  coverageE: z.string().optional(),
  coverageF: z.string().optional(),
  allPerilDeductible: z.string().optional(),
  windHailDeductible: z.string().optional(),
  hurricaneDeductible: z.string().optional(),
  lossSettlement: LossSettlementSchema.optional(),
  dwelling: DwellingDetailsSchema,
  mortgagee: EndorsementPartySchema.optional(),
  additionalMortgagees: z.array(EndorsementPartySchema).optional(),
});
export type HomeownersDeclarations = z.infer<typeof HomeownersDeclarationsSchema>;

// ── Personal Auto ──

export const PersonalAutoDeclarationsSchema = z.object({
  line: z.literal("personal_auto"),
  vehicles: z.array(PersonalVehicleDetailsSchema),
  drivers: z.array(DriverRecordSchema),
  liabilityLimits: z.object({
    bodilyInjuryPerPerson: z.string().optional(),
    bodilyInjuryPerAccident: z.string().optional(),
    propertyDamage: z.string().optional(),
    combinedSingleLimit: z.string().optional(),
  }).optional(),
  umLimits: z.object({
    bodilyInjuryPerPerson: z.string().optional(),
    bodilyInjuryPerAccident: z.string().optional(),
  }).optional(),
  uimLimits: z.object({
    bodilyInjuryPerPerson: z.string().optional(),
    bodilyInjuryPerAccident: z.string().optional(),
  }).optional(),
  pipLimit: z.string().optional(),
  medPayLimit: z.string().optional(),
});
export type PersonalAutoDeclarations = z.infer<typeof PersonalAutoDeclarationsSchema>;

// ── Dwelling Fire ──

export const DwellingFireDeclarationsSchema = z.object({
  line: z.literal("dwelling_fire"),
  formType: DwellingFireFormTypeSchema,
  dwellingLimit: z.string().optional(),
  otherStructuresLimit: z.string().optional(),
  personalPropertyLimit: z.string().optional(),
  fairRentalValueLimit: z.string().optional(),
  liabilityLimit: z.string().optional(),
  medicalPaymentsLimit: z.string().optional(),
  deductible: z.string().optional(),
  dwelling: DwellingDetailsSchema,
});
export type DwellingFireDeclarations = z.infer<typeof DwellingFireDeclarationsSchema>;

// ── Flood ──

export const FloodDeclarationsSchema = z.object({
  line: z.literal("flood"),
  programType: z.enum(["nfip", "private"]),
  floodZone: FloodZoneSchema.optional(),
  communityNumber: z.string().optional(),
  communityRating: z.number().optional(),
  buildingCoverage: z.string().optional(),
  contentsCoverage: z.string().optional(),
  iccCoverage: z.string().optional(),
  deductible: z.string().optional(),
  waitingPeriodDays: z.number().optional(),
  elevationCertificate: z.boolean().optional(),
  elevationDifference: z.string().optional(),
  buildingDiagramNumber: z.number().optional(),
  basementOrEnclosure: z.boolean().optional(),
  postFirmConstruction: z.boolean().optional(),
});
export type FloodDeclarations = z.infer<typeof FloodDeclarationsSchema>;

// ── Earthquake ──

export const EarthquakeDeclarationsSchema = z.object({
  line: z.literal("earthquake"),
  dwellingCoverage: z.string().optional(),
  contentsCoverage: z.string().optional(),
  lossOfUseCoverage: z.string().optional(),
  deductiblePercent: z.number().optional(),
  retrofitDiscount: z.boolean().optional(),
  masonryVeneerCoverage: z.boolean().optional(),
});
export type EarthquakeDeclarations = z.infer<typeof EarthquakeDeclarationsSchema>;

// ── Personal Umbrella ──

export const PersonalUmbrellaDeclarationsSchema = z.object({
  line: z.literal("personal_umbrella"),
  perOccurrenceLimit: z.string().optional(),
  aggregateLimit: z.string().optional(),
  retainedLimit: z.string().optional(),
  underlyingPolicies: z.array(z.object({
    carrier: z.string().optional(),
    policyNumber: z.string().optional(),
    policyType: z.string().optional(),
    limits: z.string().optional(),
  })),
});
export type PersonalUmbrellaDeclarations = z.infer<typeof PersonalUmbrellaDeclarationsSchema>;

// ── Personal Articles ──

export const PersonalArticlesDeclarationsSchema = z.object({
  line: z.literal("personal_articles"),
  scheduledItems: z.array(z.object({
    itemNumber: z.number().optional(),
    category: ScheduledItemCategorySchema.optional(),
    description: z.string(),
    appraisedValue: z.string(),
    appraisalDate: z.string().optional(),
  })),
  blanketCoverage: z.string().optional(),
  deductible: z.string().optional(),
  worldwideCoverage: z.boolean().optional(),
  breakageCoverage: z.boolean().optional(),
});
export type PersonalArticlesDeclarations = z.infer<typeof PersonalArticlesDeclarationsSchema>;

// ── Watercraft ──

export const WatercraftDeclarationsSchema = z.object({
  line: z.literal("watercraft"),
  boatType: BoatTypeSchema.optional(),
  year: z.number().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  length: z.string().optional(),
  hullMaterial: z.enum(["fiberglass", "aluminum", "wood", "steel", "inflatable", "other"]).optional(),
  hullValue: z.string().optional(),
  motorHorsepower: z.number().optional(),
  motorType: z.enum(["outboard", "inboard", "inboard_outboard", "jet"]).optional(),
  navigationLimits: z.string().optional(),
  layupPeriod: z.string().optional(),
  liabilityLimit: z.string().optional(),
  medicalPaymentsLimit: z.string().optional(),
  physicalDamageDeductible: z.string().optional(),
  uninsuredBoaterLimit: z.string().optional(),
  trailerCovered: z.boolean().optional(),
  trailerValue: z.string().optional(),
});
export type WatercraftDeclarations = z.infer<typeof WatercraftDeclarationsSchema>;

// ── Recreational Vehicle ──

export const RecreationalVehicleDeclarationsSchema = z.object({
  line: z.literal("recreational_vehicle"),
  vehicleType: RVTypeSchema,
  year: z.number().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  vin: z.string().optional(),
  value: z.string().optional(),
  liabilityLimit: z.string().optional(),
  collisionDeductible: z.string().optional(),
  comprehensiveDeductible: z.string().optional(),
  personalEffectsCoverage: z.string().optional(),
  fullTimerCoverage: z.boolean().optional(),
});
export type RecreationalVehicleDeclarations = z.infer<typeof RecreationalVehicleDeclarationsSchema>;

// ── Farm/Ranch ──

export const FarmRanchDeclarationsSchema = z.object({
  line: z.literal("farm_ranch"),
  dwellingCoverage: z.string().optional(),
  farmPersonalPropertyCoverage: z.string().optional(),
  farmLiabilityLimit: z.string().optional(),
  farmAutoIncluded: z.boolean().optional(),
  livestock: z.array(z.object({
    type: z.string(),
    headCount: z.number(),
    value: z.string().optional(),
  })).optional(),
  equipmentSchedule: z.array(z.object({
    description: z.string(),
    value: z.string(),
  })).optional(),
  acreage: z.number().optional(),
  dwelling: DwellingDetailsSchema.optional(),
});
export type FarmRanchDeclarations = z.infer<typeof FarmRanchDeclarationsSchema>;

// ── Title ──

export const TitleDeclarationsSchema = z.object({
  line: z.literal("title"),
  policyType: TitlePolicyTypeSchema,
  policyAmount: z.string(),
  legalDescription: z.string().optional(),
  propertyAddress: AddressSchema.optional(),
  effectiveDate: z.string().optional(),
  exceptions: z.array(z.object({
    number: z.number(),
    description: z.string(),
  })).optional(),
  underwriter: z.string().optional(),
});
export type TitleDeclarations = z.infer<typeof TitleDeclarationsSchema>;

// ── Pet ──

export const PetDeclarationsSchema = z.object({
  line: z.literal("pet"),
  species: PetSpeciesSchema,
  breed: z.string().optional(),
  petName: z.string().optional(),
  age: z.number().optional(),
  annualLimit: z.string().optional(),
  perIncidentLimit: z.string().optional(),
  deductible: z.string().optional(),
  reimbursementPercent: z.number().optional(),
  waitingPeriodDays: z.number().optional(),
  preExistingConditionsExcluded: z.boolean().optional(),
  wellnessCoverage: z.boolean().optional(),
});
export type PetDeclarations = z.infer<typeof PetDeclarationsSchema>;

// ── Travel ──

export const TravelDeclarationsSchema = z.object({
  line: z.literal("travel"),
  tripDepartureDate: z.string().optional(),
  tripReturnDate: z.string().optional(),
  destinations: z.array(z.string()).optional(),
  travelers: z.array(z.object({
    name: z.string(),
    age: z.number().optional(),
  })).optional(),
  tripCost: z.string().optional(),
  tripCancellationLimit: z.string().optional(),
  medicalLimit: z.string().optional(),
  evacuationLimit: z.string().optional(),
  baggageLimit: z.string().optional(),
});
export type TravelDeclarations = z.infer<typeof TravelDeclarationsSchema>;

// ── Identity Theft ──

export const IdentityTheftDeclarationsSchema = z.object({
  line: z.literal("identity_theft"),
  coverageLimit: z.string().optional(),
  expenseReimbursement: z.string().optional(),
  creditMonitoring: z.boolean().optional(),
  restorationServices: z.boolean().optional(),
  lostWagesLimit: z.string().optional(),
});
export type IdentityTheftDeclarations = z.infer<typeof IdentityTheftDeclarationsSchema>;
