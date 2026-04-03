# Consumer P&C Expansion — Design Spec

**Version:** 1.0
**Date:** 2026-04-03
**Scope:** Expand the CL-0 SDK from commercial-only to full commercial + consumer (personal lines) P&C insurance support

---

## 1. Goal

Add comprehensive consumer/personal lines P&C support to the CL-0 SDK. This means new policy types, a typed declarations union system (replacing flat fields), expanded extraction prompts, pipeline updates, agent system awareness, context key mappings, and reference document updates — all while maintaining full backward compatibility with existing commercial consumers.

---

## 2. Personal Lines to Add

15 new `PolicyType` values:

| PolicyType Value | Line | Standard Forms |
|---|---|---|
| `homeowners_ho3` | HO-3 Special Form | HO 00 03, HO DS 01 |
| `homeowners_ho5` | HO-5 Comprehensive | HO 00 05 |
| `renters_ho4` | HO-4 Contents Broad | HO 00 04 |
| `condo_ho6` | HO-6 Unit-Owners | HO 00 06 |
| `dwelling_fire` | Dwelling Fire | DP 00 01/02/03 |
| `mobile_home` | Mobile/Manufactured Home | HO 00 07 |
| `personal_auto` | Personal Auto Policy (PAP) | PP 00 01 |
| `personal_umbrella` | Personal Umbrella/Excess | Carrier-proprietary |
| `flood_nfip` | NFIP Standard Flood | SFIP Dwelling/General Property |
| `flood_private` | Private Flood | Carrier-proprietary |
| `earthquake` | Residential Earthquake | CEA/carrier-proprietary |
| `personal_inland_marine` | Personal Articles Floater | Carrier-proprietary |
| `watercraft` | Watercraft/Boat | Carrier-proprietary |
| `recreational_vehicle` | RV/ATV/Snowmobile | Carrier-proprietary |
| `farm_ranch` | Farm/Ranch Owner | Carrier-proprietary (hybrid) |
| `pet` | Pet Insurance | Carrier-proprietary |
| `travel` | Travel Insurance | Carrier-proprietary |
| `identity_theft` | Identity Theft | Carrier-proprietary |
| `title` | Title Insurance | ALTA Owner's/Lender's |

Total `PolicyType` values after expansion: ~42 (23 existing + 19 new).

---

## 3. Typed Declarations Union

### 3.1 Architecture

Replace flat line-specific fields on `BaseDocument` with a single typed `declarations?: Declarations` field. The `Declarations` type is a discriminated union keyed by a `line` discriminant string.

```typescript
// BaseDocument gains:
declarations?: Declarations;

// Existing flat fields stay but are @deprecated:
/** @deprecated Use declarations instead */
limits?: LimitSchedule;
/** @deprecated Use declarations instead */
deductibles?: DeductibleSchedule;
/** @deprecated Use declarations instead */
locations?: InsuredLocation[];
/** @deprecated Use declarations instead */
vehicles?: InsuredVehicle[];
/** @deprecated Use declarations instead */
classifications?: ClassificationCode[];
```

The pipeline populates BOTH the deprecated flat fields AND the new `declarations` field during a transition period. Existing consumers continue to work unchanged.

### 3.2 Personal Lines Declarations Variants

#### HomeownersDeclarations
```
line: "homeowners"
formType: "HO-3" | "HO-5" | "HO-4" | "HO-6" | "HO-7" | "HO-8"
coverageA?: string          — Dwelling limit
coverageB?: string          — Other Structures limit
coverageC?: string          — Personal Property limit
coverageD?: string          — Loss of Use limit
coverageE?: string          — Personal Liability limit
coverageF?: string          — Medical Payments to Others limit
allPerilDeductible?: string — Standard deductible
windHailDeductible?: string — Separate wind/hail deductible (coastal states)
hurricaneDeductible?: string — Hurricane deductible (FL, etc.)
lossSettlement?: "replacement_cost" | "actual_cash_value" | "extended_replacement_cost" | "guaranteed_replacement_cost"
dwelling: DwellingDetails
mortgagee?: EndorsementParty
additionalMortgagees?: EndorsementParty[]
```

