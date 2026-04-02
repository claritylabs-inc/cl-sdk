// Structured declarations data extracted from dec pages

import type { Address } from "./shared";
import type { DefenseCostTreatment, VehicleCoverageType } from "./enums";
import type { Sublimit, SharedLimit } from "./shared";

export interface EmployersLiabilityLimits {
  eachAccident: string;
  diseasePolicyLimit: string;
  diseaseEachEmployee: string;
}

export interface LimitSchedule {
  perOccurrence?: string;
  generalAggregate?: string;
  productsCompletedOpsAggregate?: string;
  personalAdvertisingInjury?: string;
  eachEmployee?: string;
  fireDamage?: string;
  medicalExpense?: string;
  combinedSingleLimit?: string;
  bodilyInjuryPerPerson?: string;
  bodilyInjuryPerAccident?: string;
  propertyDamage?: string;
  eachOccurrenceUmbrella?: string;
  umbrellaAggregate?: string;
  umbrellaRetention?: string;
  statutory?: boolean;
  employersLiability?: EmployersLiabilityLimits;
  sublimits?: Sublimit[];
  sharedLimits?: SharedLimit[];
  defenseCostTreatment?: DefenseCostTreatment;
}

export interface DeductibleSchedule {
  perClaim?: string;
  perOccurrence?: string;
  aggregateDeductible?: string;
  selfInsuredRetention?: string;
  corridorDeductible?: string;
  waitingPeriod?: string;
  appliesTo?: "damages_only" | "damages_and_defense" | "defense_only";
}

export interface InsuredLocation {
  number: number;
  address: Address;
  description?: string;
  buildingValue?: string;
  contentsValue?: string;
  businessIncomeValue?: string;
  constructionType?: string;
  yearBuilt?: number;
  squareFootage?: number;
  protectionClass?: string;
  sprinklered?: boolean;
  alarmType?: string;
  occupancy?: string;
}

export interface VehicleCoverage {
  type: VehicleCoverageType;
  limit?: string;
  deductible?: string;
  included: boolean;
}

export interface InsuredVehicle {
  number: number;
  year: number;
  make: string;
  model: string;
  vin: string;
  costNew?: string;
  statedValue?: string;
  garageLocation?: number;
  coverages?: VehicleCoverage[];
  radius?: string;
  vehicleType?: string;
}

export interface ClassificationCode {
  code: string;
  description: string;
  premiumBasis: string;
  basisAmount?: string;
  rate?: string;
  premium?: string;
  locationNumber?: number;
}
