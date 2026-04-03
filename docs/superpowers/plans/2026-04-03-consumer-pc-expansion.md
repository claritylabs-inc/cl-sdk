# Consumer P&C Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the CL-0 SDK from commercial-only to full commercial + consumer (personal lines) P&C insurance support with a typed declarations union system.

**Architecture:** Extend existing types with 19 new PolicyType values. Replace flat line-specific fields on BaseDocument with a `declarations?: Declarations` discriminated union keyed by `line`. Pipeline populates both deprecated flat fields and new declarations for backward compat. Expand all extraction prompts, agent modules, and reference docs.

**Tech Stack:** TypeScript, tsup (ESM+CJS+types), Vercel AI SDK (`ai`), pdf-lib

**Spec:** `docs/superpowers/specs/2026-04-03-consumer-pc-expansion-design.md`

**Validation:** `npm run typecheck` (no test runner configured)

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/types/declarations/shared.ts` | DwellingDetails, DriverRecord, PersonalVehicleDetails, FloodZone and other personal-lines union types, Declarations discriminated union |
| `src/types/declarations/personal.ts` | All 14 personal lines declarations interfaces |
| `src/types/declarations/commercial.ts` | All 9 commercial lines declarations interfaces |
| `src/types/declarations/index.ts` | Re-exports from shared, personal, commercial |

### Modified Files
| File | Changes |
|---|---|
| `src/types/enums.ts` | Add 19 PolicyType values, new union types, expand EntityType and RatingBasisType |
| `src/types/document.ts` | Add `declarations?: Declarations`, deprecate flat fields |
| `src/types/context-keys.ts` | Add ~20 personal lines context key mappings |
| `src/prompts/extraction.ts` | Expand prompts for personal lines, add `buildPersonalLinesHint` |
| `src/extraction/pipeline.ts` | `applyExtracted`/`applyExtractedQuote` construct Declarations variant |
| `src/prompts/agent/quotes-policies.ts` | Personal lines coverage guidance |
| `src/prompts/agent/coverage-gaps.ts` | Personal lines coverage gap patterns |
| `src/prompts/intent.ts` | Personal lines intent classification |
| `src/index.ts` | Export new declarations types |
| `docs/data-dictionary.md` | Add personal lines domains |
| `docs/form-structure-guide.md` | Add Part 6 (personal lines forms) |
| `docs/line-of-business-profiles.md` | Add ~15 new LOB profiles |

---

### Task 1: Expand Enums

**Files:**
- Modify: `src/types/enums.ts`

- [ ] **Step 1: Add 19 new PolicyType values and update POLICY_TYPES array**

In `src/types/enums.ts`, replace the `PolicyType` type and `POLICY_TYPES` array with:

```typescript
// Canonical enum/union types for the insurance data model

/** Commercial + Personal lines (42 values) */
export type PolicyType =
  // ── Commercial lines ──
  | "general_liability"
  | "commercial_property"
  | "commercial_auto"
  | "non_owned_auto"
  | "workers_comp"
  | "umbrella"
  | "excess_liability"
  | "professional_liability"
  | "cyber"
  | "epli"
  | "directors_officers"
  | "fiduciary_liability"
  | "crime_fidelity"
  | "inland_marine"
  | "builders_risk"
  | "environmental"
  | "ocean_marine"
  | "surety"
  | "product_liability"
  | "bop"
  | "management_liability_package"
  | "property"
  // ── Personal lines ──
  | "homeowners_ho3"
  | "homeowners_ho5"
  | "renters_ho4"
  | "condo_ho6"
  | "dwelling_fire"
  | "mobile_home"
  | "personal_auto"
  | "personal_umbrella"
  | "flood_nfip"
  | "flood_private"
  | "earthquake"
  | "personal_inland_marine"
  | "watercraft"
  | "recreational_vehicle"
  | "farm_ranch"
  | "pet"
  | "travel"
  | "identity_theft"
  | "title"
  | "other";

/** All policy types as a runtime array for use in prompts */
export const POLICY_TYPES: PolicyType[] = [
  "general_liability",
  "commercial_property",
  "commercial_auto",
  "non_owned_auto",
  "workers_comp",
  "umbrella",
  "excess_liability",
  "professional_liability",
  "cyber",
  "epli",
  "directors_officers",
  "fiduciary_liability",
  "crime_fidelity",
  "inland_marine",
  "builders_risk",
  "environmental",
  "ocean_marine",
  "surety",
  "product_liability",
  "bop",
  "management_liability_package",
  "property",
  "homeowners_ho3",
  "homeowners_ho5",
  "renters_ho4",
  "condo_ho6",
  "dwelling_fire",
  "mobile_home",
  "personal_auto",
  "personal_umbrella",
  "flood_nfip",
  "flood_private",
  "earthquake",
  "personal_inland_marine",
  "watercraft",
  "recreational_vehicle",
  "farm_ranch",
  "pet",
  "travel",
  "identity_theft",
  "title",
  "other",
];
```

- [ ] **Step 2: Add new union types at end of file**

Append after the existing `VehicleCoverageType` (line 211):

```typescript
// ── Personal lines union types ──

export type HomeownersFormType = "HO-3" | "HO-5" | "HO-4" | "HO-6" | "HO-7" | "HO-8";

export type DwellingFireFormType = "DP-1" | "DP-2" | "DP-3";

export type FloodZone = "A" | "AE" | "AH" | "AO" | "AR" | "V" | "VE" | "B" | "C" | "X" | "D";

export type ConstructionType = "frame" | "masonry" | "superior" | "mixed" | "other";

export type RoofType = "asphalt_shingle" | "tile" | "metal" | "slate" | "flat" | "wood_shake" | "other";

export type FoundationType = "basement" | "crawl_space" | "slab" | "pier" | "other";

export type PersonalAutoUsage = "pleasure" | "commute" | "business" | "farm";

export type LossSettlement = "replacement_cost" | "actual_cash_value" | "extended_replacement_cost" | "guaranteed_replacement_cost";

export type BoatType = "sailboat" | "powerboat" | "pontoon" | "jet_ski" | "kayak_canoe" | "yacht" | "other";

export type RVType = "rv_motorhome" | "travel_trailer" | "atv" | "snowmobile" | "golf_cart" | "dirt_bike" | "other";

export type ScheduledItemCategory = "jewelry" | "fine_art" | "musical_instruments" | "silverware" | "furs" | "cameras" | "collectibles" | "firearms" | "golf_equipment" | "other";

export type TitlePolicyType = "owners" | "lenders";

export type PetSpecies = "dog" | "cat" | "other";
```

- [ ] **Step 3: Expand EntityType and RatingBasisType**

In `src/types/enums.ts`, add `"individual"` and `"married_couple"` to the `EntityType` union (before `"other"`):

```typescript
export type EntityType =
  | "corporation"
  | "llc"
  | "partnership"
  | "sole_proprietor"
  | "joint_venture"
  | "trust"
  | "nonprofit"
  | "municipality"
  | "individual"
  | "married_couple"
  | "other";
```

Add `"dwelling_value"`, `"vehicle_value"`, `"contents_value"` to `RatingBasisType` (before `"other"`):

```typescript
export type RatingBasisType =
  | "payroll"
  | "revenue"
  | "area"
  | "units"
  | "vehicle_count"
  | "employee_count"
  | "per_capita"
  | "dwelling_value"
  | "vehicle_value"
  | "contents_value"
  | "other";
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/types/enums.ts
git commit -m "feat: add 19 personal lines PolicyType values and supporting union types"
```

---

### Task 2: Create Declarations Shared Types

**Files:**
- Create: `src/types/declarations/shared.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: Errors because personal.ts and commercial.ts don't exist yet — that's expected, move to next task.

---

### Task 3: Create Personal Lines Declarations

**Files:**
- Create: `src/types/declarations/personal.ts`

- [ ] **Step 1: Create the personal lines declarations file**

