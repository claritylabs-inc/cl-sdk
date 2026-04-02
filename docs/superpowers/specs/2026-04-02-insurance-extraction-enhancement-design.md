# Insurance Extraction Enhancement — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Scope:** Three deliverables that drive SDK extraction pipeline improvements, agent system enhancements, and application processing (business context storage)

---

## Overview

The CL-0 SDK currently extracts insurance document data into a relatively flat model: coverages are `{name, limit, deductible}`, sections store verbatim text blobs, and there's no modeling for endorsements, named locations, loss history, retroactive dates, aggregate vs per-occurrence limits, SIRs, sublimits, additional insureds, waiver of subrogation, etc.

This design expands and deepens extraction across 20 lines of business with structured schemas for every section type that can be reliably structured, plus enriched text fallback for high-variance sections.

### Deliverables

1. **Data Dictionary** (`docs/data-dictionary.md`) — Comprehensive field/type/schema definitions organized by domain
2. **Form Structure Guide** (`docs/form-structure-guide.md`) — Document organization patterns, intelligent chunking strategies, ISO/ACORD form catalog
3. **Line-of-Business Profiles** (`docs/line-of-business-profiles.md`) — Per-line specifics combining relevant fields with relevant form structures

### How These Drive SDK Changes

- **Extraction pipeline** (`src/extraction/pipeline.ts`) — Richer structured output from each pass, form-boundary aware chunking, endorsement-level extraction
- **Type system** (`src/types/document.ts`) — New interfaces for endorsements, declarations, exclusions, conditions, parties, financial details, loss history
- **Extraction prompts** (`src/prompts/extraction.ts`) — Updated schemas in prompts to request new structured fields
- **Agent system** (`src/prompts/agent/`) — Better prompts that leverage structured data (e.g., knowing exact endorsement types rather than searching raw text)
- **Application processing** (`src/prompts/application.ts`) — Business context storage keys mapped from extracted policy data to application auto-fill

---

## Deliverable 1: Data Dictionary

### Purpose & Format

Every extractable field organized by domain. Each field entry includes:

| Attribute | Description |
|-----------|-------------|
| **Field name** | `snake_case`, maps directly to TypeScript property |
| **Type** | string, number, boolean, enum, array of typed objects |
| **Description** | What it is, where it typically appears in documents |
| **Source section** | Which document section(s) it's extracted from |
| **Reliability** | high / medium / low — how consistently it appears across carriers |
| **SDK interface** | Which TypeScript interface it belongs to |
| **Context key** | Business context storage key for application auto-fill (if applicable) |

### Domain 1: Core Document Metadata

Fields present on ALL insurance documents regardless of line.

#### Document Identification

| Field | Type | Description | Source | Reliability | Context Key |
|-------|------|-------------|--------|-------------|-------------|
| `document_type` | `"policy" \| "quote" \| "binder" \| "endorsement" \| "certificate"` | Classification of the document | Cover page / header | high | — |
| `carrier` | `string` | Insurance company marketing name | Declarations / header | high | — |
| `carrier_legal_name` | `string` | Legal entity name of insurer | Declarations | high | — |
| `carrier_naic_number` | `string` | NAIC company code | Declarations / footer | medium | — |
| `carrier_am_best_rating` | `string` | AM Best financial strength rating (e.g., "A+ XV") | Declarations or separate page | low | — |
| `carrier_admitted_status` | `"admitted" \| "non_admitted" \| "surplus_lines"` | Regulatory status in state | Declarations / surplus lines notice | medium | — |
| `security` | `string` | Legal entity on risk (may differ from carrier marketing name) | Declarations | medium | — |
| `mga` | `string \| null` | Managing General Agent, if applicable | Declarations / cover | medium | — |
| `underwriter` | `string \| null` | Named underwriter | Cover letter / dec page | low | — |
| `broker_agency` | `string` | Producer / broker agency name | Declarations | high | `broker_agency` |
| `broker_contact_name` | `string` | Individual producer name | Declarations | medium | `broker_contact_name` |
| `broker_license_number` | `string` | Producer license number | Declarations | low | — |
| `policy_number` | `string` | Policy number (bound policies) | Declarations | high | — |
| `quote_number` | `string` | Quote/proposal reference number | Cover page | high | — |
| `prior_policy_number` | `string \| null` | Previous policy number if renewal | Declarations | medium | — |
| `program_name` | `string \| null` | Named program (e.g., "Contractors Program") | Declarations / cover | low | — |
| `is_renewal` | `boolean` | Whether this is a renewal vs new business | Declarations | medium | — |
| `is_package` | `boolean` | Whether this is a commercial package policy (CPP) | Declarations / form schedule | high | — |

#### Named Insureds

| Field | Type | Description | Source | Reliability | Context Key |
|-------|------|-------------|--------|-------------|-------------|
| `insured_name` | `string` | First/primary named insured | Declarations | high | `company_name` |
| `insured_dba` | `string \| null` | Doing-business-as name | Declarations | medium | `dba_name` |
| `insured_address` | `Address` | Mailing address of primary insured | Declarations | high | `company_address` |
| `insured_entity_type` | `"corporation" \| "llc" \| "partnership" \| "sole_proprietor" \| "joint_venture" \| "trust" \| "nonprofit" \| "municipality" \| "other"` | Legal entity type | Declarations / application | medium | `entity_type` |
| `additional_named_insureds` | `NamedInsured[]` | Schedule of additional named insureds | Declarations / endorsement | medium | — |
| `insured_sic_code` | `string \| null` | SIC classification code | Declarations | low | `sic_code` |
| `insured_naics_code` | `string \| null` | NAICS classification code | Declarations | low | `naics_code` |
| `insured_fein` | `string \| null` | Federal Employer ID Number | Declarations / application | low | `fein` |

#### Policy Period

| Field | Type | Description | Source | Reliability | Context Key |
|-------|------|-------------|--------|-------------|-------------|
| `effective_date` | `string` (MM/DD/YYYY) | Policy inception date | Declarations | high | — |
| `expiration_date` | `string` (MM/DD/YYYY) | Policy expiration date | Declarations | high | — |
| `effective_time` | `string` | Time of day coverage begins (e.g., "12:01 AM") | Declarations | medium | — |
| `retroactive_date` | `string \| null` (MM/DD/YYYY) | Claims-made retroactive date | Declarations (claims-made policies) | high (when applicable) | — |
| `pending_prior_date` | `string \| null` (MM/DD/YYYY) | Pending or prior date for claims-made | Declarations | medium | — |
| `extended_reporting_period` | `ExtendedReportingPeriod \| null` | Tail coverage options | Endorsement / conditions | medium | — |
| `cancellation_notice_days` | `number \| null` | Days notice required for cancellation | Conditions | medium | — |
| `nonrenewal_notice_days` | `number \| null` | Days notice required for nonrenewal | Conditions | medium | — |

#### Premium Structure

| Field | Type | Description | Source | Reliability | Context Key |
|-------|------|-------------|--------|-------------|-------------|
| `total_premium` | `string` | Total policy premium | Declarations | high | — |
| `premium_breakdown` | `PremiumLine[]` | Premium by coverage line | Declarations / premium page | high | — |
| `taxes_and_fees` | `TaxFeeItem[]` | Taxes, surcharges, fees breakdown | Declarations / billing page | medium | — |
| `total_cost` | `string` | Premium + taxes + fees | Declarations / billing page | medium | — |
| `minimum_premium` | `string \| null` | Minimum earned premium | Declarations / conditions | medium | — |
| `deposit_premium` | `string \| null` | Deposit premium (audit policies) | Declarations | medium | — |
| `payment_plan` | `PaymentPlan \| null` | Installment schedule | Billing page / dec | low | — |
| `audit_type` | `"annual" \| "semi_annual" \| "quarterly" \| "monthly" \| "self" \| "physical" \| "none" \| null` | Type of premium audit | Declarations / conditions | medium | — |
| `rating_basis` | `RatingBasis[]` | What the premium is based on (payroll, revenue, area, etc.) | Declarations / rating page | medium | — |
| `experience_modifier` | `number \| null` | Experience modification factor (WC) | Declarations | high (WC) | `experience_mod` |
| `retrospective_rating` | `boolean` | Whether retrospective rating applies | Declarations / endorsement | low | — |

#### Policy Lines Classification