#### DwellingDetails (shared interface)
```
constructionType?: "frame" | "masonry" | "superior" | "mixed" | "other"
yearBuilt?: number
squareFootage?: number
stories?: number
roofType?: "asphalt_shingle" | "tile" | "metal" | "slate" | "flat" | "wood_shake" | "other"
roofAge?: number
heatingType?: "central" | "baseboard" | "radiant" | "space_heater" | "heat_pump" | "other"
foundationType?: "basement" | "crawl_space" | "slab" | "pier" | "other"
plumbingType?: "copper" | "pex" | "galvanized" | "polybutylene" | "cpvc" | "other"
electricalType?: "circuit_breaker" | "fuse_box" | "knob_and_tube" | "other"
electricalAmps?: number
hasSwimmingPool?: boolean
poolType?: "in_ground" | "above_ground"
hasTrampoline?: boolean
hasDog?: boolean
dogBreed?: string
protectiveDevices?: string[]  — alarm, sprinkler, deadbolt, smoke detector, etc.
distanceToFireStation?: string
distanceToHydrant?: string
fireProtectionClass?: string
```

#### PersonalAutoDeclarations
```
line: "personal_auto"
vehicles: PersonalVehicleDetails[]
drivers: DriverRecord[]
liabilityLimits?: {
  bodilyInjuryPerPerson?: string
  bodilyInjuryPerAccident?: string
  propertyDamage?: string
  combinedSingleLimit?: string
}
umLimits?: {
  bodilyInjuryPerPerson?: string
  bodilyInjuryPerAccident?: string
}
uimLimits?: {
  bodilyInjuryPerPerson?: string
  bodilyInjuryPerAccident?: string
}
pipLimit?: string
medPayLimit?: string
```

#### PersonalVehicleDetails
```
number?: number
year?: number
make?: string
model?: string
vin?: string
bodyType?: string
garagingAddress?: Address
usage?: "pleasure" | "commute" | "business" | "farm"
annualMileage?: number
odometerReading?: number
driverAssignment?: string     — name of primary driver
lienHolder?: EndorsementParty
collisionDeductible?: string
comprehensiveDeductible?: string
rentalReimbursement?: boolean
towing?: boolean
```

#### DriverRecord
```
name: string
dateOfBirth?: string
licenseNumber?: string
licenseState?: string
relationship?: "named_insured" | "spouse" | "child" | "other_household" | "other"
yearsLicensed?: number
gender?: string
maritalStatus?: string
goodStudentDiscount?: boolean
defensiveDriverDiscount?: boolean
violations?: Array<{
  date?: string
  type?: string
  description?: string
}>
accidents?: Array<{
  date?: string
  atFault?: boolean
  description?: string
  amountPaid?: string
}>
sr22Required?: boolean
```

#### DwellingFireDeclarations
```
line: "dwelling_fire"
formType: "DP-1" | "DP-2" | "DP-3"
dwellingLimit?: string
otherStructuresLimit?: string
personalPropertyLimit?: string
fairRentalValueLimit?: string
liabilityLimit?: string
medicalPaymentsLimit?: string
deductible?: string
dwelling: DwellingDetails
```

#### FloodDeclarations
```
line: "flood"
programType: "nfip" | "private"
floodZone?: FloodZone
communityNumber?: string
communityRating?: number     — CRS rating 1-10
buildingCoverage?: string
contentsCoverage?: string
iccCoverage?: string         — Increased Cost of Compliance
deductible?: string
waitingPeriodDays?: number   — NFIP standard is 30
elevationCertificate?: boolean
elevationDifference?: string
buildingDiagramNumber?: number  — NFIP 1-9
basementOrEnclosure?: boolean
postFirmConstruction?: boolean  — built after FIRM date
```

#### EarthquakeDeclarations
```
line: "earthquake"
dwellingCoverage?: string
contentsCoverage?: string
lossOfUseCoverage?: string
deductiblePercent?: number   — typically 5%, 10%, 15%, 20%, 25%
retrofitDiscount?: boolean
masonryVeneerCoverage?: boolean
```

#### PersonalUmbrellaDeclarations
```
line: "personal_umbrella"
perOccurrenceLimit?: string
aggregateLimit?: string
retainedLimit?: string       — self-insured retention
underlyingPolicies: Array<{
  carrier?: string
  policyNumber?: string
  policyType?: string
  limits?: string
}>
```