```typescript
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
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: Errors because commercial.ts doesn't exist yet — move to next task.

---

### Task 4: Create Commercial Lines Declarations

**Files:**
- Create: `src/types/declarations/commercial.ts`

- [ ] **Step 1: Create the commercial lines declarations file**

```typescript
// Commercial lines declarations variants (retrofit from flat BaseDocument fields)

import type { CoverageForm, DefenseCostTreatment, ValuationMethod } from "../enums";
import type { ExtendedReportingPeriod } from "../shared";
import type { InsuredLocation, InsuredVehicle, ClassificationCode, EmployersLiabilityLimits } from "../declarations";
import type { ExperienceMod } from "../loss-history";

export interface GLDeclarations {
  line: "gl";
  coverageForm?: CoverageForm;
  perOccurrenceLimit?: string;
  generalAggregate?: string;
  productsCompletedOpsAggregate?: string;
  personalAdvertisingInjury?: string;
  fireDamage?: string;
  medicalExpense?: string;
  defenseCostTreatment?: DefenseCostTreatment;
  deductible?: string;
  classifications?: ClassificationCode[];
  retroactiveDate?: string;
}

export interface CommercialPropertyDeclarations {
  line: "commercial_property";
  causesOfLossForm?: "basic" | "broad" | "special";
  coinsurancePercent?: number;
  valuationMethod?: ValuationMethod;
  locations: InsuredLocation[];
  blanketLimit?: string;
  businessIncomeLimit?: string;
  extraExpenseLimit?: string;
}

export interface CommercialAutoDeclarations {
  line: "commercial_auto";
  vehicles: InsuredVehicle[];
  coveredAutoSymbols?: number[];
  liabilityLimit?: string;
  umLimit?: string;
  uimLimit?: string;
  hiredAutoLiability?: boolean;
  nonOwnedAutoLiability?: boolean;
}

export interface WorkersCompDeclarations {
  line: "workers_comp";
  coveredStates?: string[];
  classifications: ClassificationCode[];
  experienceMod?: ExperienceMod;
  employersLiability?: EmployersLiabilityLimits;
}

export interface UmbrellaExcessDeclarations {
  line: "umbrella_excess";
  perOccurrenceLimit?: string;
  aggregateLimit?: string;
  retention?: string;
  underlyingPolicies: Array<{
    carrier?: string;
    policyNumber?: string;
    policyType?: string;
    limits?: string;
  }>;
}

export interface ProfessionalLiabilityDeclarations {
  line: "professional_liability";
  perClaimLimit?: string;
  aggregateLimit?: string;
  retroactiveDate?: string;
  defenseCostTreatment?: DefenseCostTreatment;
  extendedReportingPeriod?: ExtendedReportingPeriod;
}

export interface CyberDeclarations {
  line: "cyber";
  aggregateLimit?: string;
  retroactiveDate?: string;
  waitingPeriodHours?: number;
  sublimits?: Array<{
    coverageName: string;
    limit: string;
  }>;
}

export interface DODeclarations {
  line: "directors_officers";
  sideALimit?: string;
  sideBLimit?: string;
  sideCLimit?: string;
  sideARetention?: string;
  sideBRetention?: string;
  sideCRetention?: string;
  continuityDate?: string;
}