| Field | Type | Description | Source | Reliability | Context Key |
|-------|------|-------------|--------|-------------|-------------|
| `policy_types` | `PolicyType[]` | Lines of business covered | Declarations / form schedule | high | — |
| `coverage_form` | `"occurrence" \| "claims_made" \| "accident"` | Coverage trigger type | Declarations / insuring agreement | high | — |
| `policy_form_numbers` | `FormReference[]` | All form numbers listed in policy | Form schedule / endorsement schedule | high | — |

### Domain 2: Declarations (Structured Per-Line)

The declarations page(s) contain the deal summary. These fields go beyond core metadata into line-specific structured data.

#### Limits Schedule

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `limits` | `LimitSchedule` | Complete limits structure | Declarations | high |
| `limits.per_occurrence` | `string \| null` | Per-occurrence / per-claim limit | Declarations | high |
| `limits.general_aggregate` | `string \| null` | General aggregate limit | Declarations | high |
| `limits.products_completed_ops_aggregate` | `string \| null` | Products/completed operations aggregate | Declarations (GL) | high |
| `limits.personal_advertising_injury` | `string \| null` | Personal & advertising injury limit | Declarations (GL) | high |
| `limits.each_employee` | `string \| null` | Each employee limit (EPLI) | Declarations | high |
| `limits.fire_damage` | `string \| null` | Damage to premises rented to you | Declarations (GL) | high |
| `limits.medical_expense` | `string \| null` | Medical expense limit | Declarations (GL) | medium |
| `limits.combined_single_limit` | `string \| null` | CSL for auto | Declarations (auto) | high |
| `limits.bodily_injury_per_person` | `string \| null` | BI per person (split limits) | Declarations (auto) | high |
| `limits.bodily_injury_per_accident` | `string \| null` | BI per accident (split limits) | Declarations (auto) | high |
| `limits.property_damage` | `string \| null` | PD limit (split limits) | Declarations (auto) | high |
| `limits.each_occurrence_umbrella` | `string \| null` | Umbrella per occurrence | Declarations (umbrella) | high |
| `limits.umbrella_aggregate` | `string \| null` | Umbrella aggregate | Declarations (umbrella) | high |
| `limits.umbrella_retention` | `string \| null` | Self-insured retention | Declarations (umbrella) | high |
| `limits.statutory` | `boolean` | Statutory limits (WC) | Declarations (WC) | high |
| `limits.employers_liability` | `EmployersLiabilityLimits \| null` | EL limits (each accident, disease-policy, disease-each) | Declarations (WC) | high |
| `limits.sublimits` | `Sublimit[]` | Named sublimits | Declarations / endorsements | medium |
| `limits.shared_limits` | `SharedLimit[] \| null` | Limits shared across coverage parts | Declarations (package) | medium |
| `limits.defense_cost_treatment` | `"inside_limits" \| "outside_limits" \| "supplementary"` | Whether defense costs erode limits | Insuring agreement / conditions | high |

#### Deductibles & Self-Insured Retentions

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `deductibles` | `DeductibleSchedule` | Complete deductible structure | Declarations | high |
| `deductibles.per_claim` | `string \| null` | Per-claim deductible | Declarations | high |
| `deductibles.per_occurrence` | `string \| null` | Per-occurrence deductible | Declarations | high |
| `deductibles.aggregate_deductible` | `string \| null` | Aggregate deductible | Declarations | medium |
| `deductibles.self_insured_retention` | `string \| null` | SIR amount | Declarations | high |
| `deductibles.corridor_deductible` | `string \| null` | Corridor deductible (between primary and excess) | Declarations | low |
| `deductibles.waiting_period` | `string \| null` | Waiting period (cyber, disability) | Declarations | medium |
| `deductibles.applies_to` | `"damages_only" \| "damages_and_defense" \| "defense_only"` | What the deductible applies to | Conditions / insuring agreement | medium |

#### Named Locations / Premises

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `locations` | `InsuredLocation[]` | Schedule of insured locations/premises | Declarations / location schedule | high |
| `locations[].number` | `number` | Location number | Schedule | high |
| `locations[].address` | `Address` | Physical address | Schedule | high |
| `locations[].description` | `string \| null` | Description of operations at location | Schedule | medium |
| `locations[].building_value` | `string \| null` | Building replacement cost | Schedule (property) | high (property) |
| `locations[].contents_value` | `string \| null` | Contents value | Schedule (property) | high (property) |
| `locations[].business_income_value` | `string \| null` | Business income limit | Schedule (property) | medium |
| `locations[].construction_type` | `string \| null` | Construction class (frame, masonry, etc.) | Schedule (property) | medium |
| `locations[].year_built` | `number \| null` | Year built | Schedule (property) | medium |
| `locations[].square_footage` | `number \| null` | Square footage | Schedule (property) | low |
| `locations[].protection_class` | `string \| null` | Fire protection class | Schedule (property) | medium |
| `locations[].sprinklered` | `boolean \| null` | Whether sprinklered | Schedule (property) | medium |
| `locations[].alarm_type` | `string \| null` | Security alarm type | Schedule (property) | low |
| `locations[].occupancy` | `string \| null` | Occupancy description | Schedule (property) | medium |

#### Vehicle / Equipment Schedule

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `vehicles` | `InsuredVehicle[]` | Schedule of covered vehicles | Declarations / vehicle schedule | high (auto) |
| `vehicles[].number` | `number` | Vehicle number | Schedule | high |
| `vehicles[].year` | `number` | Model year | Schedule | high |
| `vehicles[].make` | `string` | Vehicle make | Schedule | high |
| `vehicles[].model` | `string` | Vehicle model | Schedule | high |
| `vehicles[].vin` | `string` | VIN | Schedule | high |
| `vehicles[].cost_new` | `string \| null` | Original cost | Schedule | medium |
| `vehicles[].stated_value` | `string \| null` | Stated/agreed value | Schedule | medium |
| `vehicles[].garage_location` | `number \| null` | Location number where garaged | Schedule | medium |
| `vehicles[].coverages` | `VehicleCoverage[]` | Per-vehicle coverage selections | Schedule | high |
| `vehicles[].radius` | `string \| null` | Operating radius | Schedule | low |
| `vehicles[].vehicle_type` | `string` | Type (private passenger, light truck, heavy truck, etc.) | Schedule | medium |

#### Classification Codes

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `classifications` | `ClassificationCode[]` | Rating classifications | Declarations / rating schedule | high |
| `classifications[].code` | `string` | Class code number | Schedule | high |
| `classifications[].description` | `string` | Class description | Schedule | high |
| `classifications[].premium_basis` | `string` | Basis (payroll, revenue, area, units) | Schedule | high |
| `classifications[].basis_amount` | `string \| null` | Estimated basis amount | Schedule | medium |
| `classifications[].rate` | `string \| null` | Rate per unit of exposure | Schedule | medium |
| `classifications[].premium` | `string \| null` | Calculated premium for this class | Schedule | medium |
| `classifications[].location_number` | `number \| null` | Associated location | Schedule | medium |

### Domain 3: Coverages (Structured)

Richer coverage model than current `{name, limit, deductible}`.

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `coverages` | `EnrichedCoverage[]` | Full coverage details | Declarations + insuring agreement | high |
| `coverages[].name` | `string` | Coverage name | Declarations | high |
| `coverages[].coverage_code` | `string \| null` | Standard coverage code if applicable | Form schedule | medium |
| `coverages[].form_number` | `string \| null` | ISO/carrier form providing this coverage | Form schedule | medium |
| `coverages[].form_edition_date` | `string \| null` | Form edition date | Form schedule | medium |
| `coverages[].limit` | `string` | Coverage limit | Declarations | high |
| `coverages[].limit_type` | `"per_occurrence" \| "per_claim" \| "aggregate" \| "per_person" \| "per_accident" \| "statutory" \| "blanket" \| "scheduled"` | Type of limit | Declarations | high |
| `coverages[].deductible` | `string \| null` | Deductible amount | Declarations | high |
| `coverages[].deductible_type` | `"per_occurrence" \| "per_claim" \| "aggregate" \| "percentage" \| "waiting_period" \| null` | Type of deductible | Declarations | medium |
| `coverages[].sir` | `string \| null` | Self-insured retention | Declarations | medium |
| `coverages[].sublimit` | `string \| null` | Sublimit if applicable | Declarations / endorsement | medium |
| `coverages[].coinsurance` | `string \| null` | Coinsurance percentage (property) | Declarations | medium |
| `coverages[].valuation` | `"replacement_cost" \| "actual_cash_value" \| "agreed_value" \| "functional_replacement" \| null` | Valuation method (property) | Declarations / conditions | medium |
| `coverages[].territory` | `string \| null` | Coverage territory | Insuring agreement | medium |
| `coverages[].trigger` | `"occurrence" \| "claims_made" \| "accident"` | Coverage trigger | Insuring agreement | high |
| `coverages[].retroactive_date` | `string \| null` | Retroactive date (claims-made) | Declarations | high (when applicable) |
| `coverages[].included` | `boolean` | Whether coverage is included or excluded | Declarations | high |
| `coverages[].premium` | `string \| null` | Premium for this coverage | Declarations / premium page | medium |
| `coverages[].page_number` | `number \| null` | Page where found | Declarations | medium |
| `coverages[].section_ref` | `string \| null` | Section cross-reference | Various | low |

