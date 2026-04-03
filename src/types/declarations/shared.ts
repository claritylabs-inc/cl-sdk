// Shared types used by both personal and commercial declarations variants

import type { Address } from "../shared";
import type {
  ConstructionType,
  RoofType,
  FoundationType,
  PersonalAutoUsage,
} from "../enums";
import type { EndorsementParty } from "../endorsement";

/** Residential dwelling details — shared by homeowners, dwelling fire, farm/ranch */
export interface DwellingDetails {
  constructionType?: ConstructionType;
  yearBuilt?: number;
  squareFootage?: number;
  stories?: number;
  roofType?: RoofType;
  roofAge?: number;
  heatingType?: "central" | "baseboard" | "radiant" | "space_heater" | "heat_pump" | "other";
  foundationType?: FoundationType;
  plumbingType?: "copper" | "pex" | "galvanized" | "polybutylene" | "cpvc" | "other";
  electricalType?: "circuit_breaker" | "fuse_box" | "knob_and_tube" | "other";
  electricalAmps?: number;
  hasSwimmingPool?: boolean;
  poolType?: "in_ground" | "above_ground";
  hasTrampoline?: boolean;
  hasDog?: boolean;
  dogBreed?: string;
  protectiveDevices?: string[];
  distanceToFireStation?: string;
  distanceToHydrant?: string;
  fireProtectionClass?: string;
}

/** Personal auto driver record */
export interface DriverRecord {
  name: string;
  dateOfBirth?: string;
  licenseNumber?: string;
  licenseState?: string;
  relationship?: "named_insured" | "spouse" | "child" | "other_household" | "other";
  yearsLicensed?: number;
  gender?: string;
  maritalStatus?: string;
  goodStudentDiscount?: boolean;
  defensiveDriverDiscount?: boolean;
  violations?: Array<{
    date?: string;
    type?: string;
    description?: string;
  }>;
  accidents?: Array<{
    date?: string;
    atFault?: boolean;
    description?: string;
    amountPaid?: string;
  }>;
  sr22Required?: boolean;
}

/** Personal auto vehicle details */
export interface PersonalVehicleDetails {
  number?: number;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  bodyType?: string;
  garagingAddress?: Address;
  usage?: PersonalAutoUsage;
  annualMileage?: number;
  odometerReading?: number;
  driverAssignment?: string;
  lienHolder?: EndorsementParty;
  collisionDeductible?: string;
  comprehensiveDeductible?: string;
  rentalReimbursement?: boolean;
  towing?: boolean;
}

// Import all declarations variants for the union
import type { HomeownersDeclarations, PersonalAutoDeclarations, DwellingFireDeclarations, FloodDeclarations, EarthquakeDeclarations, PersonalUmbrellaDeclarations, PersonalArticlesDeclarations, WatercraftDeclarations, RecreationalVehicleDeclarations, FarmRanchDeclarations, TitleDeclarations, PetDeclarations, TravelDeclarations, IdentityTheftDeclarations } from "./personal";
import type { GLDeclarations, CommercialPropertyDeclarations, CommercialAutoDeclarations, WorkersCompDeclarations, UmbrellaExcessDeclarations, ProfessionalLiabilityDeclarations, CyberDeclarations, DODeclarations, CrimeDeclarations } from "./commercial";

/** Discriminated union of all line-specific declarations variants */
export type Declarations =
  // Personal lines
  | HomeownersDeclarations
  | PersonalAutoDeclarations
  | DwellingFireDeclarations
  | FloodDeclarations
  | EarthquakeDeclarations
  | PersonalUmbrellaDeclarations
  | PersonalArticlesDeclarations
  | WatercraftDeclarations
  | RecreationalVehicleDeclarations
  | FarmRanchDeclarations
  | TitleDeclarations
  | PetDeclarations
  | TravelDeclarations
  | IdentityTheftDeclarations
  // Commercial lines
  | GLDeclarations
  | CommercialPropertyDeclarations
  | CommercialAutoDeclarations
  | WorkersCompDeclarations
  | UmbrellaExcessDeclarations
  | ProfessionalLiabilityDeclarations
  | CyberDeclarations
  | DODeclarations
  | CrimeDeclarations;