#### PersonalArticlesDeclarations
```
line: "personal_articles"
scheduledItems: Array<{
  itemNumber?: number
  category?: "jewelry" | "fine_art" | "musical_instruments" | "silverware" | "furs" | "cameras" | "collectibles" | "firearms" | "golf_equipment" | "other"
  description: string
  appraisedValue: string
  appraisalDate?: string
}>
blanketCoverage?: string     — unscheduled blanket limit
deductible?: string
worldwideCoverage?: boolean
breakageCoverage?: boolean
```

#### WatercraftDeclarations
```
line: "watercraft"
boatType?: "sailboat" | "powerboat" | "pontoon" | "jet_ski" | "kayak_canoe" | "yacht" | "other"
year?: number
make?: string
model?: string
length?: string
hullMaterial?: "fiberglass" | "aluminum" | "wood" | "steel" | "inflatable" | "other"
hullValue?: string
motorHorsepower?: number
motorType?: "outboard" | "inboard" | "inboard_outboard" | "jet"
navigationLimits?: string
layupPeriod?: string          — months out of water
liabilityLimit?: string
medicalPaymentsLimit?: string
physicalDamageDeductible?: string
uninsuredBoaterLimit?: string
trailerCovered?: boolean
trailerValue?: string
```

#### RecreationalVehicleDeclarations
```
line: "recreational_vehicle"
vehicleType: "rv_motorhome" | "travel_trailer" | "atv" | "snowmobile" | "golf_cart" | "dirt_bike" | "other"
year?: number
make?: string
model?: string
vin?: string
value?: string
liabilityLimit?: string
collisionDeductible?: string
comprehensiveDeductible?: string
personalEffectsCoverage?: string
fullTimerCoverage?: boolean   — for RVs used as primary residence
```

#### FarmRanchDeclarations
```
line: "farm_ranch"
dwellingCoverage?: string
farmPersonalPropertyCoverage?: string
farmLiabilityLimit?: string
farmAutoIncluded?: boolean
livestock?: Array<{
  type: string
  headCount: number
  value?: string
}>
equipmentSchedule?: Array<{
  description: string
  value: string
}>
acreage?: number
dwelling?: DwellingDetails
```

#### TitleDeclarations
```
line: "title"
policyType: "owners" | "lenders"
policyAmount: string
legalDescription?: string
propertyAddress?: Address
effectiveDate?: string
exceptions?: Array<{
  number: number
  description: string
}>
underwriter?: string
```

#### PetDeclarations
```
line: "pet"
species: "dog" | "cat" | "other"
breed?: string
petName?: string
age?: number
annualLimit?: string
perIncidentLimit?: string
deductible?: string
reimbursementPercent?: number  — typically 70%, 80%, 90%
waitingPeriodDays?: number
preExistingConditionsExcluded?: boolean
wellnessCoverage?: boolean
```

#### TravelDeclarations
```
line: "travel"
tripDepartureDate?: string
tripReturnDate?: string
destinations?: string[]
travelers?: Array<{
  name: string
  age?: number
}>
tripCost?: string
tripCancellationLimit?: string
medicalLimit?: string
evacuationLimit?: string
baggageLimit?: string
```

#### IdentityTheftDeclarations
```
line: "identity_theft"
coverageLimit?: string
expenseReimbursement?: string
creditMonitoring?: boolean
restorationServices?: boolean
lostWagesLimit?: string
```

### 3.3 Commercial Lines Declarations Variants (Retrofit)

Existing flat fields on BaseDocument are restructured into typed variants. The pipeline populates both old flat fields and new declarations field.

#### GLDeclarations
```
line: "gl"
coverageForm?: CoverageForm
perOccurrenceLimit?: string
generalAggregate?: string
productsCompletedOpsAggregate?: string
personalAdvertisingInjury?: string
fireDamage?: string
medicalExpense?: string
defenseCostTreatment?: DefenseCostTreatment
deductible?: string
classifications?: ClassificationCode[]
retroactiveDate?: string
```

#### CommercialPropertyDeclarations
```
line: "commercial_property"
causesOfLossForm?: "basic" | "broad" | "special"
coinsurancePercent?: number
valuationMethod?: ValuationMethod
locations: InsuredLocation[]
blanketLimit?: string
businessIncomeLimit?: string
extraExpenseLimit?: string
```

#### CommercialAutoDeclarations
```
line: "commercial_auto"
vehicles: InsuredVehicle[]
coveredAutoSymbols?: number[]
liabilityLimit?: string
umLimit?: string
uimLimit?: string
hiredAutoLiability?: boolean
nonOwnedAutoLiability?: boolean
```