### Domain 4: Endorsements (Structured)

Currently endorsements are extracted as generic sections. This creates a dedicated endorsement model.

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `endorsements` | `Endorsement[]` | All endorsements on the policy | Endorsement section | high |
| `endorsements[].form_number` | `string` | Form number (e.g., "CG 20 10") | Endorsement header | high |
| `endorsements[].edition_date` | `string \| null` | Edition date (e.g., "04 13") | Endorsement header | high |
| `endorsements[].title` | `string` | Endorsement title | Endorsement header | high |
| `endorsements[].endorsement_type` | `EndorsementType` | Classification (see enum below) | Analysis of content | high |
| `endorsements[].effective_date` | `string \| null` | Endorsement effective date (if different from policy) | Endorsement | medium |
| `endorsements[].affected_coverage_parts` | `string[]` | Which coverage parts this modifies | Endorsement text | high |
| `endorsements[].named_parties` | `EndorsementParty[]` | Additional insureds, loss payees, etc. | Endorsement schedule | high |
| `endorsements[].key_terms` | `string[]` | Key terms or modifications (brief) | Endorsement text | medium |
| `endorsements[].premium_impact` | `string \| null` | Premium for this endorsement | Endorsement / premium page | low |
| `endorsements[].content` | `string` | Full verbatim text | Endorsement | high |
| `endorsements[].page_start` | `number` | Start page | Endorsement | high |
| `endorsements[].page_end` | `number \| null` | End page | Endorsement | medium |

#### EndorsementType Enum

```typescript
type EndorsementType =
  | "additional_insured"         // Adds additional insured(s)
  | "waiver_of_subrogation"     // Waives transfer of recovery rights
  | "primary_noncontributory"   // Makes coverage primary and non-contributory
  | "blanket_additional_insured" // Blanket AI for all required by contract
  | "loss_payee"                // Adds loss payee
  | "mortgage_holder"           // Adds mortgage holder
  | "broadening"                // Broadens coverage (e.g., broad form property damage)
  | "restriction"               // Restricts or limits coverage
  | "exclusion"                 // Adds exclusion
  | "amendatory"                // Amends policy terms (various)
  | "notice_of_cancellation"    // Cancellation notice to third party
  | "designated_premises"       // Limits coverage to specific premises
  | "classification_change"     // Changes classification or rating
  | "schedule_update"           // Updates a schedule (locations, vehicles, etc.)
  | "deductible_change"         // Modifies deductible
  | "limit_change"              // Modifies limits
  | "territorial_extension"     // Extends territory
  | "other";
```

#### EndorsementParty

```typescript
interface EndorsementParty {
  name: string;
  role: "additional_insured" | "loss_payee" | "mortgage_holder" | "certificate_holder" | "notice_recipient" | "other";
  address?: Address;
  relationship?: string;        // e.g., "As required by written contract"
  scope?: string;               // e.g., "Ongoing operations only" vs "Completed operations"
}
```

### Domain 5: Exclusions (Structured)

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `exclusions` | `Exclusion[]` | All exclusions | Exclusions section + endorsements | high |
| `exclusions[].name` | `string` | Exclusion name/title | Section header | high |
| `exclusions[].form_number` | `string \| null` | Form number if from endorsement | Endorsement header | medium |
| `exclusions[].excluded_perils` | `string[]` | What is excluded | Exclusion text | high |
| `exclusions[].is_absolute` | `boolean` | Whether absolute or has exceptions | Analysis | medium |
| `exclusions[].exceptions` | `string[]` | Exceptions to the exclusion | Exclusion text | medium |
| `exclusions[].buyback_available` | `boolean` | Whether a buyback endorsement exists on this policy | Cross-reference with endorsements | low |
| `exclusions[].buyback_endorsement` | `string \| null` | Form number of buyback if present | Endorsements | low |
| `exclusions[].applies_to` | `string[]` | Which coverage parts affected | Exclusion text | high |
| `exclusions[].content` | `string` | Full verbatim text | Exclusion section | high |
| `exclusions[].page_number` | `number \| null` | Page reference | Section | medium |

### Domain 6: Conditions (Enriched Text with Metadata)

Conditions vary significantly across carriers and lines. Use structured metadata tags on text rather than fully rigid schemas.

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `conditions` | `PolicyCondition[]` | All policy conditions | Conditions section | high |
| `conditions[].name` | `string` | Condition name | Section header | high |
| `conditions[].condition_type` | `ConditionType` | Classification | Analysis | high |
| `conditions[].content` | `string` | Full verbatim text | Section | high |
| `conditions[].key_values` | `Record<string, string>` | Extracted key-value pairs from the condition | Varies | medium |
| `conditions[].page_number` | `number \| null` | Page reference | Section | medium |

#### ConditionType Enum

```typescript
type ConditionType =
  | "duties_after_loss"          // What insured must do after loss
  | "notice_requirements"        // Claim/occurrence notification rules
  | "other_insurance"            // How this policy interacts with other coverage
  | "cancellation"               // Cancellation terms
  | "nonrenewal"                 // Nonrenewal terms
  | "transfer_of_rights"         // Subrogation / assignment
  | "liberalization"             // Automatic broadening clause
  | "arbitration"                // Dispute resolution
  | "concealment_fraud"          // Fraud/misrepresentation
  | "examination_under_oath"     // EUO rights
  | "legal_action"               // Suit limitations
  | "loss_payment"               // How losses are paid
  | "appraisal"                  // Appraisal process
  | "mortgage_holders"           // Mortgage holder conditions
  | "policy_territory"           // Where coverage applies
  | "separation_of_insureds"     // Severability
  | "other";
```

### Domain 7: Parties & Contacts (Structured)

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `insurer` | `InsurerInfo` | Full insurer entity details | Declarations / footer | high |
| `insurer.legal_name` | `string` | Legal entity name | Declarations | high |
| `insurer.naic_number` | `string \| null` | NAIC code | Declarations / footer | medium |
| `insurer.am_best_rating` | `string \| null` | Financial rating | Various | low |
| `insurer.am_best_number` | `string \| null` | AM Best ID | Various | low |
| `insurer.admitted_status` | `string` | admitted/non-admitted/surplus | Declarations | medium |
| `insurer.state_of_domicile` | `string \| null` | Home state | Various | low |
| `producer` | `ProducerInfo` | Broker/agent details | Declarations | high |
| `producer.agency_name` | `string` | Agency name | Declarations | high |
| `producer.contact_name` | `string \| null` | Individual producer | Declarations | medium |
| `producer.license_number` | `string \| null` | License number | Declarations | low |
| `producer.phone` | `string \| null` | Phone | Declarations | medium |
| `producer.email` | `string \| null` | Email | Declarations | low |
| `producer.address` | `Address \| null` | Office address | Declarations | medium |
| `claims_contacts` | `Contact[]` | How to report claims | Conditions / notice page | medium |
| `regulatory_contacts` | `Contact[]` | State DOI, complaint info | Regulatory notices | medium |
| `third_party_administrators` | `Contact[]` | TPAs for claims handling | Declarations / endorsement | low |
| `additional_insureds` | `EndorsementParty[]` | All AIs across all endorsements | Endorsements | high |
| `loss_payees` | `EndorsementParty[]` | All loss payees | Endorsements | high |
| `mortgage_holders` | `EndorsementParty[]` | All mortgage holders | Endorsements | medium |