export interface CrimeDeclarations {
  line: "crime";
  formType?: "discovery" | "loss_sustained";
  agreements: Array<{
    agreement: string;
    coverageName: string;
    limit: string;
    deductible: string;
  }>;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: Errors because declarations/index.ts doesn't exist yet — move to next task.

---

### Task 5: Create Declarations Index and Wire Into Document

**Files:**
- Create: `src/types/declarations/index.ts`
- Modify: `src/types/document.ts`

- [ ] **Step 1: Create the declarations barrel export**

```typescript
// Declarations — typed discriminated union for line-specific policy data

export type { DwellingDetails, DriverRecord, PersonalVehicleDetails, Declarations } from "./shared";

export type {
  HomeownersDeclarations,
  PersonalAutoDeclarations,
  DwellingFireDeclarations,
  FloodDeclarations,
  EarthquakeDeclarations,
  PersonalUmbrellaDeclarations,
  PersonalArticlesDeclarations,
  WatercraftDeclarations,
  RecreationalVehicleDeclarations,
  FarmRanchDeclarations,
  TitleDeclarations,
  PetDeclarations,
  TravelDeclarations,
  IdentityTheftDeclarations,
} from "./personal";

export type {
  GLDeclarations,
  CommercialPropertyDeclarations,
  CommercialAutoDeclarations,
  WorkersCompDeclarations,
  UmbrellaExcessDeclarations,
  ProfessionalLiabilityDeclarations,
  CyberDeclarations,
  DODeclarations,
  CrimeDeclarations,
} from "./commercial";
```

- [ ] **Step 2: Add `declarations` field to BaseDocument and deprecate flat fields**

In `src/types/document.ts`, add an import for Declarations at the top (after the existing import from `"./declarations"`):

```typescript
import type { Declarations } from "./declarations/index";
```

Then add the `declarations` field to `BaseDocument` after `formInventory` (line 134):

```typescript
  /** Typed declarations union — line-specific structured data (v1.3+) */
  declarations?: Declarations;
```

And add `@deprecated` JSDoc to the following existing fields on BaseDocument:

- `limits` (line 124): change JSDoc to `/** @deprecated Use declarations instead. Structured limits schedule */`
- `deductibles` (line 126): change JSDoc to `/** @deprecated Use declarations instead. Structured deductible schedule */`
- `locations` (line 128): change JSDoc to `/** @deprecated Use declarations instead. Insured locations/premises */`
- `vehicles` (line 130): change JSDoc to `/** @deprecated Use declarations instead. Insured vehicles */`
- `classifications` (line 132): change JSDoc to `/** @deprecated Use declarations instead. Rating classification codes */`

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit Tasks 1-5**

```bash
git add src/types/enums.ts src/types/declarations/shared.ts src/types/declarations/personal.ts src/types/declarations/commercial.ts src/types/declarations/index.ts src/types/document.ts
git commit -m "feat: add typed declarations union with 14 personal + 9 commercial variants

Introduces Declarations discriminated union keyed by 'line' field.
Adds 19 new PolicyType values for personal lines.
Deprecates flat limits/deductibles/locations/vehicles/classifications fields."
```

---

### Task 6: Update Barrel Exports

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add new declarations exports**

In `src/index.ts`, after the existing "Types - Declarations" section (line 55-64), add a new section:

```typescript
// Types - Declarations (typed union, v1.3+)
export type {
  Declarations,
  DwellingDetails,
  DriverRecord,
  PersonalVehicleDetails,
  HomeownersDeclarations,
  PersonalAutoDeclarations,
  DwellingFireDeclarations,
  FloodDeclarations,
  EarthquakeDeclarations,
  PersonalUmbrellaDeclarations,
  PersonalArticlesDeclarations,
  WatercraftDeclarations,
  RecreationalVehicleDeclarations,
  FarmRanchDeclarations,
  TitleDeclarations,
  PetDeclarations,
  TravelDeclarations,
  IdentityTheftDeclarations,
  GLDeclarations,
  CommercialPropertyDeclarations,
  CommercialAutoDeclarations,
  WorkersCompDeclarations,
  UmbrellaExcessDeclarations,
  ProfessionalLiabilityDeclarations,
  CyberDeclarations,
  DODeclarations,
  CrimeDeclarations,
} from "./types/declarations/index";
```

Also add `buildPersonalLinesHint` to the "Extraction Prompts" export section:

```typescript
export {
  EXTRACTION_PROMPT,
  CLASSIFY_DOCUMENT_PROMPT,
  METADATA_PROMPT,
  QUOTE_METADATA_PROMPT,
  buildSectionsPrompt,
  buildPolicySectionsPrompt,
  buildQuoteSectionsPrompt,
  buildSupplementaryEnrichmentPrompt,
  buildPersonalLinesHint,
} from "./prompts/extraction";
```

Also add the new enum exports to the "Types - Enums" section:

```typescript
export type {
  // ... existing exports ...
  HomeownersFormType,
  DwellingFireFormType,
  FloodZone,
  ConstructionType,
  RoofType,
  FoundationType,
  PersonalAutoUsage,
  LossSettlement,
  BoatType,
  RVType,
  ScheduledItemCategory,
  TitlePolicyType,
  PetSpecies,
} from "./types/enums";
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export all new declarations types and personal lines enums"
```

---

### Task 7: Expand Extraction Prompts for Personal Lines

**Files:**
- Modify: `src/prompts/extraction.ts`

- [ ] **Step 1: Expand CLASSIFY_DOCUMENT_PROMPT with personal lines signals**

In `src/prompts/extraction.ts`, replace the CLASSIFICATION SIGNALS section of `CLASSIFY_DOCUMENT_PROMPT` (lines 110-113):

```typescript
export const CLASSIFY_DOCUMENT_PROMPT = `You are an expert insurance document analyst. Classify this document as either a bound insurance POLICY or a QUOTE/PROPOSAL.

Respond with JSON only:

{
  "documentType": "policy" or "quote",
  "confidence": number between 0 and 1,
  "signals": ["signal 1", "signal 2"]
}

CLASSIFICATION SIGNALS:
- POLICY signals: declarations page, ISO form numbers (e.g. CG 00 01, HO 00 03, PP 00 01), binding language ("This policy is issued to"), endorsement schedules, "Certificate of Insurance"
- POLICY (personal lines) signals: HO form numbers (HO 00 03/04/05/06/07/08), PAP form numbers (PP 00 01), NFIP flood policy headers, Auto ID card format, title commitment or title policy headers, pet/travel policy declarations
- QUOTE signals: "quote", "proposal", "indication" wording, subjectivities, "subject to" conditions, quote expiration date, "proposed premium", "terms and conditions may vary"

If uncertain, lean toward "policy" for documents with declarations pages and binding language, "quote" for everything else.`;
```

- [ ] **Step 2: Expand METADATA_PROMPT policyTypes array**

In `METADATA_PROMPT`, replace the `policyTypes` line (line 140) to include all 42 values:

```
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "homeowners_ho3", "homeowners_ho5", "renters_ho4", "condo_ho6", "dwelling_fire", "mobile_home", "personal_auto", "personal_umbrella", "flood_nfip", "flood_private", "earthquake", "personal_inland_marine", "watercraft", "recreational_vehicle", "farm_ranch", "pet", "travel", "identity_theft", "title", "other"],
```

Also add `"individual"` and `"married_couple"` to the `insuredEntityType` enum in the same prompt.

Add personal lines guidance to the IMPORTANT section at the end (after line 224):

```
- For PERSONAL LINES: Use personal line-specific policyTypes (homeowners_ho3, personal_auto, etc.)
- For homeowners policies (HO forms), extract Coverage A through F limits if visible on declarations
- For personal auto (PAP), extract per-vehicle coverages and driver list if visible
- For flood (NFIP), extract flood zone, community number, building/contents coverage
- For personal articles, extract scheduled items list if visible
```

- [ ] **Step 3: Expand QUOTE_METADATA_PROMPT policyTypes array**

In `QUOTE_METADATA_PROMPT`, replace the `policyTypes` line (line 246) with the same 42-value array as METADATA_PROMPT.

- [ ] **Step 4: Add buildPersonalLinesHint helper**

Append after `buildSupplementaryEnrichmentPrompt` (after line 543):

```typescript
/**
 * Build a context hint for personal lines extraction based on detected policyType.
 * Returns null for commercial lines or unknown types.
 */
export function buildPersonalLinesHint(policyType: string): string | null {
  const hints: Record<string, string> = {
    homeowners_ho3: "This is an HO-3 Special Form homeowners policy. Extract Coverage A through F limits, dwelling details (construction, year built, sq ft, roof), deductible(s), loss settlement method, and mortgagee information.",
    homeowners_ho5: "This is an HO-5 Comprehensive Form homeowners policy. Extract Coverage A through F limits, dwelling details, deductible(s), loss settlement method, and mortgagee.",
    renters_ho4: "This is an HO-4 Contents Broad Form renters policy. Extract Coverage C (personal property), Coverage D (loss of use), Coverage E (liability), Coverage F (medical payments), and deductible.",
    condo_ho6: "This is an HO-6 Unit-Owners Form condo policy. Extract Coverage A (dwelling/unit), Coverage C, Coverage D, Coverage E, Coverage F, loss assessment coverage, and deductible.",
    dwelling_fire: "This is a Dwelling Fire policy (DP form). Extract dwelling limit, other structures, personal property, fair rental value, liability, medical payments, and deductible. Note the form type (DP-1, DP-2, or DP-3).",
    mobile_home: "This is a Mobile/Manufactured Home policy (HO-7). Extract Coverage A through F limits, dwelling details, tie-down/anchoring info, and deductible.",
    personal_auto: "This is a Personal Auto Policy (PAP). Extract liability BI/PD limits (split or CSL), UM/UIM limits, PIP/med pay, per-vehicle coverages (collision/comprehensive deductibles), driver list with DOB/license/violations, and vehicle schedule with VINs.",
    personal_umbrella: "This is a Personal Umbrella/Excess policy. Extract per-occurrence limit, aggregate limit, retained limit (SIR), and underlying policy schedule.",
    flood_nfip: "This is an NFIP Standard Flood Insurance Policy. Extract flood zone, community number/CRS rating, building coverage, contents coverage, ICC coverage, deductible, waiting period, elevation certificate status, and building diagram number.",
    flood_private: "This is a Private Flood policy. Extract building coverage, contents coverage, deductible, and any additional living expense coverage. Note differences from NFIP terms.",
    earthquake: "This is a Residential Earthquake policy. Extract dwelling coverage, contents coverage, loss of use coverage, deductible percentage, retrofit discount, and masonry veneer coverage.",
    personal_inland_marine: "This is a Personal Articles Floater. Extract scheduled items (category, description, appraised value, appraisal date), blanket coverage limit, deductible, and worldwide/breakage coverage.",
    watercraft: "This is a Watercraft/Boat policy. Extract boat details (type, year, make, model, length, hull material, motor), hull value, liability limit, medical payments, physical damage deductible, and trailer coverage.",
    recreational_vehicle: "This is an RV/ATV/Snowmobile policy. Extract vehicle details (type, year, make, model, VIN), value, liability limit, collision/comprehensive deductibles, personal effects coverage, and full-timer coverage.",
    farm_ranch: "This is a Farm/Ranch Owner policy. Extract dwelling coverage, farm personal property, farm liability, farm auto inclusion, livestock schedule, equipment schedule, and acreage.",
    pet: "This is a Pet Insurance policy. Extract species, breed, pet name, age, annual limit, per-incident limit, deductible, reimbursement percentage, waiting period, and wellness coverage.",
    travel: "This is a Travel Insurance policy. Extract trip dates, destinations, travelers, trip cost, cancellation limit, medical limit, evacuation limit, and baggage limit.",
    identity_theft: "This is an Identity Theft policy. Extract coverage limit, expense reimbursement, credit monitoring, restoration services, and lost wages limit.",
    title: "This is a Title Insurance policy. Extract policy type (owner's or lender's), policy amount, legal description, property address, effective date, schedule B exceptions, and underwriter.",
  };
  return hints[policyType] ?? null;
}
```

- [ ] **Step 5: Expand buildSectionsPrompt with personal lines endorsement patterns**

In `buildSectionsPrompt`, add personal lines endorsement guidance after the existing ENDORSEMENT GUIDANCE section (after line 374):

Add these lines before the final IMPORTANT line:

```
PERSONAL LINES ENDORSEMENT RECOGNITION:
- HO 04 XX series: homeowners endorsements (e.g. HO 04 10 Additional Interests, HO 04 41 Special Personal Property, HO 04 61 Scheduled Personal Property)
- PP 03 XX series: personal auto endorsements (e.g. PP 03 06 Named Non-Owner, PP 03 13 Extended Non-Owned)
- HO 17 XX series: mobilehome endorsements
- DP 04 XX series: dwelling fire endorsements
- Personal lines exclusion patterns: animal liability, business pursuits, home daycare, watercraft, aircraft
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/prompts/extraction.ts
git commit -m "feat: expand extraction prompts for personal lines detection and field guidance"
```

---

### Task 8: Update Pipeline to Construct Declarations

**Files:**
- Modify: `src/extraction/pipeline.ts`

- [ ] **Step 1: Add buildPersonalLinesHint import**

At the top of `src/extraction/pipeline.ts` (line 28), add `buildPersonalLinesHint` to the extraction imports:

```typescript
import { METADATA_PROMPT, QUOTE_METADATA_PROMPT, CLASSIFY_DOCUMENT_PROMPT, buildSectionsPrompt, buildQuoteSectionsPrompt, buildSupplementaryEnrichmentPrompt, buildPersonalLinesHint } from "../prompts/extraction";
```

- [ ] **Step 2: Add buildDeclarations helper function**

Add after the `sanitizeNulls` function (after line 137) and before `applyExtracted`:

```typescript
/**
 * Construct a typed Declarations variant from extracted metadata and policyTypes.
 * Returns undefined if the primary line can't be mapped to a known variant.
 */
function buildDeclarations(meta: any, extracted: any): any {
  const policyTypes: string[] = Array.isArray(meta.policyTypes) ? meta.policyTypes : [];
  const primary = policyTypes[0];
  if (!primary) return undefined;

  // Personal lines mapping
  if (primary === "homeowners_ho3" || primary === "homeowners_ho5" || primary === "renters_ho4" || primary === "condo_ho6" || primary === "mobile_home") {
    const formMap: Record<string, string> = {
      homeowners_ho3: "HO-3", homeowners_ho5: "HO-5", renters_ho4: "HO-4",
      condo_ho6: "HO-6", mobile_home: "HO-7",
    };
    return sanitizeNulls({
      line: "homeowners",
      formType: formMap[primary],
      coverageA: meta.coverageA ?? meta.declarations?.coverageA,
      coverageB: meta.coverageB ?? meta.declarations?.coverageB,
      coverageC: meta.coverageC ?? meta.declarations?.coverageC,
      coverageD: meta.coverageD ?? meta.declarations?.coverageD,
      coverageE: meta.coverageE ?? meta.declarations?.coverageE,
      coverageF: meta.coverageF ?? meta.declarations?.coverageF,
      allPerilDeductible: meta.allPerilDeductible ?? meta.declarations?.allPerilDeductible,
      windHailDeductible: meta.windHailDeductible ?? meta.declarations?.windHailDeductible,
      hurricaneDeductible: meta.hurricaneDeductible ?? meta.declarations?.hurricaneDeductible,
      lossSettlement: meta.lossSettlement ?? meta.declarations?.lossSettlement,
      dwelling: meta.dwelling ?? meta.declarations?.dwelling ?? {},
      mortgagee: meta.mortgagee ?? meta.declarations?.mortgagee,
      additionalMortgagees: meta.additionalMortgagees ?? meta.declarations?.additionalMortgagees,
    });
  }

  if (primary === "personal_auto") {
    return sanitizeNulls({
      line: "personal_auto",
      vehicles: meta.vehicles ?? meta.declarations?.vehicles ?? extracted.vehicles ?? [],
      drivers: meta.drivers ?? meta.declarations?.drivers ?? [],
      liabilityLimits: meta.liabilityLimits ?? meta.declarations?.liabilityLimits,
      umLimits: meta.umLimits ?? meta.declarations?.umLimits,
      uimLimits: meta.uimLimits ?? meta.declarations?.uimLimits,
      pipLimit: meta.pipLimit ?? meta.declarations?.pipLimit,
      medPayLimit: meta.medPayLimit ?? meta.declarations?.medPayLimit,
    });
  }

  if (primary === "dwelling_fire") {
    return sanitizeNulls({
      line: "dwelling_fire",
      formType: meta.dwellingFireFormType ?? meta.declarations?.formType ?? "DP-3",
      dwellingLimit: meta.dwellingLimit ?? meta.declarations?.dwellingLimit,
      otherStructuresLimit: meta.otherStructuresLimit ?? meta.declarations?.otherStructuresLimit,
      personalPropertyLimit: meta.personalPropertyLimit ?? meta.declarations?.personalPropertyLimit,
      fairRentalValueLimit: meta.fairRentalValueLimit ?? meta.declarations?.fairRentalValueLimit,
      liabilityLimit: meta.liabilityLimit ?? meta.declarations?.liabilityLimit,
      medicalPaymentsLimit: meta.medicalPaymentsLimit ?? meta.declarations?.medicalPaymentsLimit,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      dwelling: meta.dwelling ?? meta.declarations?.dwelling ?? {},
    });
  }

  if (primary === "flood_nfip" || primary === "flood_private") {
    return sanitizeNulls({
      line: "flood",
      programType: primary === "flood_nfip" ? "nfip" : "private",
      floodZone: meta.floodZone ?? meta.declarations?.floodZone,
      communityNumber: meta.communityNumber ?? meta.declarations?.communityNumber,
      communityRating: meta.communityRating ?? meta.declarations?.communityRating,
      buildingCoverage: meta.buildingCoverage ?? meta.declarations?.buildingCoverage,
      contentsCoverage: meta.contentsCoverage ?? meta.declarations?.contentsCoverage,
      iccCoverage: meta.iccCoverage ?? meta.declarations?.iccCoverage,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      waitingPeriodDays: meta.waitingPeriodDays ?? meta.declarations?.waitingPeriodDays,
      elevationCertificate: meta.elevationCertificate ?? meta.declarations?.elevationCertificate,
      elevationDifference: meta.elevationDifference ?? meta.declarations?.elevationDifference,
      buildingDiagramNumber: meta.buildingDiagramNumber ?? meta.declarations?.buildingDiagramNumber,
      basementOrEnclosure: meta.basementOrEnclosure ?? meta.declarations?.basementOrEnclosure,
      postFirmConstruction: meta.postFirmConstruction ?? meta.declarations?.postFirmConstruction,
    });
  }

  if (primary === "earthquake") {
    return sanitizeNulls({
      line: "earthquake",
      dwellingCoverage: meta.dwellingCoverage ?? meta.declarations?.dwellingCoverage,
      contentsCoverage: meta.contentsCoverage ?? meta.declarations?.contentsCoverage,
      lossOfUseCoverage: meta.lossOfUseCoverage ?? meta.declarations?.lossOfUseCoverage,
      deductiblePercent: meta.deductiblePercent ?? meta.declarations?.deductiblePercent,
      retrofitDiscount: meta.retrofitDiscount ?? meta.declarations?.retrofitDiscount,
      masonryVeneerCoverage: meta.masonryVeneerCoverage ?? meta.declarations?.masonryVeneerCoverage,
    });
  }

  if (primary === "personal_umbrella") {
    return sanitizeNulls({
      line: "personal_umbrella",
      perOccurrenceLimit: meta.perOccurrenceLimit ?? meta.declarations?.perOccurrenceLimit,
      aggregateLimit: meta.aggregateLimit ?? meta.declarations?.aggregateLimit,
      retainedLimit: meta.retainedLimit ?? meta.declarations?.retainedLimit,
      underlyingPolicies: meta.underlyingPolicies ?? meta.declarations?.underlyingPolicies ?? [],
    });
  }

  if (primary === "personal_inland_marine") {
    return sanitizeNulls({
      line: "personal_articles",
      scheduledItems: meta.scheduledItems ?? meta.declarations?.scheduledItems ?? [],
      blanketCoverage: meta.blanketCoverage ?? meta.declarations?.blanketCoverage,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      worldwideCoverage: meta.worldwideCoverage ?? meta.declarations?.worldwideCoverage,
      breakageCoverage: meta.breakageCoverage ?? meta.declarations?.breakageCoverage,
    });
  }

  if (primary === "watercraft") {
    return sanitizeNulls({
      line: "watercraft",
      boatType: meta.boatType ?? meta.declarations?.boatType,
      year: meta.boatYear ?? meta.declarations?.year,
      make: meta.boatMake ?? meta.declarations?.make,
      model: meta.boatModel ?? meta.declarations?.model,
      length: meta.boatLength ?? meta.declarations?.length,
      hullMaterial: meta.hullMaterial ?? meta.declarations?.hullMaterial,
      hullValue: meta.hullValue ?? meta.declarations?.hullValue,
      motorHorsepower: meta.motorHorsepower ?? meta.declarations?.motorHorsepower,
      motorType: meta.motorType ?? meta.declarations?.motorType,
      navigationLimits: meta.navigationLimits ?? meta.declarations?.navigationLimits,
      layupPeriod: meta.layupPeriod ?? meta.declarations?.layupPeriod,
      liabilityLimit: meta.liabilityLimit ?? meta.declarations?.liabilityLimit,
      medicalPaymentsLimit: meta.medicalPaymentsLimit ?? meta.declarations?.medicalPaymentsLimit,
      physicalDamageDeductible: meta.physicalDamageDeductible ?? meta.declarations?.physicalDamageDeductible,
      uninsuredBoaterLimit: meta.uninsuredBoaterLimit ?? meta.declarations?.uninsuredBoaterLimit,
      trailerCovered: meta.trailerCovered ?? meta.declarations?.trailerCovered,
      trailerValue: meta.trailerValue ?? meta.declarations?.trailerValue,
    });
  }

  if (primary === "recreational_vehicle") {
    return sanitizeNulls({
      line: "recreational_vehicle",
      vehicleType: meta.rvType ?? meta.declarations?.vehicleType ?? "other",
      year: meta.rvYear ?? meta.declarations?.year,
      make: meta.rvMake ?? meta.declarations?.make,
      model: meta.rvModel ?? meta.declarations?.model,
      vin: meta.rvVin ?? meta.declarations?.vin,
      value: meta.rvValue ?? meta.declarations?.value,
      liabilityLimit: meta.liabilityLimit ?? meta.declarations?.liabilityLimit,
      collisionDeductible: meta.collisionDeductible ?? meta.declarations?.collisionDeductible,
      comprehensiveDeductible: meta.comprehensiveDeductible ?? meta.declarations?.comprehensiveDeductible,
      personalEffectsCoverage: meta.personalEffectsCoverage ?? meta.declarations?.personalEffectsCoverage,
      fullTimerCoverage: meta.fullTimerCoverage ?? meta.declarations?.fullTimerCoverage,
    });
  }

  if (primary === "farm_ranch") {
    return sanitizeNulls({
      line: "farm_ranch",
      dwellingCoverage: meta.dwellingCoverage ?? meta.declarations?.dwellingCoverage,
      farmPersonalPropertyCoverage: meta.farmPersonalPropertyCoverage ?? meta.declarations?.farmPersonalPropertyCoverage,
      farmLiabilityLimit: meta.farmLiabilityLimit ?? meta.declarations?.farmLiabilityLimit,
      farmAutoIncluded: meta.farmAutoIncluded ?? meta.declarations?.farmAutoIncluded,
      livestock: meta.livestock ?? meta.declarations?.livestock,
      equipmentSchedule: meta.equipmentSchedule ?? meta.declarations?.equipmentSchedule,
      acreage: meta.acreage ?? meta.declarations?.acreage,
      dwelling: meta.dwelling ?? meta.declarations?.dwelling,
    });
  }

  if (primary === "pet") {
    return sanitizeNulls({
      line: "pet",
      species: meta.species ?? meta.declarations?.species ?? "other",
      breed: meta.breed ?? meta.declarations?.breed,
      petName: meta.petName ?? meta.declarations?.petName,
      age: meta.petAge ?? meta.declarations?.age,
      annualLimit: meta.annualLimit ?? meta.declarations?.annualLimit,
      perIncidentLimit: meta.perIncidentLimit ?? meta.declarations?.perIncidentLimit,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      reimbursementPercent: meta.reimbursementPercent ?? meta.declarations?.reimbursementPercent,
      waitingPeriodDays: meta.waitingPeriodDays ?? meta.declarations?.waitingPeriodDays,
      preExistingConditionsExcluded: meta.preExistingConditionsExcluded ?? meta.declarations?.preExistingConditionsExcluded,
      wellnessCoverage: meta.wellnessCoverage ?? meta.declarations?.wellnessCoverage,
    });
  }

  if (primary === "travel") {
    return sanitizeNulls({
      line: "travel",
      tripDepartureDate: meta.tripDepartureDate ?? meta.declarations?.tripDepartureDate,
      tripReturnDate: meta.tripReturnDate ?? meta.declarations?.tripReturnDate,
      destinations: meta.destinations ?? meta.declarations?.destinations,
      travelers: meta.travelers ?? meta.declarations?.travelers,
      tripCost: meta.tripCost ?? meta.declarations?.tripCost,
      tripCancellationLimit: meta.tripCancellationLimit ?? meta.declarations?.tripCancellationLimit,
      medicalLimit: meta.medicalLimit ?? meta.declarations?.medicalLimit,
      evacuationLimit: meta.evacuationLimit ?? meta.declarations?.evacuationLimit,
      baggageLimit: meta.baggageLimit ?? meta.declarations?.baggageLimit,
    });
  }

  if (primary === "identity_theft") {
    return sanitizeNulls({
      line: "identity_theft",
      coverageLimit: meta.coverageLimit ?? meta.declarations?.coverageLimit,
      expenseReimbursement: meta.expenseReimbursement ?? meta.declarations?.expenseReimbursement,
      creditMonitoring: meta.creditMonitoring ?? meta.declarations?.creditMonitoring,
      restorationServices: meta.restorationServices ?? meta.declarations?.restorationServices,
      lostWagesLimit: meta.lostWagesLimit ?? meta.declarations?.lostWagesLimit,
    });
  }

  if (primary === "title") {
    return sanitizeNulls({
      line: "title",
      policyType: meta.titlePolicyType ?? meta.declarations?.policyType ?? "owners",
      policyAmount: meta.titlePolicyAmount ?? meta.declarations?.policyAmount ?? "",
      legalDescription: meta.legalDescription ?? meta.declarations?.legalDescription,
      propertyAddress: meta.propertyAddress ?? meta.declarations?.propertyAddress,
      effectiveDate: meta.titleEffectiveDate ?? meta.declarations?.effectiveDate,
      exceptions: meta.exceptions ?? meta.declarations?.exceptions,
      underwriter: meta.titleUnderwriter ?? meta.declarations?.underwriter,
    });
  }

  // Commercial lines mapping
  if (primary === "general_liability") {
    return sanitizeNulls({
      line: "gl",
      coverageForm: meta.coverageForm ?? extracted.coverageForm,
      perOccurrenceLimit: extracted.limits?.perOccurrence,
      generalAggregate: extracted.limits?.generalAggregate,
      productsCompletedOpsAggregate: extracted.limits?.productsCompletedOpsAggregate,
      personalAdvertisingInjury: extracted.limits?.personalAdvertisingInjury,
      fireDamage: extracted.limits?.fireDamage,
      medicalExpense: extracted.limits?.medicalExpense,
      defenseCostTreatment: extracted.limits?.defenseCostTreatment,
      deductible: extracted.deductibles?.perOccurrence,
      classifications: extracted.classifications,
      retroactiveDate: meta.retroactiveDate,
    });
  }

  if (primary === "commercial_property" || primary === "property") {
    return sanitizeNulls({
      line: "commercial_property",
      locations: extracted.locations ?? [],
      blanketLimit: meta.blanketLimit,
      businessIncomeLimit: meta.businessIncomeLimit,
      extraExpenseLimit: meta.extraExpenseLimit,
    });
  }

  if (primary === "commercial_auto") {
    return sanitizeNulls({
      line: "commercial_auto",
      vehicles: extracted.vehicles ?? [],
      liabilityLimit: extracted.limits?.combinedSingleLimit ?? extracted.limits?.perOccurrence,
      umLimit: meta.umLimit,
      uimLimit: meta.uimLimit,
    });
  }

  if (primary === "workers_comp") {
    return sanitizeNulls({
      line: "workers_comp",
      classifications: extracted.classifications ?? [],
      experienceMod: extracted.experienceMod,
      employersLiability: extracted.limits?.employersLiability,
    });
  }

  if (primary === "umbrella" || primary === "excess_liability") {
    return sanitizeNulls({
      line: "umbrella_excess",
      perOccurrenceLimit: extracted.limits?.eachOccurrenceUmbrella ?? extracted.limits?.perOccurrence,
      aggregateLimit: extracted.limits?.umbrellaAggregate ?? extracted.limits?.generalAggregate,
      retention: extracted.limits?.umbrellaRetention ?? extracted.deductibles?.selfInsuredRetention,
      underlyingPolicies: meta.underlyingPolicies ?? [],
    });
  }

  if (primary === "professional_liability") {
    return sanitizeNulls({
      line: "professional_liability",
      perClaimLimit: extracted.limits?.perOccurrence,
      aggregateLimit: extracted.limits?.generalAggregate,
      retroactiveDate: meta.retroactiveDate,
      defenseCostTreatment: extracted.limits?.defenseCostTreatment,
    });
  }

  if (primary === "cyber") {
    return sanitizeNulls({
      line: "cyber",
      aggregateLimit: extracted.limits?.generalAggregate ?? extracted.limits?.perOccurrence,
      retroactiveDate: meta.retroactiveDate,
    });
  }

  if (primary === "directors_officers") {
    return sanitizeNulls({
      line: "directors_officers",
      sideALimit: meta.sideALimit,
      sideBLimit: meta.sideBLimit,
      sideCLimit: meta.sideCLimit,
    });
  }

  if (primary === "crime_fidelity") {
    return sanitizeNulls({
      line: "crime",
      agreements: meta.agreements ?? [],
    });
  }

  return undefined;
}
```

- [ ] **Step 3: Wire buildDeclarations into applyExtracted**

In `applyExtracted`, after the existing enriched metadata fields block (after line 200, before `return fields;`):

```typescript
  // Construct typed declarations (v1.3+)
  const declarations = buildDeclarations(meta, extracted);
  if (declarations) fields.declarations = declarations;
```

- [ ] **Step 4: Wire buildDeclarations into applyExtractedQuote**

In `applyExtractedQuote`, after the existing enriched quote fields block (after line 540, before `return fields;`):

```typescript
  // Construct typed declarations (v1.3+)
  const declarations = buildDeclarations(meta, extracted);
  if (declarations) fields.declarations = declarations;
```

- [ ] **Step 5: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/extraction/pipeline.ts
git commit -m "feat: pipeline constructs typed declarations from extracted metadata"
```

---

### Task 9: Add Personal Lines Context Key Mappings

**Files:**
- Modify: `src/types/context-keys.ts`

- [ ] **Step 1: Expand ContextKeyMapping category union**

In `src/types/context-keys.ts`, expand the `category` field on line 5 to include new personal lines categories:

```typescript
  category: "company_info" | "operations" | "financial" | "coverage" | "loss_history" | "premises" | "vehicles" | "employees" | "property_info" | "driver_info" | "vehicle_info" | "pet_info";
```

- [ ] **Step 2: Add personal lines mappings to CONTEXT_KEY_MAP**

Append after the last entry (line 36, before the closing `];`):

```typescript
  // ── Personal lines context keys (v1.3+) ──
  { extractedField: "declarations.dwelling.yearBuilt", category: "property_info", contextKey: "year_built", description: "Year dwelling was built" },
  { extractedField: "declarations.dwelling.constructionType", category: "property_info", contextKey: "construction_type", description: "Dwelling construction type" },
  { extractedField: "declarations.dwelling.squareFootage", category: "property_info", contextKey: "square_footage", description: "Dwelling square footage" },
  { extractedField: "declarations.dwelling.roofType", category: "property_info", contextKey: "roof_type", description: "Roof material type" },
  { extractedField: "declarations.dwelling.roofAge", category: "property_info", contextKey: "roof_age", description: "Roof age in years" },
  { extractedField: "declarations.dwelling.stories", category: "property_info", contextKey: "num_stories", description: "Number of stories" },
  { extractedField: "declarations.dwelling.heatingType", category: "property_info", contextKey: "heating_type", description: "Heating system type" },
  { extractedField: "declarations.dwelling.protectiveDevices", category: "property_info", contextKey: "protective_devices", description: "Alarm, sprinkler, deadbolt, smoke detector" },
  { extractedField: "declarations.coverageA", category: "coverage", contextKey: "dwelling_coverage_limit", description: "Homeowners Coverage A dwelling limit" },
  { extractedField: "declarations.coverageE", category: "coverage", contextKey: "personal_liability_limit", description: "Homeowners Coverage E personal liability" },
  { extractedField: "declarations.drivers[].name", category: "driver_info", contextKey: "driver_names", description: "Listed driver names" },
  { extractedField: "declarations.drivers[].licenseNumber", category: "driver_info", contextKey: "driver_license_numbers", description: "Driver license numbers" },
  { extractedField: "declarations.vehicles[].vin", category: "vehicle_info", contextKey: "vehicle_vins", description: "Personal vehicle VINs" },
  { extractedField: "declarations.vehicles[].annualMileage", category: "vehicle_info", contextKey: "annual_mileage", description: "Annual mileage per vehicle" },
  { extractedField: "declarations.floodZone", category: "property_info", contextKey: "flood_zone", description: "FEMA flood zone designation" },
  { extractedField: "declarations.elevationCertificate", category: "property_info", contextKey: "has_elevation_cert", description: "Elevation certificate on file" },
  { extractedField: "declarations.mortgagee.name", category: "financial", contextKey: "mortgagee_name", description: "Mortgage holder name" },
  { extractedField: "insuredAddress", category: "company_info", contextKey: "primary_residence_address", description: "Primary insured residence address" },
  { extractedField: "declarations.petName", category: "pet_info", contextKey: "pet_name", description: "Insured pet name" },
  { extractedField: "declarations.species", category: "pet_info", contextKey: "pet_species", description: "Pet species (dog, cat, other)" },
  { extractedField: "declarations.breed", category: "pet_info", contextKey: "pet_breed", description: "Pet breed" },
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/types/context-keys.ts
git commit -m "feat: add 21 personal lines context key mappings for application auto-fill"
```

---

### Task 10: Update Agent Prompts for Personal Lines

**Files:**
- Modify: `src/prompts/agent/quotes-policies.ts`
- Modify: `src/prompts/agent/coverage-gaps.ts`
- Modify: `src/prompts/intent.ts`

- [ ] **Step 1: Expand quotes-policies.ts with personal lines guidance**

Replace the full content of `src/prompts/agent/quotes-policies.ts`:

```typescript
export function buildQuotesPoliciesPrompt(): string {
  return `POLICIES vs QUOTES:
- POLICIES = bound coverage currently in force. Use these when answering "what coverage do we have?", "what are our limits?", "are we covered for X?"
- QUOTES = proposals or indications received but not yet bound. Use these when answering "what quotes have we received?", "what was quoted?", "what are the proposed terms?"
- Always clearly label which you are referencing. Say "In your [carrier] policy..." or "In the [carrier] quote/proposal..."
- NEVER present a quote as active coverage. A quote is a proposal only.
- If asked about coverage, default to policies unless the question specifically asks about quotes or proposals.

PERSONAL LINES GUIDANCE:
- For homeowners (HO forms): Reference Coverage A through F by letter and name (A=Dwelling, B=Other Structures, C=Personal Property, D=Loss of Use, E=Personal Liability, F=Medical Payments to Others).
- For personal auto (PAP): When discussing liability limits, use the split format "X/Y/Z" (BI per person / BI per accident / PD) or state "combined single limit" if CSL.
- For flood: Note whether NFIP or private. NFIP has standard 30-day waiting period. Building and contents are separate coverages.
- For umbrella: Always reference underlying policy requirements when discussing limits.
- For title insurance: Distinguish between owner's policy (protects buyer) and lender's policy (protects mortgage lender).`;
}
```

- [ ] **Step 2: Expand coverage-gaps.ts with personal lines patterns**

Replace the full content of `src/prompts/agent/coverage-gaps.ts`:

```typescript
import { AgentContext } from "../../types/platform";