#### WorkersCompDeclarations
```
line: "workers_comp"
coveredStates?: string[]
classifications: ClassificationCode[]
experienceMod?: ExperienceMod
employersLiability?: EmployersLiabilityLimits
```

#### UmbrellaExcessDeclarations
```
line: "umbrella_excess"
perOccurrenceLimit?: string
aggregateLimit?: string
retention?: string
underlyingPolicies: Array<{
  carrier?: string
  policyNumber?: string
  policyType?: string
  limits?: string
}>
```

#### ProfessionalLiabilityDeclarations
```
line: "professional_liability"
perClaimLimit?: string
aggregateLimit?: string
retroactiveDate?: string
defenseCostTreatment?: DefenseCostTreatment
extendedReportingPeriod?: ExtendedReportingPeriod
```

#### CyberDeclarations
```
line: "cyber"
aggregateLimit?: string
retroactiveDate?: string
waitingPeriodHours?: number
sublimits?: Array<{
  coverageName: string
  limit: string
}>
```

#### DODeclarations
```
line: "directors_officers"
sideALimit?: string
sideBLimit?: string
sideCLimit?: string
sideARetention?: string
sideBRetention?: string
sideCRetention?: string
continuityDate?: string
```

#### CrimeDeclarations
```
line: "crime"
formType?: "discovery" | "loss_sustained"
agreements: Array<{
  agreement: string  — "A" through "F"
  coverageName: string
  limit: string
  deductible: string
}>
```

### 3.4 File Organization

New file: `src/types/declarations/index.ts` — re-exports all variants
New file: `src/types/declarations/personal.ts` — all personal lines declarations interfaces
New file: `src/types/declarations/commercial.ts` — all commercial lines declarations interfaces
New file: `src/types/declarations/shared.ts` — DwellingDetails, DriverRecord, PersonalVehicleDetails, and the Declarations union type

The existing `src/types/declarations.ts` stays and keeps its current exports (LimitSchedule, DeductibleSchedule, InsuredLocation, InsuredVehicle, ClassificationCode) — these are still used by both the deprecated flat fields and the new commercial declarations variants.

---

## 4. Enum Expansions

### PolicyType
Add 19 new values (listed in Section 2). Total: ~42.

### New Union Types

```typescript
type HomeownersFormType = "HO-3" | "HO-5" | "HO-4" | "HO-6" | "HO-7" | "HO-8";
type DwellingFireFormType = "DP-1" | "DP-2" | "DP-3";
type FloodZone = "A" | "AE" | "AH" | "AO" | "AR" | "V" | "VE" | "B" | "C" | "X" | "D";
type ConstructionType = "frame" | "masonry" | "superior" | "mixed" | "other";
type RoofType = "asphalt_shingle" | "tile" | "metal" | "slate" | "flat" | "wood_shake" | "other";
type FoundationType = "basement" | "crawl_space" | "slab" | "pier" | "other";
type PersonalAutoUsage = "pleasure" | "commute" | "business" | "farm";
type LossSettlement = "replacement_cost" | "actual_cash_value" | "extended_replacement_cost" | "guaranteed_replacement_cost";
type BoatType = "sailboat" | "powerboat" | "pontoon" | "jet_ski" | "kayak_canoe" | "yacht" | "other";
type RVType = "rv_motorhome" | "travel_trailer" | "atv" | "snowmobile" | "golf_cart" | "dirt_bike" | "other";
type ScheduledItemCategory = "jewelry" | "fine_art" | "musical_instruments" | "silverware" | "furs" | "cameras" | "collectibles" | "firearms" | "golf_equipment" | "other";
type TitlePolicyType = "owners" | "lenders";
type PetSpecies = "dog" | "cat" | "other";
```

### EntityType
Add: `"individual"` | `"married_couple"`

### RatingBasisType
Add: `"dwelling_value"` | `"vehicle_value"` | `"contents_value"`

---

## 5. Extraction Prompt Changes

### CLASSIFY_DOCUMENT_PROMPT
Add personal lines detection signals:
- HO form numbers (HO 00 03, HO 00 04, HO 00 05, HO 00 06, HO 00 07)
- PAP form numbers (PP 00 01)
- NFIP/flood policy headers
- Auto ID card format
- Title commitment format
- Pet/travel policy headers (carrier-specific patterns)