### Domain 8: Financial (Structured)

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `premium_by_location` | `LocationPremium[]` | Premium allocated per location | Premium page / schedule | medium |
| `premium_by_coverage` | `PremiumLine[]` | Premium by coverage (existing, enriched) | Declarations | high |
| `taxes` | `TaxFeeItem[]` | Tax line items | Billing page | medium |
| `fees` | `TaxFeeItem[]` | Fee line items | Billing page | medium |
| `surcharges` | `TaxFeeItem[]` | Surcharge line items | Billing page | medium |
| `payment_schedule` | `PaymentInstallment[]` | Installment dates and amounts | Billing page | low |
| `finance_charge` | `string \| null` | Finance charge if financed | Billing page | low |
| `minimum_earned_premium` | `string \| null` | Min earned premium provision | Conditions / dec | medium |
| `commission_rate` | `string \| null` | Producer commission rate | Rarely disclosed | low |

### Domain 9: Underwriting (Quote-Specific)

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `subjectivities` | `EnrichedSubjectivity[]` | Conditions before binding | Quote / subjectivity page | high |
| `subjectivities[].description` | `string` | Subjectivity text | Quote | high |
| `subjectivities[].category` | `"pre_binding" \| "post_binding" \| "information"` | When it must be satisfied | Quote | high |
| `subjectivities[].due_date` | `string \| null` | Deadline if specified | Quote | medium |
| `subjectivities[].status` | `"open" \| "satisfied" \| "waived" \| null` | Current status | — | — |
| `underwriting_conditions` | `UnderwritingCondition[]` | Conditions of the quote | Quote | high |
| `underwriting_conditions[].description` | `string` | Condition text | Quote | high |
| `underwriting_conditions[].category` | `string \| null` | Category if specified | Quote | low |
| `warranty_requirements` | `string[]` | Warranties required | Quote | medium |
| `loss_control_recommendations` | `string[]` | LC recommendations | Quote | low |
| `binding_authority` | `BindingAuthority \| null` | Who can bind and how | Quote | medium |
| `quote_valid_until` | `string \| null` | Quote expiration date | Quote | high |
| `proposed_effective_date` | `string \| null` | Proposed inception | Quote | high |
| `proposed_expiration_date` | `string \| null` | Proposed expiry | Quote | high |

### Domain 10: Loss History & Claims

| Field | Type | Description | Source | Reliability |
|-------|------|-------------|--------|-------------|
| `loss_summary` | `LossSummary \| null` | Aggregate loss history | Loss runs / experience page | medium |
| `loss_summary.period` | `string` | Period covered (e.g., "5 years") | Loss runs | medium |
| `loss_summary.total_claims` | `number \| null` | Total claim count | Loss runs | medium |
| `loss_summary.total_incurred` | `string \| null` | Total incurred | Loss runs | medium |
| `loss_summary.total_paid` | `string \| null` | Total paid | Loss runs | medium |
| `loss_summary.total_reserved` | `string \| null` | Total reserves | Loss runs | medium |
| `loss_summary.loss_ratio` | `string \| null` | Loss ratio | Experience page | low |
| `individual_claims` | `ClaimRecord[]` | Individual claim records | Loss runs | medium |
| `individual_claims[].date_of_loss` | `string` | Date of loss | Loss runs | high |
| `individual_claims[].claim_number` | `string \| null` | Claim number | Loss runs | high |
| `individual_claims[].description` | `string` | Description | Loss runs | high |
| `individual_claims[].status` | `"open" \| "closed" \| "reopened"` | Status | Loss runs | high |
| `individual_claims[].paid` | `string \| null` | Amount paid | Loss runs | high |
| `individual_claims[].reserved` | `string \| null` | Reserves | Loss runs | high |
| `individual_claims[].incurred` | `string \| null` | Total incurred | Loss runs | high |
| `individual_claims[].claimant` | `string \| null` | Claimant name | Loss runs | medium |
| `individual_claims[].coverage_line` | `string \| null` | Which coverage | Loss runs | medium |
| `experience_modification` | `ExperienceMod \| null` | WC experience mod | Declarations (WC) | high (WC) |
| `experience_modification.factor` | `number` | Mod factor (e.g., 0.85) | Declarations | high |
| `experience_modification.effective_date` | `string` | Mod effective date | Mod worksheet | medium |
| `experience_modification.state` | `string` | State | Mod worksheet | medium |

### Domain 11: Business Context Storage

Maps extracted policy data → reusable business context keys for application auto-fill. This is the bridge between extraction and the application processing system.

#### Context Categories

| Category | Description | Source |
|----------|-------------|--------|
| `company_info` | Legal name, DBA, address, entity type, FEIN, website | Named insured data |
| `operations` | Description of operations, SIC/NAICS, employee count, revenue | Classifications + dec page |
| `financial` | Revenue, payroll, assets, property values | Rating basis + schedules |
| `coverage` | Current coverage types, limits, deductibles, carriers | Coverage data |
| `loss_history` | Claims history, experience mod, loss runs | Loss history domain |
| `premises` | Locations, building details, construction, occupancy | Location schedules |
| `vehicles` | Vehicle schedules, fleet details | Vehicle schedules |
| `employees` | Employee count by class, payroll by state | WC classifications |

#### Auto-Fill Key Mappings

Each extracted field with a `context_key` in the data dictionary can be stored as reusable business context. When processing applications:

1. Extract policy data using the enriched pipeline
2. Map extracted fields to business context keys
3. Store in context storage (Prism `update_business_context`)
4. When auto-filling applications, match context keys to application field IDs
5. Cite source: "from [Carrier] [PolicyType] Policy #[Number]"

Key mappings (selected examples):
- `insured_name` → `company_name`
- `insured_address` → `company_address`
- `insured_fein` → `fein`
- `insured_entity_type` → `entity_type`
- `locations[0].address` → `primary_location`
- `experience_modifier.factor` → `experience_mod`
- `total_premium` → context for "current premium" questions
- `coverages[].limit` → context for "current limits" questions

### Shared Types (Referenced Across Domains)

```typescript
interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

interface Contact {
  name?: string;
  title?: string;
  type?: string;          // "Claims", "State DOI", "Carrier", etc.
  phone?: string;
  fax?: string;
  email?: string;
  address?: Address;
  hours?: string;
}

interface FormReference {
  form_number: string;    // e.g., "CG 00 01"
  edition_date?: string;  // e.g., "04 13"
  title?: string;         // e.g., "Commercial General Liability Coverage Form"
  form_type: "coverage" | "endorsement" | "declarations" | "application" | "notice" | "other";
}

interface TaxFeeItem {
  name: string;
  amount: string;
  type?: "tax" | "fee" | "surcharge" | "assessment";
  description?: string;
}

interface PaymentInstallment {
  due_date: string;
  amount: string;
  description?: string;
}

interface RatingBasis {
  type: "payroll" | "revenue" | "area" | "units" | "vehicle_count" | "employee_count" | "per_capita" | "other";
  amount?: string;
  description?: string;
}

interface Sublimit {
  name: string;
  limit: string;
  applies_to?: string;
  deductible?: string;
}

interface SharedLimit {
  description: string;
  limit: string;
  coverage_parts: string[];
}

interface ExtendedReportingPeriod {
  basic_days?: number;        // Automatic mini-tail (usually 60 days)
  supplemental_years?: number; // Optional purchased tail
  supplemental_premium?: string;
}

interface EmployersLiabilityLimits {
  each_accident: string;
  disease_policy_limit: string;
  disease_each_employee: string;
}

interface VehicleCoverage {
  type: "liability" | "collision" | "comprehensive" | "uninsured_motorist" | "underinsured_motorist" | "medical_payments" | "hired_auto" | "non_owned_auto" | "cargo" | "physical_damage";
  limit?: string;
  deductible?: string;
  included: boolean;
}

interface BindingAuthority {
  authorized_by?: string;
  method?: string;              // "Written confirmation required"
  expiration?: string;
  conditions?: string[];
}

interface NamedInsured {
  name: string;
  relationship?: string;       // "Subsidiary", "Affiliate", etc.
  address?: Address;
}
```

### PolicyType Enum (Expanded from Current 11 to 20)

```typescript
type PolicyType =
  // Commercial Package Lines
  | "general_liability"
  | "commercial_property"
  | "commercial_auto"
  | "non_owned_auto"
  | "workers_comp"
  | "umbrella"
  | "excess_liability"
  // Professional & Management Lines
  | "professional_liability"
  | "cyber"
  | "epli"
  | "directors_officers"
  | "fiduciary_liability"
  // Specialty Lines
  | "crime_fidelity"
  | "inland_marine"
  | "builders_risk"
  | "environmental"
  | "ocean_marine"
  | "surety"
  | "product_liability"
  // Packaged
  | "bop"                        // Business Owners Policy
  | "management_liability_package"
  | "other";
```

---