export function buildCoverageGapPrompt(ctx: AgentContext): string | null {
  if (ctx.intent === "direct") return null;

  const contactRef = ctx.userName ?? "our team";
  return `COVERAGE GAPS -- FOLLOW THESE RULES EXACTLY:
- If asked about a specific coverage and it's missing or below the requested amount, state that fact and stop. Example: "We don't currently have cargo coverage in our active policies." That's the full answer. Do not elaborate.
- Do NOT add warnings, caveats, or commentary about gaps (no "this is a significant limitation", "you should be aware", "this is worth noting").
- Do NOT offer recommendations or suggest next steps (no "I'd recommend", "you should speak with", "you'll want to discuss", "consider reaching out").
- Do NOT tell the recipient to contact anyone about the gap -- not "our team", not "your contact", not "support". Just state what the policy does or does not cover.
- Do NOT proactively list missing coverages that weren't asked about.
- If a question can't be answered from the policy data, say "${contactRef} (CC'd on this thread) can help with that." Do NOT refer them to "our insurance carrier", "our insurer", "our underwriter", or any third party. The only person you may refer them to is ${contactRef}.
- End with "Let me know if you have any other questions." -- nothing more.

PERSONAL LINES COVERAGE GAP AWARENESS (for context only — do NOT proactively mention these):
- No flood insurance in a flood zone
- Dwelling coverage (Coverage A) below estimated rebuild cost
- Liability limits below personal umbrella underlying requirements
- No UM/UIM coverage on auto policy
- No scheduled articles for high-value items (jewelry typically needs scheduling above $1,500)
- No identity theft coverage
- Dwelling fire on DP-1 basic form (limited coverage compared to DP-3)
- No earthquake coverage in seismic zones`;
}
```

- [ ] **Step 3: Expand intent.ts with personal lines intents**

In `src/prompts/intent.ts`, expand the `suggestedIntent` list and add personal lines examples. Replace the full content:

```typescript
import { Platform } from "../types/platform";