### METADATA_PROMPT
Expand the policyTypes enum in the prompt to include all new personal lines values. Add extraction guidance for personal lines metadata patterns:
- Coverage A-F structure (homeowners)
- Driver table (personal auto)
- Flood zone and elevation data
- Scheduled items list (personal articles)

### QUOTE_METADATA_PROMPT
Same expansion for personal lines quotes. Personal lines quotes have different structures — HO quotes show Coverage A-F with premium, auto quotes show per-vehicle pricing.

### buildSectionsPrompt
Add personal lines endorsement recognition:
- HO 04 XX series (homeowners endorsements)
- PP 03 XX series (personal auto endorsements)
- HO 17 XX series (mobilehome endorsements)
- Personal lines exclusion patterns

### buildPersonalLinesHint (new helper)
Given a detected policyType, returns a context hint string that tells the extraction model what fields to focus on. For example:
- `homeowners_ho3` → "This is an HO-3 Special Form homeowners policy. Extract Coverage A through F limits, dwelling details, deductible, loss settlement method, and mortgagee."
- `personal_auto` → "This is a Personal Auto Policy. Extract liability BI/PD limits, UM/UIM limits, per-vehicle coverages, driver list with DOB/license/violations."

---

## 6. Pipeline Changes

### applyExtracted
After the existing flat field mapping:
1. Detect the primary line from `policyTypes`
2. Construct the appropriate `Declarations` variant with line-specific fields
3. Assign to `fields.declarations`
4. Continue to populate deprecated flat fields for backward compat

### applyExtractedQuote
Same pattern — construct declarations from quote metadata.

### mergeChunkedSections / mergeChunkedQuoteSections
No structural changes needed. Endorsements, exclusions, and conditions merge the same way regardless of personal vs commercial.

---

## 7. Agent System Updates

### quotes-policies.ts
Expand with personal lines guidance:
- How to discuss Coverage A-F for homeowners
- How to explain auto liability splits (BI per person/per accident vs CSL)
- Flood coverage gap warnings (mortgage requirement, waiting period)
- Umbrella underlying requirements

### coverage-gaps.ts (expand existing module)
Add personal lines coverage gap patterns:
- No flood insurance in flood zone
- Dwelling coverage below estimated rebuild cost
- Liability limits below personal umbrella underlying requirements
- No UM/UIM coverage
- No scheduled articles for high-value items (jewelry > $1,500 typically needs scheduling)
- No identity theft coverage
- Dwelling fire on DP-1 (basic form — suggests upgrade to DP-3)

### intent.ts
Expand `buildClassifyMessagePrompt` to detect personal lines conversation intents:
- Property damage claims: "my roof leaked", "tree fell on house", "pipe burst"
- Auto claims: "got in an accident", "someone hit my car", "fender bender"
- Coverage questions: "do I need flood insurance", "what's my deductible", "am I covered for"
- Shopping: "I need homeowners insurance", "looking for auto coverage", "compare my rates"

---

## 8. Context Key Mappings

~20 new entries in `CONTEXT_KEY_MAP` for personal lines application auto-fill:

| Extracted Field Path | Context Category | Context Key |
|---|---|---|
| `declarations.dwelling.yearBuilt` | `property_info` | `year_built` |
| `declarations.dwelling.constructionType` | `property_info` | `construction_type` |
| `declarations.dwelling.squareFootage` | `property_info` | `square_footage` |
| `declarations.dwelling.roofType` | `property_info` | `roof_type` |
| `declarations.dwelling.roofAge` | `property_info` | `roof_age` |
| `declarations.dwelling.stories` | `property_info` | `num_stories` |
| `declarations.dwelling.heatingType` | `property_info` | `heating_type` |
| `declarations.dwelling.protectiveDevices` | `property_info` | `protective_devices` |
| `declarations.coverageA` | `coverage` | `dwelling_coverage_limit` |
| `declarations.coverageE` | `coverage` | `personal_liability_limit` |
| `declarations.drivers[].name` | `driver_info` | `driver_names` |
| `declarations.drivers[].licenseNumber` | `driver_info` | `driver_license_numbers` |
| `declarations.vehicles[].vin` | `vehicle_info` | `vehicle_vins` |
| `declarations.vehicles[].annualMileage` | `vehicle_info` | `annual_mileage` |
| `declarations.floodZone` | `property_info` | `flood_zone` |
| `declarations.elevationCertificate` | `property_info` | `has_elevation_cert` |
| `declarations.mortgagee.name` | `financial` | `mortgagee_name` |
| `insuredAddress` | `company_info` | `primary_residence_address` |
| `declarations.petName` | `pet_info` | `pet_name` |
| `declarations.species` | `pet_info` | `pet_species` |
| `declarations.breed` | `pet_info` | `pet_breed` |