## Deliverable 2: Form Structure Guide

### Part 1: General Structural Patterns

#### Policy Package Composition

```
Commercial Package Policy (CPP)
├── Common Policy Declarations (IL DS 00 09 or similar)
│   ├── Named Insured, Address, Policy Period
│   ├── Business Description
│   └── Forms Schedule (lists ALL forms in the package)
│
├── Coverage Part: Commercial General Liability
│   ├── CGL Declarations Page
│   ├── Coverage Form (CG 00 01 or CG 00 02)
│   │   ├── Section I — Coverages
│   │   │   ├── Coverage A — Bodily Injury & Property Damage
│   │   │   ├── Coverage B — Personal & Advertising Injury
│   │   │   └── Coverage C — Medical Payments
│   │   ├── Section II — Who Is An Insured
│   │   ├── Section III — Limits of Insurance
│   │   ├── Section IV — Conditions
│   │   └── Section V — Definitions
│   └── GL Endorsements (in schedule order)
│
├── Coverage Part: Commercial Property
│   ├── Property Declarations Page
│   ├── Building & Personal Property Coverage Form (CP 00 10)
│   │   ├── Coverage (what's covered, what's not)
│   │   ├── Additional Coverages
│   │   ├── Coverage Extensions
│   │   ├── Exclusions
│   │   ├── Limits of Insurance
│   │   ├── Deductible
│   │   ├── Loss Conditions
│   │   ├── Additional Conditions
│   │   └── Definitions
│   ├── Causes of Loss Form (CP 10 10 Basic / CP 10 20 Broad / CP 10 30 Special)
│   └── Property Endorsements
│
├── Coverage Part: Commercial Auto
│   ├── Auto Declarations Page
│   ├── Business Auto Coverage Form (CA 00 01)
│   │   ├── Section I — Covered Autos
│   │   ├── Section II — Liability Coverage
│   │   ├── Section III — Physical Damage Coverage
│   │   ├── Section IV — Business Auto Conditions
│   │   └── Section V — Definitions
│   ├── Vehicle Schedule
│   └── Auto Endorsements
│
├── Common Policy Conditions (IL 00 17)
├── Nuclear Energy Liability Exclusion (IL 00 21)
└── Terrorism Risk Insurance Act Disclosure
```

#### Monoline Policy Structure (Non-Package)

```
Standalone Policy
├── Declarations Page
│   ├── Policy period, insured, premium
│   ├── Limits schedule
│   └── Forms schedule
├── Coverage Form
│   ├── Insuring Agreement(s)
│   ├── Exclusions
│   ├── Conditions
│   └── Definitions
├── Endorsement Schedule
├── Endorsements (each self-contained)
├── Application (attached)
└── Notices
```

#### Quote / Proposal Structure

```
Quote/Proposal
├── Cover Letter / Transmittal
│   ├── Broker/agent info, quote reference number
│   └── Expiration date of quote
├── Executive Summary
│   ├── Named insured, proposed period
│   └── High-level terms
├── Coverage Summary / Terms
│   ├── Proposed coverages with limits
│   ├── Deductibles / retentions
│   └── Coverage forms and endorsements proposed
├── Premium Indication
│   ├── Premium by line/coverage
│   ├── Taxes and fees
│   └── Total premium
├── Subjectivities
│   ├── Pre-binding requirements
│   ├── Post-binding requirements
│   └── Information needed
├── Underwriting Conditions
│   └── Warranties, conditions, requirements
├── Specimen Forms (sometimes)
│   └── Copies of forms that would be used
└── Signature / Authorization Page
```

#### Key Structural Signals for Extraction

| Signal | Meaning | Action |
|--------|---------|--------|
| Form number in header/footer (e.g., "CG 00 01 04 13") | New form boundary | Start new section/endorsement |
| "THIS ENDORSEMENT CHANGES THE POLICY" | Endorsement start | Extract as endorsement |
| "DECLARATIONS" in page header | Declarations page | Extract declarations fields |
| Page numbering resets to 1 | New form begins | Section boundary |
| Coverage part name in header (e.g., "COMMERCIAL GENERAL LIABILITY") | Coverage part boundary | Group sections under coverage part |
| "SCHEDULE" header with table | Structured schedule data | Extract as table/records |
| "ENDORSEMENT SCHEDULE" / "FORMS AND ENDORSEMENTS" | Forms listing | Extract form inventory |
| "SECTION I", "SECTION II", etc. | Major section within form | Subsection boundary |
| "EXCLUSIONS" as header | Exclusions section | Extract exclusions |
| "CONDITIONS" as header | Conditions section | Extract conditions |
| "DEFINITIONS" as header | Definitions section | Lower extraction priority |

### Part 2: Intelligent Chunking Strategies

#### Current Approach (Baseline)
- Fixed 15-page chunks
- Adaptive fallback: 15 → 10 → 5 pages
- No awareness of document structure

#### Proposed: Structure-Aware Chunking

**Phase 1: Pre-scan (before extraction)**
1. Scan all pages for structural signals:
   - Form numbers in headers/footers
   - Section headers (DECLARATIONS, INSURING AGREEMENT, etc.)
   - "THIS ENDORSEMENT CHANGES THE POLICY" markers
   - Page number resets
   - Table boundaries (SCHEDULE headers)
2. Build a document map: `[{type, pageStart, pageEnd, formNumber?}]`

**Phase 2: Chunk by structure**
1. **If form numbers detected** → chunk at form boundaries
   - Each form = one chunk (unless > 20 pages, then split at section boundaries within form)
   - Endorsements: each endorsement = one chunk (typically 1-3 pages)
   - Declarations: always own chunk
2. **If section headers detected but no form numbers** → chunk at major section boundaries
   - Never split a section across chunks
   - Keep related sections together (e.g., insuring agreement + exclusions)
3. **If tables detected** → never split mid-table
   - If table spans chunk boundary, extend chunk to include full table
4. **Fallback** → current page-based chunking (15 → 10 → 5)

**Phase 3: Chunk metadata**
Each chunk carries metadata:
```typescript
interface ExtractionChunk {
  pages: number[];              // Page numbers in this chunk
  chunk_type: "declarations" | "coverage_form" | "endorsement" | "schedule" | "conditions" | "mixed";
  form_number?: string;         // If this chunk is a specific form
  coverage_part?: string;       // Which coverage part this belongs to
  context_hint?: string;        // E.g., "This is the CGL Coverage Form"
}
```

#### Chunking by Document Type

| Document Type | Primary Strategy | Chunk Size Target | Notes |
|---------------|-----------------|-------------------|-------|
| Package Policy (50-200 pages) | Form-boundary | One form per chunk | Dec pages separate, endorsements individual |
| Monoline Policy (10-50 pages) | Section-boundary | One section per chunk | May be few enough for single chunk |
| Quote/Proposal (5-20 pages) | Section-boundary | One section per chunk | Usually fits in 1-2 chunks |
| Endorsement-only (1-5 pages) | No chunking | Entire document | Always process whole |
| Certificate (1-2 pages) | No chunking | Entire document | Standardized format |

### Part 3: ISO/ACORD Form Catalog

#### General Liability Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **CG 00 01** | Commercial General Liability Coverage Form (Occurrence) | Coverage A (BI/PD), B (P&AI), C (Medical), exclusions, conditions, definitions | 16-20 |
| **CG 00 02** | Commercial General Liability Coverage Form (Claims-Made) | Same as CG 00 01 but claims-made trigger, includes retroactive date | 18-22 |
| **CG DS 01** | Commercial General Liability Declarations | Limits, policy period, classification, premium | 1-2 |
| **CG 20 10** | AI — Owners, Lessees or Contractors — Scheduled Person or Org | Adds scheduled AI for ongoing operations | 1 |
| **CG 20 26** | AI — Designated Person or Organization | Adds named AI | 1 |
| **CG 20 33** | AI — Owners, Lessees or Contractors — Automatic | Blanket AI for ongoing operations per written contract | 1 |
| **CG 20 37** | AI — Owners, Lessees or Contractors — Completed Operations | Adds AI for completed operations | 1 |
| **CG 20 38** | AI — Managers or Lessors of Premises | AI for premises manager/lessor | 1 |
| **CG 24 04** | Waiver of Transfer of Rights of Recovery Against Others | Waiver of subrogation | 1 |
| **CG 24 17** | Contractual Liability — Railroads | Extends contractual to railroad operations | 1 |
| **CG 25 03** | Designated Construction Project(s) General Aggregate Limit | Project-specific aggregate | 1 |
| **CG 25 04** | Designated Location(s) General Aggregate Limit | Location-specific aggregate | 1 |