/**
 * Build a platform-agnostic message classification prompt.
 *
 * The prompt instructs Claude to classify an incoming message and suggest
 * an intent, with platform-specific context fields included in the schema.
 */
export function buildClassifyMessagePrompt(platform: Platform): string {
  const platformFields: Record<Platform, string> = {
    email: `"subject": "email subject line",
    "from": "sender email address",
    "date": "email date"`,
    chat: `"from": "sender display name",
    "sessionId": "chat session identifier"`,
    sms: `"from": "sender phone number"`,
    slack: `"from": "sender display name",
    "channel": "Slack channel name or ID",
    "threadId": "thread timestamp if in a thread"`,
    discord: `"from": "sender display name",
    "channel": "Discord channel name",
    "threadId": "thread ID if in a thread"`,
  };

  return `You are an AI assistant that classifies incoming ${platform} messages for an insurance policy management platform.

Analyze the message and determine:
1. Whether it is related to insurance
2. What the sender's intent is

Respond with JSON only:
{
  "isInsurance": boolean,
  "reason": "brief explanation",
  "confidence": number between 0 and 1,
  "suggestedIntent": "policy_question" | "coi_request" | "renewal_inquiry" | "claim_report" | "coverage_shopping" | "general" | "unrelated"
}

INTENT DETECTION:
- "policy_question": questions about existing coverage, limits, deductibles, endorsements (commercial or personal)
- "coi_request": requests for certificate of insurance or proof of coverage
- "renewal_inquiry": questions about upcoming renewals, rate changes, policy period
- "claim_report": reporting a loss or incident — includes property damage ("my roof leaked", "tree fell on house", "pipe burst"), auto accidents ("got in an accident", "someone hit my car"), theft, water damage, fire, liability incidents
- "coverage_shopping": looking for new coverage, requesting quotes, comparing rates ("I need homeowners insurance", "looking for auto coverage", "do I need flood insurance")
- "general": insurance-related but doesn't fit above categories
- "unrelated": not insurance-related

Message context:
{
  "platform": "${platform}",
  ${platformFields[platform]}
}`;
}
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/prompts/agent/quotes-policies.ts src/prompts/agent/coverage-gaps.ts src/prompts/intent.ts
git commit -m "feat: expand agent prompts for personal lines coverage guidance and intent detection"
```

---

### Task 11: Update Reference Documentation — Data Dictionary

**Files:**
- Modify: `docs/data-dictionary.md`

- [ ] **Step 1: Add personal lines domains to the data dictionary**

Read `docs/data-dictionary.md` first, then append the following new domains after the last existing domain:

```markdown
## Domain 12: Personal Lines Declarations

