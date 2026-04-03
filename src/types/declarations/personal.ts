// Personal lines declarations variants

import type { Address } from "../shared";
import type { EndorsementParty } from "../endorsement";
import type {
  HomeownersFormType,
  DwellingFireFormType,
  FloodZone,
  LossSettlement,
  BoatType,
  RVType,
  ScheduledItemCategory,
  TitlePolicyType,
  PetSpecies,
} from "../enums";
import type { DwellingDetails, DriverRecord, PersonalVehicleDetails } from "./shared";

export interface HomeownersDeclarations {
  line: "homeowners";
  formType: HomeownersFormType;
  coverageA?: string;
  coverageB?: string;
  coverageC?: string;
  coverageD?: string;
  coverageE?: string;
  coverageF?: string;
  allPerilDeductible?: string;
  windHailDeductible?: string;
  hurricaneDeductible?: string;
  lossSettlement?: LossSettlement;
  dwelling: DwellingDetails;
  mortgagee?: EndorsementParty;
  additionalMortgagees?: EndorsementParty[];
}

export interface PersonalAutoDeclarations {
  line: "personal_auto";
  vehicles: PersonalVehicleDetails[];
  drivers: DriverRecord[];
  liabilityLimits?: {
    bodilyInjuryPerPerson?: string;
    bodilyInjuryPerAccident?: string;
    propertyDamage?: string;
    combinedSingleLimit?: string;
  };
  umLimits?: {
    bodilyInjuryPerPerson?: string;
    bodilyInjuryPerAccident?: string;
  };
  uimLimits?: {
    bodilyInjuryPerPerson?: string;
    bodilyInjuryPerAccident?: string;
  };
  pipLimit?: string;
  medPayLimit?: string;
}

export interface DwellingFireDeclarations {
  line: "dwelling_fire";
  formType: DwellingFireFormType;
  dwellingLimit?: string;
  otherStructuresLimit?: string;
  personalPropertyLimit?: string;
  fairRentalValueLimit?: string;
  liabilityLimit?: string;
  medicalPaymentsLimit?: string;
  deductible?: string;
  dwelling: DwellingDetails;
}

export interface FloodDeclarations {
  line: "flood";
  programType: "nfip" | "private";
  floodZone?: FloodZone;
  communityNumber?: string;
  communityRating?: number;
  buildingCoverage?: string;
  contentsCoverage?: string;
  iccCoverage?: string;
  deductible?: string;
  waitingPeriodDays?: number;
  elevationCertificate?: boolean;
  elevationDifference?: string;
  buildingDiagramNumber?: number;
  basementOrEnclosure?: boolean;
  postFirmConstruction?: boolean;
}

export interface EarthquakeDeclarations {
  line: "earthquake";
  dwellingCoverage?: string;
  contentsCoverage?: string;
  lossOfUseCoverage?: string;
  deductiblePercent?: number;
  retrofitDiscount?: boolean;
  masonryVeneerCoverage?: boolean;
}

export interface PersonalUmbrellaDeclarations {
  line: "personal_umbrella";
  perOccurrenceLimit?: string;
  aggregateLimit?: string;
  retainedLimit?: string;
  underlyingPolicies: Array<{
    carrier?: string;
    policyNumber?: string;
    policyType?: string;
    limits?: string;
  }>;
}

export interface PersonalArticlesDeclarations {
  line: "personal_articles";
  scheduledItems: Array<{
    itemNumber?: number;
    category?: ScheduledItemCategory;
    description: string;
    appraisedValue: string;
    appraisalDate?: string;
  }>;
  blanketCoverage?: string;
  deductible?: string;
  worldwideCoverage?: boolean;
  breakageCoverage?: boolean;
}

export interface WatercraftDeclarations {
  line: "watercraft";
  boatType?: BoatType;
  year?: number;
  make?: string;
  model?: string;
  length?: string;
  hullMaterial?: "fiberglass" | "aluminum" | "wood" | "steel" | "inflatable" | "other";
  hullValue?: string;
  motorHorsepower?: number;
  motorType?: "outboard" | "inboard" | "inboard_outboard" | "jet";
  navigationLimits?: string;
  layupPeriod?: string;
  liabilityLimit?: string;
  medicalPaymentsLimit?: string;
  physicalDamageDeductible?: string;
  uninsuredBoaterLimit?: string;
  trailerCovered?: boolean;
  trailerValue?: string;
}

export interface RecreationalVehicleDeclarations {
  line: "recreational_vehicle";
  vehicleType: RVType;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  value?: string;
  liabilityLimit?: string;
  collisionDeductible?: string;
  comprehensiveDeductible?: string;
  personalEffectsCoverage?: string;
  fullTimerCoverage?: boolean;
}

export interface FarmRanchDeclarations {
  line: "farm_ranch";
  dwellingCoverage?: string;
  farmPersonalPropertyCoverage?: string;
  farmLiabilityLimit?: string;
  farmAutoIncluded?: boolean;
  livestock?: Array<{
    type: string;
    headCount: number;
    value?: string;
  }>;
  equipmentSchedule?: Array<{
    description: string;
    value: string;
  }>;
  acreage?: number;
  dwelling?: DwellingDetails;
}

export interface TitleDeclarations {
  line: "title";
  policyType: TitlePolicyType;
  policyAmount: string;
  legalDescription?: string;
  propertyAddress?: Address;
  effectiveDate?: string;
  exceptions?: Array<{
    number: number;
    description: string;
  }>;
  underwriter?: string;
}

export interface PetDeclarations {
  line: "pet";
  species: PetSpecies;
  breed?: string;
  petName?: string;
  age?: number;
  annualLimit?: string;
  perIncidentLimit?: string;
  deductible?: string;
  reimbursementPercent?: number;
  waitingPeriodDays?: number;
  preExistingConditionsExcluded?: boolean;
  wellnessCoverage?: boolean;
}

export interface TravelDeclarations {
  line: "travel";
  tripDepartureDate?: string;
  tripReturnDate?: string;
  destinations?: string[];
  travelers?: Array<{
    name: string;
    age?: number;
  }>;
  tripCost?: string;
  tripCancellationLimit?: string;
  medicalLimit?: string;
  evacuationLimit?: string;
  baggageLimit?: string;
}

export interface IdentityTheftDeclarations {
  line: "identity_theft";
  coverageLimit?: string;
  expenseReimbursement?: string;
  creditMonitoring?: boolean;
  restorationServices?: boolean;
  lostWagesLimit?: string;
}