#### Commercial Property Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **CP 00 10** | Building and Personal Property Coverage Form | Covered property, additional coverages, extensions, exclusions, conditions | 12-16 |
| **CP 00 30** | Business Income (and Extra Expense) Coverage Form | BI + EE coverage, period of restoration | 8-10 |
| **CP 00 32** | Business Income (Without Extra Expense) | BI only | 6-8 |
| **CP 00 40** | Legal Liability Coverage Form | Damage to property of others in care/custody | 6-8 |
| **CP 10 10** | Causes of Loss — Basic Form | Fire, lightning, explosion, etc. | 4-6 |
| **CP 10 20** | Causes of Loss — Broad Form | Basic + collapse, falling objects, water damage, etc. | 6-8 |
| **CP 10 30** | Causes of Loss — Special Form | All risk (open perils) with named exclusions | 10-14 |
| **CP DS 01** | Commercial Property Declarations | Location schedule, coverage amounts, coinsurance | 1-3 |
| **CP 12 18** | Loss Payable Provisions | Loss payee conditions | 2-3 |
| **CP 04 02** | Ordinance or Law Coverage | Building code upgrade coverage | 2 |
| **CP 15 08** | Equipment Breakdown | Equipment breakdown coverage | varies |

#### Commercial Auto Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **CA 00 01** | Business Auto Coverage Form | Liability, physical damage, UM/UIM, conditions | 10-14 |
| **CA DS 03** | Business Auto Declarations | Vehicle schedule, coverages, limits | 2-4 |
| **CA 20 48** | Designated Insured | Extends insured status | 1 |
| **CA 99 10** | Auto Dealers Supplement | Dealer-specific coverage | varies |
| **CA 04 44** | Hired Auto Physical Damage | PD for hired vehicles | 1 |

#### Workers' Compensation Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **WC 00 00** | Workers' Compensation and Employers' Liability | Part One (WC), Part Two (EL), Part Three (Other States), Conditions | 8-12 |
| **WC 00 01** | WC Declarations | States, class codes, payroll, rates, premium | 2-4 |
| **WC 00 03** | Information Page | Experience mod, payroll detail | 1-2 |
| **WC 00 04** | Workers' Compensation and Employers' Liability Endorsement | Various state-specific endorsements | varies |

#### Umbrella / Excess Forms

| Form Number | Title | Key Content |
|-------------|-------|-------------|
| Carrier-specific | Umbrella/Excess Liability Coverage Form | Following form or self-contained, schedule of underlying, drop-down provisions |
| Carrier-specific | Umbrella Declarations | Per occurrence, aggregate, retention, underlying schedule |

Note: Umbrella/excess forms are predominantly carrier-proprietary (not ISO standardized).

#### Professional / Management Liability Forms

These lines are almost entirely carrier-proprietary. No standard ISO forms exist. Key structural patterns:

| Line | Common Structure |
|------|-----------------|
| **Professional Liability / E&O** | Claims-made, insuring agreement + exclusions + conditions, definition of "professional services", defense cost inside/outside limits |
| **Cyber** | First-party (data breach response, business interruption, extortion) + third-party (liability, regulatory), sublimit structure, waiting periods |
| **D&O** | Side A (individual directors), Side B (corporate reimbursement), Side C (entity coverage), insured vs insured exclusion |
| **EPLI** | Claims-made, defense cost treatment, definition of "employment practices wrongful act", third-party coverage option |
| **Fiduciary** | Claims-made, coverage for breach of ERISA duties, voluntary correction program |
| **Crime/Fidelity** | Named perils (employee theft, forgery, computer fraud, funds transfer fraud, social engineering), per-loss vs aggregate |

#### ACORD Forms (Certificates & Applications)

| Form Number | Title | Purpose |
|-------------|-------|---------|
| **ACORD 25** | Certificate of Liability Insurance | Proof of GL, auto, umbrella, WC coverage |
| **ACORD 27** | Evidence of Property Insurance | Proof of property coverage |
| **ACORD 28** | Evidence of Commercial Property Insurance | Detailed property evidence |
| **ACORD 101** | Additional Remarks Schedule | Overflow/additional info |
| **ACORD 125** | Commercial Insurance Application | General business info for all commercial lines |
| **ACORD 126** | Commercial General Liability Section | GL-specific application questions |
| **ACORD 127** | Cyber Liability Coverage Section | Cyber-specific application |
| **ACORD 130** | Workers Compensation Application | WC-specific questions |
| **ACORD 131** | Umbrella/Excess Application | Umbrella-specific questions |
| **ACORD 137** | Commercial Auto Section | Auto-specific questions |
| **ACORD 140** | Property Section | Property-specific questions |

---

## Deliverable 3: Line-of-Business Profiles

### Profile 1: General Liability (GL)

#### Overview
Covers bodily injury (BI) and property damage (PD) liability arising from business operations, products, and completed work. The most common commercial liability coverage. Usually written as part of a Commercial Package Policy (CPP) but can be monoline.

#### Key Forms
- **CG 00 01** (Occurrence) or **CG 00 02** (Claims-Made) — primary coverage form
- **CG DS 01** — declarations
- Common endorsements: CG 20 10/26/33/37 (additional insured), CG 24 04 (waiver of subrogation), CG 25 03/04 (project/location aggregate)

#### Declarations Fields
- Per occurrence limit
- General aggregate limit
- Products/completed operations aggregate
- Personal & advertising injury limit
- Damage to premises rented to you
- Medical expense limit
- Classification codes with premium basis (payroll or revenue)
- Retroactive date (CG 00 02 only)

#### Coverage Structure
- **Coverage A**: BI & PD liability — occurrence trigger (CG 00 01) or claims-made (CG 00 02)
- **Coverage B**: Personal & advertising injury — offense trigger
- **Coverage C**: Medical payments — accident trigger, regardless of fault
- **Defense**: Supplementary payments (outside limits) — duty to defend
- **Territory**: Typically US, territories, possessions, Canada; products worldwide

#### Common Endorsements (by type)
- **Additional Insured**: CG 20 10, CG 20 26, CG 20 33, CG 20 37, CG 20 38
- **Waiver of Subrogation**: CG 24 04
- **Primary/Noncontributory**: CG 20 01 or carrier-specific
- **Exclusions**: CG 21 06 (Access or Disclosure), CG 21 39 (Contractual — Specifically Designated), CG 21 67 (Fungi/Bacteria)
- **Broadening**: CG 04 26 (Amendment of Insured Contract Definition), CG 24 17 (Contractual — Railroads)
- **Aggregate Management**: CG 25 03 (Project Aggregate), CG 25 04 (Location Aggregate)

#### Standard Exclusions (Base Form)
Expected BI/PD, contractual liability (with exceptions), liquor liability, workers comp & employers liability, pollution, aircraft/auto/watercraft, mobile equipment, war, professional services, recall

#### Extraction Notes
- GL declarations are typically 1-2 pages; limits are in a standard table format
- Classification codes table: code | description | premium basis | est. basis | rate | premium
- Additional insured endorsements may be "blanket" (per written contract) or scheduled with specific names
- Look for "THIS ENDORSEMENT CHANGES THE POLICY" to detect each endorsement boundary
- Carrier-specific GL forms (non-ISO) follow similar structure but may have different section numbering

#### Business Context Mapping
- `classifications[].description` → `description_of_operations`
- `locations[].address` → `premises_addresses`
- `classifications[].basis_amount` (payroll) → `annual_payroll`
- `classifications[].basis_amount` (revenue) → `annual_revenue`

---

### Profile 2: Commercial Property

#### Overview
Covers damage to buildings, business personal property, and business income from covered causes of loss. Valuation method (replacement cost vs ACV) and causes of loss form (basic/broad/special) are critical distinctions.

#### Key Forms
- **CP 00 10** — Building and Personal Property Coverage Form
- **CP 00 30** — Business Income and Extra Expense
- **CP 10 30** — Causes of Loss — Special Form (most common)
- **CP DS 01** — declarations with location schedule

#### Declarations Fields
- Location schedule (building value, BPP value, BI limit per location)
- Causes of loss form (basic/broad/special)
- Coinsurance percentage (80%, 90%, 100%)
- Valuation method per location
- Deductible (flat or percentage)
- Optional coverages (business income, extra expense, ordinance or law)