Typed declarations variants for personal lines policies. Each variant is keyed by a `line` discriminant.

### DwellingDetails (shared)
| Field | Type | Description |
|---|---|---|
| constructionType | ConstructionType? | frame, masonry, superior, mixed, other |
| yearBuilt | number? | Year the dwelling was built |
| squareFootage | number? | Total square footage |
| stories | number? | Number of stories |
| roofType | RoofType? | asphalt_shingle, tile, metal, slate, flat, wood_shake, other |
| roofAge | number? | Roof age in years |
| heatingType | string? | central, baseboard, radiant, space_heater, heat_pump, other |
| foundationType | FoundationType? | basement, crawl_space, slab, pier, other |
| plumbingType | string? | copper, pex, galvanized, polybutylene, cpvc, other |
| electricalType | string? | circuit_breaker, fuse_box, knob_and_tube, other |
| electricalAmps | number? | Electrical service amperage |
| hasSwimmingPool | boolean? | Pool present on premises |
| poolType | string? | in_ground or above_ground |
| hasTrampoline | boolean? | Trampoline present |
| hasDog | boolean? | Dog on premises |
| dogBreed | string? | Dog breed (underwriting concern) |
| protectiveDevices | string[]? | alarm, sprinkler, deadbolt, smoke detector |
| distanceToFireStation | string? | Distance to nearest fire station |
| distanceToHydrant | string? | Distance to nearest fire hydrant |
| fireProtectionClass | string? | ISO fire protection class (1-10) |