---

## 9. Reference Document Updates

### docs/data-dictionary.md
- New Domain 12: Personal Lines Declarations — field specs for all personal lines declaration variants
- New Domain 13: Personal Lines Supporting Types — DwellingDetails, DriverRecord, PersonalVehicleDetails
- Update Domain 11 (Business Context Storage) with personal lines context key mappings table

### docs/form-structure-guide.md
- New Part 6: Personal Lines Form Catalog
  - ISO Homeowners forms: HO 00 02/03/04/05/06/07/08
  - HO endorsement series: HO 04 10, HO 04 20, HO 04 41, HO 04 61, HO 04 90, HO 04 94, HO 04 95, etc.
  - PAP forms: PP 00 01 (base), PP DS 01 (declarations)
  - PAP endorsements: PP 03 06, PP 03 09, PP 03 13, PP 03 22, PP 03 23, etc.
  - NFIP forms: SFIP Dwelling Form, SFIP General Property Form, SFIP Residential Condo Building Association Form
  - ALTA title forms: ALTA Owner's Policy, ALTA Loan Policy
  - ACORD personal lines applications: ACORD 80 (homeowners), ACORD 90 (personal auto)
- New chunking guidance for personal lines document structures

### docs/line-of-business-profiles.md
Add ~15 new profiles following exact existing format:
- Homeowners (HO-3), Homeowners (HO-5), Renters (HO-4), Condo (HO-6), Mobile Home (HO-7)
- Personal Auto (PAP)
- Dwelling Fire
- Personal Umbrella
- NFIP Flood, Private Flood
- Residential Earthquake
- Personal Articles Floater
- Watercraft, Recreational Vehicle
- Farm/Ranch, Pet, Travel, Identity Theft, Title

---

## 10. File Structure Summary

### New Files
| File | Responsibility |
|---|---|
| `src/types/declarations/index.ts` | Re-exports all declarations variants + Declarations union |
| `src/types/declarations/personal.ts` | All personal lines declarations interfaces |
| `src/types/declarations/commercial.ts` | All commercial lines declarations interfaces |
| `src/types/declarations/shared.ts` | DwellingDetails, DriverRecord, PersonalVehicleDetails, Declarations union type |

### Modified Files
| File | Changes |
|---|---|
| `src/types/enums.ts` | Add 19 PolicyType values, new union types (FloodZone, ConstructionType, etc.), expand EntityType, RatingBasisType |
| `src/types/document.ts` | Add `declarations?: Declarations` field, deprecate flat line-specific fields |
| `src/types/context-keys.ts` | Add ~20 personal lines context key mappings |
| `src/prompts/extraction.ts` | Expand all prompts for personal lines, add buildPersonalLinesHint helper |
| `src/extraction/pipeline.ts` | applyExtracted/applyExtractedQuote construct Declarations variant |
| `src/prompts/agent/quotes-policies.ts` | Personal lines coverage guidance |
| `src/prompts/agent/coverage-gaps.ts` | Expand with personal lines coverage gap patterns |
| `src/prompts/intent.ts` | Expand message classification for personal lines intents |
| `src/index.ts` | Export new types |
| `docs/data-dictionary.md` | Add Domains 12-13, update Domain 11 |
| `docs/form-structure-guide.md` | Add Part 6 (personal lines forms) |
| `docs/line-of-business-profiles.md` | Add ~15 new LOB profiles |

---

## 11. Backward Compatibility

- All existing `PolicyType` values remain unchanged
- All existing flat fields on `BaseDocument` remain but are marked `@deprecated`
- The pipeline populates BOTH deprecated flat fields AND new `declarations` field
- Existing consumers that read `doc.limits`, `doc.locations`, etc. continue to work
- New consumers use `doc.declarations` with type narrowing via `declarations.line`
- No breaking changes — this is a minor version bump