#### Coverage Structure
- **Building**: Structure, fixtures, outdoor fixtures, personal property used to maintain building
- **Business Personal Property**: Furniture, equipment, stock, tenant improvements
- **Business Income**: Lost net income + continuing expenses during restoration period
- **Extra Expense**: Additional costs to avoid/minimize suspension
- **Additional Coverages**: Debris removal, preservation of property, fire dept service charge, pollutant cleanup
- **Extensions**: Newly acquired property, personal effects, valuable papers, outdoor property

#### Common Endorsements
- **CP 04 02** — Ordinance or Law Coverage (building code upgrade)
- **CP 12 18** — Loss Payable Provisions (loss payee, mortgage holder)
- **CP 15 08** — Equipment Breakdown
- **CP 01 40** — Protective Safeguards (sprinkler, alarm requirements)
- **CP 10 32** — Water Exclusion (flood exclusion modification)
- Agreed Value endorsement (waives coinsurance)

#### Extraction Notes
- Location schedule is a critical table: location # | address | building value | BPP value | coinsurance | BI limit
- Property declarations can be multiple pages for multi-location risks
- Causes of loss form (basic/broad/special) determines scope — always identify which
- Coinsurance percentage matters for claim settlement — always extract
- Valuation method (RC vs ACV) significantly affects coverage — always extract

#### Business Context Mapping
- `locations[].building_value` → `total_property_values`
- `locations[].contents_value` → `total_contents_values`
- `locations[].construction_type` → `construction_type`
- `locations[].year_built` → `year_built`
- `locations[].sprinklered` → `sprinkler_system`

---

### Profile 3: Commercial Auto

#### Overview
Covers liability and physical damage for business-owned, hired, and non-owned vehicles. Symbol system determines which vehicles are covered.

#### Key Forms
- **CA 00 01** — Business Auto Coverage Form
- **CA DS 03** — declarations with vehicle schedule

#### Declarations Fields
- Covered auto symbols (1-19 designating which vehicles)
- Vehicle schedule (year, make, model, VIN, cost new, coverages per vehicle)
- CSL or split limits
- Physical damage deductibles (collision, comprehensive)
- UM/UIM limits
- Hired auto / non-owned auto coverage

#### Coverage Structure
- **Section I — Covered Autos**: Symbol system (1=Any Auto, 2=Owned, 7=Specifically Described, 8=Hired, 9=Non-Owned)
- **Section II — Liability**: CSL or split BI/PD limits
- **Section III — Physical Damage**: Comprehensive, collision, specified causes of loss
- **Section IV — Conditions**: Duties after accident, cooperation, other insurance
- **Hired/Non-Owned**: May be separate endorsement or included by symbol

#### Common Endorsements
- **CA 20 48** — Designated Insured
- **CA 04 44** — Hired Auto Physical Damage
- **MCS-90** — Motor Carrier (for-hire trucking)
- Additional insured endorsements
- Drive other car coverage

#### Extraction Notes
- Vehicle schedule is a key table: vehicle # | year | make | model | VIN | cost new | coverages
- Symbol assignments determine breadth of coverage — critical to extract
- For-hire/commercial trucking has MCS-90 endorsement (federally mandated)
- Non-owned auto coverage may be in GL or auto policy — cross-reference

#### Business Context Mapping
- `vehicles[].count` → `vehicle_count`
- `vehicles[].type` distribution → `fleet_composition`

---

### Profile 4: Workers' Compensation

#### Overview
Statutory coverage for employee work injuries. Part One provides WC benefits per state statute. Part Two provides employers' liability. Highly regulated by state.

#### Key Forms
- **WC 00 00** — Workers' Compensation and Employers' Liability Insurance Policy
- **WC 00 01** — Information Page (declarations)
- State-specific endorsements (monopolistic states, state fund requirements)

#### Declarations Fields
- States covered (Part Three — other states)
- Classification codes with payroll amounts and rates
- Experience modification factor
- Employers' liability limits (each accident, disease-policy, disease-each employee)
- Premium discount
- Premium basis (estimated annual payroll by class)

#### Coverage Structure
- **Part One — Workers' Compensation**: Statutory benefits as required by state law
- **Part Two — Employers' Liability**: Bodily injury by accident (each accident limit), bodily injury by disease (policy limit, each employee limit)
- **Part Three — Other States Insurance**: Coverage if employee injured in state not listed in Part One
- **Defense**: Included in addition to limits

#### Common Endorsements
- Experience modification endorsement
- Waiver of our right to recover from others (WC 00 03 13)
- Alternate employer endorsement
- Voluntary compensation endorsement
- State-specific mandatory endorsements (CA, NY, etc.)
- Broad form all states endorsement

#### Extraction Notes
- Classification table: state | class code | description | payroll | rate | premium — critical for extraction
- Experience mod is typically shown on information page or separate mod worksheet
- Multiple states = multiple class code tables
- Monopolistic states (OH, WA, WY, ND) have state-fund only — different structure
- USL&H (maritime workers) and FELA (railroad) may have separate endorsements

#### Business Context Mapping
- `classifications[].basis_amount` (payroll by state) → `annual_payroll_by_state`
- `experience_modification.factor` → `experience_mod`
- Employee count derivable from classification data → `employee_count`

---

### Profile 5: Commercial Umbrella / Excess

#### Overview
Provides limits above underlying primary policies. Umbrella may "drop down" when underlying doesn't cover; excess is purely follow-form above underlying. Almost entirely carrier-proprietary forms.

#### Key Forms
- Carrier-proprietary coverage form (not ISO standardized)
- Declarations with schedule of underlying insurance

#### Declarations Fields
- Each occurrence limit
- Aggregate limit
- Self-insured retention (SIR) amount
- Schedule of underlying insurance (policy numbers, carriers, limits for each underlying)
- Drop-down provisions (if umbrella)

#### Coverage Structure
- **Following Form**: Follows underlying policy terms (most excess)
- **Self-Contained**: Own insuring agreement, exclusions, conditions (most umbrella)
- **Drop-Down**: Covers claims not covered by underlying but covered by umbrella
- **SIR**: Applies when underlying doesn't respond (no underlying coverage for the claim type)

#### Extraction Notes
- Schedule of underlying is the most critical table: underlying policy | carrier | type | limits
- SIR vs deductible distinction matters
- "Follow form" vs "self-contained" determines which exclusions apply
- Aggregate may apply differently (per occurrence only vs annual aggregate)

#### Business Context Mapping
- `limits.each_occurrence_umbrella` → `umbrella_limit`
- `underlying_schedule` → cross-reference with primary policies

---

### Profile 6: Professional Liability / E&O

#### Overview
Claims-made coverage for liability arising from professional services, errors, or omissions. Carrier-proprietary forms. Critical: retroactive date, definition of "professional services", defense cost treatment.

#### Declarations Fields
- Per claim limit, aggregate limit
- Retroactive date
- Deductible or SIR (per claim)
- Defense cost treatment (inside/outside limits)
- Extended reporting period options
- Definition of insured (individual practitioners, firm, employees)

#### Extraction Notes
- Always claims-made — retroactive date is critical
- Defense inside limits is common (erodes limit) — important distinction
- "Professional services" definition varies significantly by carrier — extract verbatim
- ERP (tail) options and pricing often in declarations or endorsement

---

### Profile 7: Cyber Liability

#### Overview
Covers first-party data breach costs and third-party liability from cyber events. One of the fastest-evolving lines. All carrier-proprietary forms.

#### Declarations Fields
- Per claim / per incident limit
- Aggregate limit
- Retroactive date
- Deductible per claim
- Waiting period (for BI coverage)
- Sublimits by coverage section (breach response, ransomware, BI, etc.)
- Coverage territory (often worldwide)

#### Coverage Structure (Typical)
- **First Party**: Data breach response costs, notification costs, credit monitoring, forensic investigation, data restoration, business interruption, cyber extortion/ransomware, reputational harm, voluntary shutdown
- **Third Party**: Privacy liability, security liability, regulatory defense/penalties, media liability, PCI-DSS fines and assessments
- **Sublimits**: Common for ransomware, social engineering, bricking, voluntary shutdown, PCI fines

#### Extraction Notes
- Sublimit structure is critical — often 10+ named sublimits
- Waiting period for BI (6-12 hours typical) — extract as distinct field
- Social engineering / funds transfer fraud may be in cyber or crime policy — note which
- "War exclusion" language varies significantly and is heavily debated
- Retroactive date + claims-made — always extract

---

### Profile 8: Employment Practices Liability (EPLI)