### DriverRecord
| Field | Type | Description |
|---|---|---|
| name | string | Driver full name |
| dateOfBirth | string? | Date of birth |
| licenseNumber | string? | Driver license number |
| licenseState | string? | License issuing state |
| relationship | string? | named_insured, spouse, child, other_household, other |
| yearsLicensed | number? | Years holding license |
| violations | array? | Date, type, description per violation |
| accidents | array? | Date, at-fault, description, amount per accident |
| sr22Required | boolean? | SR-22 filing required |

### PersonalVehicleDetails
| Field | Type | Description |
|---|---|---|
| number | number? | Vehicle number on declarations |
| year | number? | Model year |
| make | string? | Manufacturer |
| model | string? | Model name |
| vin | string? | Vehicle Identification Number |
| usage | PersonalAutoUsage? | pleasure, commute, business, farm |
| annualMileage | number? | Annual miles driven |
| collisionDeductible | string? | Collision deductible |
| comprehensiveDeductible | string? | Comprehensive deductible |

## Domain 13: Personal Lines Context Keys

| Extracted Field Path | Context Category | Context Key | Description |
|---|---|---|---|
| declarations.dwelling.yearBuilt | property_info | year_built | Year dwelling was built |
| declarations.dwelling.constructionType | property_info | construction_type | Dwelling construction type |
| declarations.dwelling.squareFootage | property_info | square_footage | Dwelling square footage |
| declarations.dwelling.roofType | property_info | roof_type | Roof material type |
| declarations.dwelling.roofAge | property_info | roof_age | Roof age in years |
| declarations.dwelling.protectiveDevices | property_info | protective_devices | Protective device list |
| declarations.coverageA | coverage | dwelling_coverage_limit | HO Coverage A limit |
| declarations.coverageE | coverage | personal_liability_limit | HO Coverage E limit |
| declarations.drivers[].name | driver_info | driver_names | Listed driver names |
| declarations.drivers[].licenseNumber | driver_info | driver_license_numbers | Driver license numbers |
| declarations.vehicles[].vin | vehicle_info | vehicle_vins | Personal vehicle VINs |
| declarations.vehicles[].annualMileage | vehicle_info | annual_mileage | Annual mileage per vehicle |
| declarations.floodZone | property_info | flood_zone | FEMA flood zone |
| declarations.elevationCertificate | property_info | has_elevation_cert | Elevation certificate status |
| declarations.mortgagee.name | financial | mortgagee_name | Mortgage holder name |
| declarations.petName | pet_info | pet_name | Insured pet name |
| declarations.species | pet_info | pet_species | Pet species |
| declarations.breed | pet_info | pet_breed | Pet breed |
```

- [ ] **Step 2: Commit**

```bash
git add docs/data-dictionary.md
git commit -m "docs: add personal lines domains to data dictionary"
```

---

### Task 12: Update Reference Documentation — Form Structure Guide

**Files:**
- Modify: `docs/form-structure-guide.md`

- [ ] **Step 1: Add Part 6 to the form structure guide**

Read `docs/form-structure-guide.md` first, then append:

```markdown
## Part 6: Personal Lines Form Catalog

### ISO Homeowners Forms
| Form Number | Edition | Title | Description |
|---|---|---|---|
| HO 00 02 | 10 00 | Broad Form | Named-perils dwelling, named-perils personal property |
| HO 00 03 | 10 00 | Special Form | Open-perils dwelling, named-perils personal property (most common) |
| HO 00 04 | 10 00 | Contents Broad Form | Renters/tenants — personal property only, named perils |
| HO 00 05 | 10 00 | Comprehensive Form | Open-perils dwelling AND personal property (broadest) |
| HO 00 06 | 10 00 | Unit-Owners Form | Condo owners — unit improvements, personal property, loss assessment |
| HO 00 07 | 10 00 | Mobile Homeowners Form | Manufactured/mobile homes |
| HO 00 08 | 10 00 | Modified Coverage Form | Older homes — repair cost basis, limited perils |

### Key Homeowners Endorsements (HO 04 XX Series)
| Form Number | Title | Effect |
|---|---|---|
| HO 04 10 | Additional Interests — Residence Premises | Adds interests (mortgagee, trust) |
| HO 04 20 | Scheduled Personal Property | Schedules high-value items (jewelry, art) |
| HO 04 41 | Special Personal Property Coverage | Upgrades Cov C to open perils |
| HO 04 53 | Earthquake | Adds earthquake coverage |
| HO 04 54 | Earthquake Loss Assessment | Earthquake for condo loss assessments |
| HO 04 61 | Scheduled Personal Property | Alternative scheduled floater |
| HO 04 90 | Personal Property Replacement Cost | Settles Cov C at replacement cost |
| HO 04 94 | Permitted Incidental Occupancies | Allows limited business use |
| HO 04 95 | Water Back-Up and Sump Discharge/Overflow | Adds sewer/drain backup |
| HO 04 96 | Identity Fraud Expense | Identity theft expense coverage |

### Personal Auto Policy (PAP)
| Form Number | Edition | Title | Description |
|---|---|---|---|
| PP 00 01 | 01 05 | Personal Auto Policy | Base PAP — liability, med pay, UM/UIM, physical damage |
| PP DS 01 | | Personal Auto Declarations | Declarations page listing vehicles, drivers, coverages |

### Key PAP Endorsements (PP 03 XX Series)
| Form Number | Title | Effect |
|---|---|---|
| PP 03 06 | Named Non-Owner Policy | Coverage for individuals without own vehicle |
| PP 03 09 | Extended Non-Owned Coverage — Vehicles Furnished or Available | Extends to employer vehicles |
| PP 03 13 | Extended Non-Owned Coverage for Named Individual | Broader non-owned extension |
| PP 03 22 | Named Driver Exclusion | Excludes specific driver from coverage |
| PP 03 23 | Miscellaneous Type Vehicle | Adds motorcycle, ATV, snowmobile |

### NFIP Flood Forms
| Form | Title | Description |
|---|---|---|
| SFIP Dwelling Form | Standard Flood Insurance Policy — Dwelling Form | 1-4 family residential — building + contents |
| SFIP General Property Form | Standard Flood Insurance Policy — General Property | Non-residential and 5+ unit residential |
| SFIP RCBAP | Residential Condo Building Association Policy | Condo association building coverage |

### ALTA Title Forms
| Form | Title | Description |
|---|---|---|
| ALTA Owner's Policy | Owner's Policy of Title Insurance | Protects property buyer against title defects |
| ALTA Loan Policy | Loan Policy of Title Insurance | Protects mortgage lender against title defects |

### ACORD Personal Lines Applications
| Form Number | Title | Use |
|---|---|---|
| ACORD 80 | Homeowners Application | Used to apply for HO policies |
| ACORD 90 | Personal Automobile Application | Used to apply for PAP policies |

### Chunking Guidance for Personal Lines
- **Homeowners**: Declarations + Coverage A-F typically 2-3 pages. Endorsements follow. Total usually 30-60 pages.
- **Personal Auto**: Declarations + vehicle/driver schedule 2-5 pages. State-specific endorsements can add 10-30 pages.
- **Flood (NFIP)**: Compact — usually 15-25 pages total. Declarations + conditions + definitions.
- **Title**: Very different structure — Commitment (before closing) vs Policy (after closing). Schedule A (covered land), Schedule B (exceptions). Usually 5-15 pages.
```

- [ ] **Step 2: Commit**

```bash
git add docs/form-structure-guide.md
git commit -m "docs: add Part 6 personal lines form catalog to form structure guide"
```

---

### Task 13: Update Reference Documentation — Line of Business Profiles

**Files:**
- Modify: `docs/line-of-business-profiles.md`

- [ ] **Step 1: Add personal lines LOB profiles**

Read `docs/line-of-business-profiles.md` first to understand the existing format (each profile has: Overview, Key Declarations Fields, Common Endorsements, Extraction Signals, Coverage Structure). Then append ~15 new profiles following the exact same format.

The profiles to add (each following the existing format pattern):
1. Homeowners (HO-3)
2. Homeowners (HO-5)
3. Renters (HO-4)
4. Condo (HO-6)
5. Mobile Home (HO-7)
6. Personal Auto (PAP)
7. Dwelling Fire
8. Personal Umbrella
9. NFIP Flood
10. Private Flood
11. Residential Earthquake
12. Personal Articles Floater
13. Watercraft
14. Recreational Vehicle
15. Farm/Ranch
16. Pet
17. Travel
18. Identity Theft
19. Title

Each profile should include:
- **Overview**: 2-3 sentences about the line
- **PolicyType**: The enum value
- **Standard Forms**: ISO/NFIP/ALTA form numbers
- **Key Declarations Fields**: The fields from the corresponding Declarations variant
- **Common Endorsements**: 3-5 most common endorsements for the line
- **Extraction Signals**: How to detect this document type during classification
- **Coverage Structure**: How coverages are organized (e.g., Coverage A-F for homeowners)

This is a large content task. The agent should write all 19 profiles following the established document format.

- [ ] **Step 2: Commit**

```bash
git add docs/line-of-business-profiles.md
git commit -m "docs: add 19 personal lines LOB profiles"
```

---

### Task 14: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Verify typecheck passes**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Clean ESM + CJS + types build

- [ ] **Step 3: Spot-check barrel exports**

Verify the built output includes new types by checking `dist/index.d.ts` contains `Declarations`, `HomeownersDeclarations`, `PersonalAutoDeclarations`, `DwellingDetails`, `FloodZone`, etc.

- [ ] **Step 4: Commit any fixes**

If any issues found in steps 1-3, fix and commit:

```bash
git add -A
git commit -m "fix: resolve build/typecheck issues from personal lines expansion"
```