#### Declarations Fields
- Per claim / per employee limit
- Aggregate limit
- Retroactive date
- Deductible (per claim, may vary by claim type)
- Defense cost treatment
- Third-party coverage (harassment by non-employees) — optional

#### Extraction Notes
- Claims-made trigger — retroactive date critical
- Definition of "employment practices wrongful act" varies — extract
- Wage & hour coverage often excluded or sublimited — note status
- Third-party coverage is frequently an endorsement add-on

---

### Profile 9: Directors & Officers (D&O)

#### Declarations Fields
- Limit of liability (per claim and aggregate)
- Retention/deductible (Side A: typically none, Side B: yes, Side C: yes)
- Retroactive date
- Coverage sides (A, B, C, sometimes D for derivative investigation)

#### Coverage Structure
- **Side A**: Individual directors/officers when company can't indemnify
- **Side B**: Reimburses company for indemnifying directors/officers
- **Side C**: Entity coverage for securities claims
- **Side D** (some): Derivative investigation costs

#### Extraction Notes
- Side A often has no retention — important distinction
- "Insured vs insured" exclusion varies in scope — extract
- Securities claims vs non-securities claims may have different retentions
- Continuity date (similar to retroactive date) — extract

---

### Profile 10: Fiduciary Liability

#### Declarations Fields
- Limit per claim, aggregate
- Retroactive date
- Deductible
- Coverage for ERISA plans

#### Extraction Notes
- Covers breach of fiduciary duty under ERISA
- Voluntary correction program coverage
- Relatively straightforward extraction — smaller form

---

### Profile 11: Crime / Fidelity

#### Declarations Fields
- Per loss / per occurrence limits by insuring agreement
- Deductible by insuring agreement
- Retroactive date (discovery form vs loss-sustained form)

#### Coverage Structure (Named Perils)
- **Insuring Agreement A**: Employee Theft
- **Insuring Agreement B**: Forgery or Alteration
- **Insuring Agreement C**: Inside the Premises (Theft of Money/Securities)
- **Insuring Agreement D**: Outside the Premises
- **Insuring Agreement E**: Computer and Funds Transfer Fraud
- **Insuring Agreement F**: Money Orders and Counterfeit Money
- **Additional**: Social Engineering, Client Coverage, ERISA Fidelity

#### Extraction Notes
- Each insuring agreement has its own limit and deductible — extract per-agreement
- Social engineering coverage increasingly common — often sublimited
- Discovery vs loss-sustained form affects retroactive date handling

---

### Profile 12: Inland Marine / Equipment

#### Declarations Fields
- Scheduled equipment/property with values
- Blanket limit (if applicable)
- Deductible
- Valuation (replacement cost, ACV, agreed value)

#### Extraction Notes
- Highly customized per risk — equipment schedule is the key data
- Contractor's equipment floater is most common type
- May include installation floater, builder's risk, electronic data processing

---

### Profile 13: Builders Risk

#### Declarations Fields
- Project description and address
- Completed value / soft costs limit
- Policy period (project-specific or annual)
- Covered causes of loss
- Named insureds (owner, GC, subs)

#### Extraction Notes
- Project-specific or annual reporting form
- Completed value is key limit
- Soft costs coverage (financing, permits, professional fees during delay)
- Testing coverage and LEG (London Engineering Group) clauses for design defect

---

### Profile 14: Environmental / Pollution

#### Declarations Fields
- Per pollution event limit
- Aggregate limit
- Retroactive date
- Covered locations/sites
- Coverage grants (cleanup costs, third-party liability, transportation, non-owned disposal sites)

#### Extraction Notes
- Claims-made or pollution-event trigger
- Site-specific vs blanket coverage
- Remediation cost cap vs defense outside limits
- Mold coverage may be environmental or property

---

### Profile 15: Ocean Marine / Cargo

#### Declarations Fields
- Hull value
- Cargo limits
- P&I limits
- Deductible
- Trading area
- Conveyance types

#### Extraction Notes
- Unique terminology (average, salvage, general average, particular average)
- Often London market forms (MAR, Institute Cargo Clauses)
- War risks and strikes typically separate

---

### Profile 16: Surety Bonds

#### Overview
Not insurance — a three-party guarantee (principal, obligee, surety). Very different document structure.

#### Key Fields
- Bond type (bid, performance, payment, license, court, fidelity)
- Bond amount (penal sum)
- Principal, obligee, surety names
- Effective date, expiration (or continuous)
- Underlying contract reference

#### Extraction Notes
- Structure completely different from insurance policies
- Typically 1-5 pages per bond
- No coverages/limits/deductibles — just penal sum and conditions

---

### Profile 17: Product Liability (Separate from GL)

Usually covered under GL's Coverage A. Separate product liability policies exist for manufacturers with significant exposure.

#### Extraction Notes
- When separate: typically has own limits, may be occurrence or claims-made
- Product recall coverage is a separate, often sublimited coverage
- "Products-completed operations hazard" definition is key

---

### Profile 18: Business Owners Policy (BOP)

#### Overview
Packaged GL + Property for small to mid-size businesses. Simplified form, fewer options.

#### Extraction Notes
- Combined form — extract as both GL and property
- Limited endorsement options compared to standalone
- Classification-based (eligible classes defined by insurer)
- Often includes business income coverage by default

---

### Profile 19: Management Liability Package

#### Overview
Bundled D&O + EPLI + Fiduciary + Crime in one policy. Common for small to mid-size companies.

#### Extraction Notes
- Shared aggregate across all coverage parts (critical!)
- May have separate limits per coverage part AND a policy aggregate
- Cross-reference which coverage parts share vs have independent limits

---

### Profile 20: Excess Liability (Standalone)

#### Differences from Umbrella
- Pure "follow form" — no drop-down provision
- No SIR — sits directly above underlying
- Narrower coverage (limited to underlying terms)

#### Extraction Notes
- Schedule of underlying is key data
- "Follow form" means underlying policy's terms, conditions, exclusions apply
- May stack multiple excess layers

---

## SDK Implementation Impact

### New TypeScript Interfaces Required

1. `EnrichedCoverage` (replaces flat `Coverage`)
2. `Endorsement` with `EndorsementType` enum
3. `EndorsementParty` with role classification
4. `Exclusion` with structured fields
5. `PolicyCondition` with `ConditionType` enum
6. `LimitSchedule` with per-line limit fields
7. `DeductibleSchedule` with SIR support
8. `InsuredLocation` with property detail fields
9. `InsuredVehicle` with coverage selections
10. `ClassificationCode` with rating basis
11. `InsurerInfo`, `ProducerInfo` (structured party data)
12. `LossSummary`, `ClaimRecord`, `ExperienceMod`
13. `FormReference` for form inventory
14. `ExtractionChunk` for intelligent chunking metadata
15. `Address`, `Contact` shared types
16. `TaxFeeItem`, `PaymentInstallment`, `RatingBasis`
17. Expanded `PolicyType` enum (11 → 22 values)
18. `EndorsementType` enum (17 values)
19. `ConditionType` enum (16 values)

### Extraction Pipeline Changes

1. **Pre-scan pass** (new): Scan for structural signals before chunking
2. **Intelligent chunking**: Form-boundary and section-boundary aware
3. **Pass 1 enhancement**: Extract enriched metadata including locations, vehicles, classifications
4. **Pass 2 enhancement**: Extract endorsements as typed objects, not generic sections
5. **Pass 2 enhancement**: Extract exclusions and conditions as typed objects
6. **New: Endorsement-specific extraction**: Each endorsement gets individual structured extraction
7. **New: Schedule extraction**: Dedicated table/schedule parsing for locations, vehicles, classifications

### Agent System Changes

1. Agent prompts can reference specific endorsement types (e.g., "You have a waiver of subrogation endorsement CG 24 04")
2. Coverage gap analysis uses structured exclusion data
3. Additional insured queries can be answered from `endorsements[].named_parties`
4. COI generation can pull from structured party data

### Application Processing Changes

1. Business context storage expanded with new categories (`premises`, `vehicles`, `employees`)
2. Auto-fill uses structured location data, classification data, loss history
3. Cross-policy data reuse (e.g., GL class codes inform WC application)
4. Source citation includes specific form numbers and page references

---

## Out of Scope

- Zod schema validation (extraction uses AI SDK structured output via prompts, not Zod)
- PDF rendering/display
- Claims management workflows
- Policy comparison algorithms (tool exists but logic is consumer-side)
- Pricing/rating engine integration
- Regulatory compliance database
