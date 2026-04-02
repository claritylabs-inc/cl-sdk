# Insurance Extraction Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the CL-0 SDK's type system, extraction prompts, and pipeline to extract deeply structured insurance data across 20 lines of business — and produce three reference documents (data dictionary, form structure guide, line-of-business profiles).

**Architecture:** The work splits into 4 phases: (1) expand TypeScript types with new interfaces for endorsements, exclusions, conditions, locations, vehicles, classifications, parties, financial, loss history, and enriched coverages; (2) update extraction prompts to request the new structured fields; (3) enhance the pipeline with structure-aware chunking and endorsement-level extraction; (4) write the three reference documents. Phases 1-2 are independent and can be parallelized. Phase 3 depends on 1+2. Phase 4 (docs) is independent of code.

**Tech Stack:** TypeScript, Vercel AI SDK (`ai` >=4.0.0), pdf-lib, tsup (build), no test runner (typecheck only via `tsc --noEmit`)

**Validation command:** `npm run typecheck` (there is no test runner — all validation is type-checking)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/types/enums.ts` | All enum/union types: PolicyType, EndorsementType, ConditionType, SectionType, CoverageForm, etc. |
| `src/types/shared.ts` | Shared interfaces: Address, Contact, FormReference, TaxFeeItem, RatingBasis, etc. |
| `src/types/endorsement.ts` | Endorsement, EndorsementParty interfaces |
| `src/types/declarations.ts` | LimitSchedule, DeductibleSchedule, InsuredLocation, InsuredVehicle, ClassificationCode, NamedInsured |
| `src/types/coverage.ts` | EnrichedCoverage (replaces flat Coverage), Sublimit, VehicleCoverage |
| `src/types/exclusion.ts` | Exclusion interface |
| `src/types/condition.ts` | PolicyCondition interface |
| `src/types/parties.ts` | InsurerInfo, ProducerInfo |
| `src/types/financial.ts` | PaymentPlan, PaymentInstallment, LocationPremium |
| `src/types/loss-history.ts` | LossSummary, ClaimRecord, ExperienceMod |
| `src/types/underwriting.ts` | EnrichedSubjectivity, EnrichedUnderwritingCondition, BindingAuthority |
| `src/types/context-keys.ts` | CONTEXT_KEY_MAP constant mapping extracted fields → business context keys |
| `src/extraction/chunking.ts` | Structure-aware chunking: pre-scan, form-boundary detection, ExtractionChunk |
| `docs/data-dictionary.md` | Deliverable 1: comprehensive field/type/schema definitions |
| `docs/form-structure-guide.md` | Deliverable 2: document patterns, chunking strategies, ISO/ACORD catalog |
| `docs/line-of-business-profiles.md` | Deliverable 3: per-line specifics |

### Modified Files

| File | Changes |
|------|---------|
| `src/types/document.ts` | Add new optional fields to BaseDocument, PolicyDocument, QuoteDocument using new types. Keep old fields for backward compat. |
| `src/prompts/extraction.ts` | Expand METADATA_PROMPT, QUOTE_METADATA_PROMPT, buildSectionsPrompt, buildQuoteSectionsPrompt with new structured fields. Update policyTypes enum. |
| `src/extraction/pipeline.ts` | Add pre-scan pass, update applyExtracted/applyExtractedQuote, update merge functions, wire intelligent chunking. |
| `src/index.ts` | Export all new types and functions. |
| `src/prompts/agent/quotes-policies.ts` | Reference enriched document types in agent guidance. |

---

## Task Dependency Graph

```
Tasks 1-6 (types)  ──┐
                      ├──> Task 7 (document.ts update) ──> Task 9 (pipeline) ──> Task 10 (index.ts)
Tasks 8 (prompts)  ──┘                                                           │
                                                                                  v
Task 11 (context keys)                                                      Task 12 (typecheck)
                                                                                  │
Tasks 13-15 (docs) ← can start in parallel with Task 7                     Task 16 (commit)
```

**Parallelizable groups:**
- Tasks 1-6: All new type files (independent of each other)
- Task 8: Prompt updates (independent of type files, just strings)
- Tasks 13-15: Reference documents (independent of code)

---

## Phase 1: Expand Type System

### Task 1: Create enum/union types

**Files:**
- Create: `src/types/enums.ts`

- [ ] **Step 1: Create `src/types/enums.ts` with all enum types**

```typescript
// src/types/enums.ts
// Canonical enum/union types for the insurance data model

/** Expanded from 11 to 22 values */
export type PolicyType =
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
  | "bop"
  | "management_liability_package"
  // Legacy compat
  | "property"
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
  "other",
];

export type EndorsementType =
  | "additional_insured"
  | "waiver_of_subrogation"
  | "primary_noncontributory"
  | "blanket_additional_insured"
  | "loss_payee"
  | "mortgage_holder"
  | "broadening"
  | "restriction"
  | "exclusion"
  | "amendatory"
  | "notice_of_cancellation"
  | "designated_premises"
  | "classification_change"
  | "schedule_update"
  | "deductible_change"
  | "limit_change"
  | "territorial_extension"
  | "other";

export type ConditionType =
  | "duties_after_loss"
  | "notice_requirements"
  | "other_insurance"
  | "cancellation"
  | "nonrenewal"
  | "transfer_of_rights"
  | "liberalization"
  | "arbitration"
  | "concealment_fraud"
  | "examination_under_oath"
  | "legal_action"
  | "loss_payment"
  | "appraisal"
  | "mortgage_holders"
  | "policy_territory"
  | "separation_of_insureds"
  | "other";

export type PolicySectionType =
  | "declarations"
  | "insuring_agreement"
  | "policy_form"
  | "endorsement"
  | "application"
  | "exclusion"
  | "condition"
  | "definition"
  | "schedule"
  | "notice"
  | "regulatory"
  | "other";

export type QuoteSectionType =
  | "terms_summary"
  | "premium_indication"
  | "underwriting_condition"
  | "subjectivity"
  | "coverage_summary"
  | "exclusion"
  | "other";

export type CoverageForm = "occurrence" | "claims_made" | "accident";

export type CoverageTrigger = "occurrence" | "claims_made" | "accident";

export type LimitType =
  | "per_occurrence"
  | "per_claim"
  | "aggregate"
  | "per_person"
  | "per_accident"
  | "statutory"
  | "blanket"
  | "scheduled";

export type DeductibleType =
  | "per_occurrence"
  | "per_claim"
  | "aggregate"
  | "percentage"
  | "waiting_period";

export type ValuationMethod =
  | "replacement_cost"
  | "actual_cash_value"
  | "agreed_value"
  | "functional_replacement";

export type DefenseCostTreatment = "inside_limits" | "outside_limits" | "supplementary";

export type EntityType =
  | "corporation"
  | "llc"
  | "partnership"
  | "sole_proprietor"
  | "joint_venture"
  | "trust"
  | "nonprofit"
  | "municipality"
  | "other";

export type AdmittedStatus = "admitted" | "non_admitted" | "surplus_lines";

export type AuditType =
  | "annual"
  | "semi_annual"
  | "quarterly"
  | "monthly"
  | "self"
  | "physical"
  | "none";

export type EndorsementPartyRole =
  | "additional_insured"
  | "loss_payee"
  | "mortgage_holder"
  | "certificate_holder"
  | "notice_recipient"
  | "other";

export type ClaimStatus = "open" | "closed" | "reopened";

export type SubjectivityCategory = "pre_binding" | "post_binding" | "information";

export type DocumentType = "policy" | "quote" | "binder" | "endorsement" | "certificate";

export type ChunkType =
  | "declarations"
  | "coverage_form"
  | "endorsement"
  | "schedule"
  | "conditions"
  | "mixed";

export type RatingBasisType =
  | "payroll"
  | "revenue"
  | "area"
  | "units"
  | "vehicle_count"
  | "employee_count"
  | "per_capita"
  | "other";

export type VehicleCoverageType =
  | "liability"
  | "collision"
  | "comprehensive"
  | "uninsured_motorist"
  | "underinsured_motorist"
  | "medical_payments"
  | "hired_auto"
  | "non_owned_auto"
  | "cargo"
  | "physical_damage";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS (new file, no imports yet)

- [ ] **Step 3: Commit**

```bash
git add src/types/enums.ts
git commit -m "feat: add comprehensive enum/union types for insurance data model"
```

---

### Task 2: Create shared interfaces

**Files:**
- Create: `src/types/shared.ts`

- [ ] **Step 1: Create `src/types/shared.ts`**

```typescript
// src/types/shared.ts
// Shared interfaces used across multiple domain types

import type { RatingBasisType } from "./enums";

export interface Address {
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface Contact {
  name?: string;
  title?: string;
  type?: string;
  phone?: string;
  fax?: string;
  email?: string;
  address?: Address;
  hours?: string;
}

export interface FormReference {
  formNumber: string;
  editionDate?: string;
  title?: string;
  formType: "coverage" | "endorsement" | "declarations" | "application" | "notice" | "other";
}

export interface TaxFeeItem {
  name: string;
  amount: string;
  type?: "tax" | "fee" | "surcharge" | "assessment";
  description?: string;
}

export interface RatingBasis {
  type: RatingBasisType;
  amount?: string;
  description?: string;
}

export interface Sublimit {
  name: string;
  limit: string;
  appliesTo?: string;
  deductible?: string;
}

export interface SharedLimit {
  description: string;
  limit: string;
  coverageParts: string[];
}

export interface ExtendedReportingPeriod {
  basicDays?: number;
  supplementalYears?: number;
  supplementalPremium?: string;
}

export interface NamedInsured {
  name: string;
  relationship?: string;
  address?: Address;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types/shared.ts
git commit -m "feat: add shared interfaces (Address, Contact, FormReference, etc.)"
```

---

### Task 3: Create declarations types

**Files:**
- Create: `src/types/declarations.ts`

- [ ] **Step 1: Create `src/types/declarations.ts`**

```typescript
// src/types/declarations.ts
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
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types/declarations.ts
git commit -m "feat: add declarations types (limits, deductibles, locations, vehicles, classifications)"
```

---

### Task 4: Create endorsement, exclusion, condition types

**Files:**
- Create: `src/types/endorsement.ts`
- Create: `src/types/exclusion.ts`
- Create: `src/types/condition.ts`

- [ ] **Step 1: Create `src/types/endorsement.ts`**

```typescript
// src/types/endorsement.ts

import type { EndorsementType, EndorsementPartyRole } from "./enums";
import type { Address } from "./shared";

export interface EndorsementParty {
  name: string;
  role: EndorsementPartyRole;
  address?: Address;
  relationship?: string;
  scope?: string;
}

export interface Endorsement {
  formNumber: string;
  editionDate?: string;
  title: string;
  endorsementType: EndorsementType;
  effectiveDate?: string;
  affectedCoverageParts?: string[];
  namedParties?: EndorsementParty[];
  keyTerms?: string[];
  premiumImpact?: string;
  content: string;
  pageStart: number;
  pageEnd?: number;
}
```

- [ ] **Step 2: Create `src/types/exclusion.ts`**

```typescript
// src/types/exclusion.ts

export interface Exclusion {
  name: string;
  formNumber?: string;
  excludedPerils?: string[];
  isAbsolute?: boolean;
  exceptions?: string[];
  buybackAvailable?: boolean;
  buybackEndorsement?: string;
  appliesTo?: string[];
  content: string;
  pageNumber?: number;
}
```

- [ ] **Step 3: Create `src/types/condition.ts`**

```typescript
// src/types/condition.ts

import type { ConditionType } from "./enums";

export interface PolicyCondition {
  name: string;
  conditionType: ConditionType;
  content: string;
  keyValues?: Record<string, string>;
  pageNumber?: number;
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/endorsement.ts src/types/exclusion.ts src/types/condition.ts
git commit -m "feat: add endorsement, exclusion, and condition types"
```

---

### Task 5: Create coverage, parties, financial, loss-history, underwriting types

**Files:**
- Create: `src/types/coverage.ts`
- Create: `src/types/parties.ts`
- Create: `src/types/financial.ts`
- Create: `src/types/loss-history.ts`
- Create: `src/types/underwriting.ts`

- [ ] **Step 1: Create `src/types/coverage.ts`**

```typescript
// src/types/coverage.ts
// Enriched coverage model — replaces flat { name, limit, deductible }

import type {
  LimitType,
  DeductibleType,
  CoverageTrigger,
  ValuationMethod,
} from "./enums";

export interface EnrichedCoverage {
  name: string;
  coverageCode?: string;
  formNumber?: string;
  formEditionDate?: string;
  limit: string;
  limitType?: LimitType;
  deductible?: string;
  deductibleType?: DeductibleType;
  sir?: string;
  sublimit?: string;
  coinsurance?: string;
  valuation?: ValuationMethod;
  territory?: string;
  trigger?: CoverageTrigger;
  retroactiveDate?: string;
  included: boolean;
  premium?: string;
  pageNumber?: number;
  sectionRef?: string;
}
```

- [ ] **Step 2: Create `src/types/parties.ts`**

```typescript
// src/types/parties.ts

import type { AdmittedStatus } from "./enums";
import type { Address } from "./shared";

export interface InsurerInfo {
  legalName: string;
  naicNumber?: string;
  amBestRating?: string;
  amBestNumber?: string;
  admittedStatus?: AdmittedStatus;
  stateOfDomicile?: string;
}

export interface ProducerInfo {
  agencyName: string;
  contactName?: string;
  licenseNumber?: string;
  phone?: string;
  email?: string;
  address?: Address;
}
```

- [ ] **Step 3: Create `src/types/financial.ts`**

```typescript
// src/types/financial.ts

import type { TaxFeeItem } from "./shared";

export interface PaymentInstallment {
  dueDate: string;
  amount: string;
  description?: string;
}

export interface PaymentPlan {
  installments: PaymentInstallment[];
  financeCharge?: string;
}

export interface LocationPremium {
  locationNumber: number;
  premium: string;
  description?: string;
}
```

- [ ] **Step 4: Create `src/types/loss-history.ts`**

```typescript
// src/types/loss-history.ts

import type { ClaimStatus } from "./enums";

export interface ClaimRecord {
  dateOfLoss: string;
  claimNumber?: string;
  description: string;
  status: ClaimStatus;
  paid?: string;
  reserved?: string;
  incurred?: string;
  claimant?: string;
  coverageLine?: string;
}

export interface LossSummary {
  period?: string;
  totalClaims?: number;
  totalIncurred?: string;
  totalPaid?: string;
  totalReserved?: string;
  lossRatio?: string;
}

export interface ExperienceMod {
  factor: number;
  effectiveDate?: string;
  state?: string;
}
```

- [ ] **Step 5: Create `src/types/underwriting.ts`**

```typescript
// src/types/underwriting.ts

import type { SubjectivityCategory } from "./enums";

export interface EnrichedSubjectivity {
  description: string;
  category?: SubjectivityCategory;
  dueDate?: string;
  status?: "open" | "satisfied" | "waived";
  pageNumber?: number;
}

export interface EnrichedUnderwritingCondition {
  description: string;
  category?: string;
  pageNumber?: number;
}

export interface BindingAuthority {
  authorizedBy?: string;
  method?: string;
  expiration?: string;
  conditions?: string[];
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types/coverage.ts src/types/parties.ts src/types/financial.ts src/types/loss-history.ts src/types/underwriting.ts
git commit -m "feat: add coverage, parties, financial, loss-history, and underwriting types"
```

---

### Task 6: Create context key mapping

**Files:**
- Create: `src/types/context-keys.ts`

- [ ] **Step 1: Create `src/types/context-keys.ts`**

```typescript
// src/types/context-keys.ts
// Maps extracted policy fields → business context storage keys for application auto-fill

export interface ContextKeyMapping {
  /** Dot-path to the extracted field (e.g., "insuredName", "locations[0].address") */
  extractedField: string;
  /** Business context category */
  category: "company_info" | "operations" | "financial" | "coverage" | "loss_history" | "premises" | "vehicles" | "employees";
  /** Business context key */
  contextKey: string;
  /** Human-readable description */
  description: string;
}

/**
 * Canonical mapping from extracted policy fields to business context keys.
 * Used by the application auto-fill system to reuse policy data.
 */
export const CONTEXT_KEY_MAP: ContextKeyMapping[] = [
  // Company Info
  { extractedField: "insuredName", category: "company_info", contextKey: "company_name", description: "Primary named insured" },
  { extractedField: "insuredDba", category: "company_info", contextKey: "dba_name", description: "Doing-business-as name" },
  { extractedField: "insuredAddress", category: "company_info", contextKey: "company_address", description: "Primary insured mailing address" },
  { extractedField: "insuredEntityType", category: "company_info", contextKey: "entity_type", description: "Legal entity type" },
  { extractedField: "insuredFein", category: "company_info", contextKey: "fein", description: "Federal Employer ID Number" },
  { extractedField: "insuredSicCode", category: "company_info", contextKey: "sic_code", description: "SIC classification code" },
  { extractedField: "insuredNaicsCode", category: "company_info", contextKey: "naics_code", description: "NAICS classification code" },

  // Operations
  { extractedField: "classifications[].description", category: "operations", contextKey: "description_of_operations", description: "Description of business operations" },
  { extractedField: "classifications[].basisAmount(payroll)", category: "operations", contextKey: "annual_payroll", description: "Annual payroll from classification schedule" },
  { extractedField: "classifications[].basisAmount(revenue)", category: "operations", contextKey: "annual_revenue", description: "Annual revenue from classification schedule" },

  // Financial
  { extractedField: "totalPremium", category: "financial", contextKey: "current_premium", description: "Total policy premium" },
  { extractedField: "locations[].buildingValue", category: "financial", contextKey: "total_property_values", description: "Sum of building values" },
  { extractedField: "locations[].contentsValue", category: "financial", contextKey: "total_contents_values", description: "Sum of contents values" },

  // Coverage
  { extractedField: "policyTypes", category: "coverage", contextKey: "coverage_types", description: "Lines of business covered" },
  { extractedField: "coverages[].limit", category: "coverage", contextKey: "current_limits", description: "Current coverage limits" },
  { extractedField: "coverages[].deductible", category: "coverage", contextKey: "current_deductibles", description: "Current deductibles" },

  // Loss History
  { extractedField: "experienceMod.factor", category: "loss_history", contextKey: "experience_mod", description: "Workers comp experience modification factor" },
  { extractedField: "lossSummary.totalClaims", category: "loss_history", contextKey: "total_claims", description: "Total claim count from loss runs" },

  // Premises
  { extractedField: "locations[]", category: "premises", contextKey: "premises_addresses", description: "All insured location addresses" },
  { extractedField: "locations[].constructionType", category: "premises", contextKey: "construction_type", description: "Building construction type" },
  { extractedField: "locations[].yearBuilt", category: "premises", contextKey: "year_built", description: "Year built for primary location" },
  { extractedField: "locations[].sprinklered", category: "premises", contextKey: "sprinkler_system", description: "Sprinkler system presence" },

  // Vehicles
  { extractedField: "vehicles[]", category: "vehicles", contextKey: "vehicle_schedule", description: "Complete vehicle schedule" },
  { extractedField: "vehicles[].length", category: "vehicles", contextKey: "vehicle_count", description: "Number of insured vehicles" },

  // Employees
  { extractedField: "classifications[](WC)", category: "employees", contextKey: "employee_count_by_class", description: "Employee count by WC classification" },
  { extractedField: "classifications[].basisAmount(payroll,byState)", category: "employees", contextKey: "annual_payroll_by_state", description: "Annual payroll by state" },
];
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/types/context-keys.ts
git commit -m "feat: add context key mapping for policy-to-application auto-fill"
```

---

### Task 7: Update document.ts and integrate new types

**Files:**
- Modify: `src/types/document.ts`

This is the critical integration step. We add new optional fields to BaseDocument, PolicyDocument, and QuoteDocument while keeping all existing fields for backward compatibility.

- [ ] **Step 1: Update `src/types/document.ts` to import and use new types**

Replace the entire file contents with:

```typescript
// Framework-agnostic document interfaces for the insurance intelligence engine

import type { PolicyType, EntityType, CoverageForm, AuditType } from "./enums";
import type { Address, Contact, FormReference, TaxFeeItem, RatingBasis, NamedInsured, ExtendedReportingPeriod } from "./shared";
import type { EnrichedCoverage } from "./coverage";
import type { Endorsement, EndorsementParty } from "./endorsement";
import type { Exclusion } from "./exclusion";
import type { PolicyCondition } from "./condition";
import type { LimitSchedule, DeductibleSchedule, InsuredLocation, InsuredVehicle, ClassificationCode } from "./declarations";
import type { InsurerInfo, ProducerInfo } from "./parties";
import type { PaymentPlan, LocationPremium } from "./financial";
import type { LossSummary, ClaimRecord, ExperienceMod } from "./loss-history";
import type { EnrichedSubjectivity, EnrichedUnderwritingCondition, BindingAuthority } from "./underwriting";

// ─── Legacy interfaces (preserved for backward compatibility) ───

export interface Coverage {
  name: string;
  limit: string;
  deductible?: string;
  pageNumber?: number;
  sectionRef?: string;
}

export interface Subsection {
  title: string;
  sectionNumber?: string;
  pageNumber?: number;
  content: string;
}

export interface Section {
  title: string;
  sectionNumber?: string;
  pageStart: number;
  pageEnd?: number;
  type: string;
  coverageType?: string;
  content: string;
  subsections?: Subsection[];
}

export interface Subjectivity {
  description: string;
  category?: string;
}

export interface UnderwritingCondition {
  description: string;
}

export interface PremiumLine {
  line: string;
  amount: string;
}

// ─── Enriched document interfaces ───

export interface BaseDocument {
  id: string;
  type: "policy" | "quote";
  carrier: string;
  security?: string;
  insuredName: string;
  premium?: string;
  summary?: string;
  policyTypes?: string[];
  coverages: Coverage[];
  sections?: Section[];

  // ── Enriched fields (v1.2+) ──

  /** Legal name of insurance carrier */
  carrierLegalName?: string;
  /** NAIC company code */
  carrierNaicNumber?: string;
  /** AM Best financial strength rating */
  carrierAmBestRating?: string;
  /** Admitted / non-admitted / surplus lines */
  carrierAdmittedStatus?: string;
  /** Managing General Agent */
  mga?: string;
  /** Named underwriter */
  underwriter?: string;
  /** Broker/producer agency name */
  brokerAgency?: string;
  /** Individual producer name */
  brokerContactName?: string;
  /** Producer license number */
  brokerLicenseNumber?: string;
  /** Prior policy number (if renewal) */
  priorPolicyNumber?: string;
  /** Named program */
  programName?: string;
  /** Whether this is a renewal */
  isRenewal?: boolean;
  /** Whether this is a commercial package policy */
  isPackage?: boolean;

  /** Primary insured DBA name */
  insuredDba?: string;
  /** Primary insured mailing address */
  insuredAddress?: Address;
  /** Legal entity type */
  insuredEntityType?: EntityType;
  /** Additional named insureds */
  additionalNamedInsureds?: NamedInsured[];
  /** SIC code */
  insuredSicCode?: string;
  /** NAICS code */
  insuredNaicsCode?: string;
  /** Federal Employer ID Number */
  insuredFein?: string;

  /** Enriched coverage details */
  enrichedCoverages?: EnrichedCoverage[];
  /** Structured endorsements */
  endorsements?: Endorsement[];
  /** Structured exclusions */
  exclusions?: Exclusion[];
  /** Structured conditions */
  conditions?: PolicyCondition[];
  /** Structured limits schedule */
  limits?: LimitSchedule;
  /** Structured deductible schedule */
  deductibles?: DeductibleSchedule;
  /** Insured locations/premises */
  locations?: InsuredLocation[];
  /** Insured vehicles */
  vehicles?: InsuredVehicle[];
  /** Rating classification codes */
  classifications?: ClassificationCode[];
  /** All form numbers in the policy */
  formInventory?: FormReference[];

  /** Coverage trigger type */
  coverageForm?: CoverageForm;
  /** Retroactive date (claims-made) */
  retroactiveDate?: string;
  /** Extended reporting period options */
  extendedReportingPeriod?: ExtendedReportingPeriod;

  /** Full insurer entity details */
  insurer?: InsurerInfo;
  /** Producer/broker details */
  producer?: ProducerInfo;
  /** Claims contact information */
  claimsContacts?: Contact[];
  /** Regulatory contacts */
  regulatoryContacts?: Contact[];
  /** Third-party administrators */
  thirdPartyAdministrators?: Contact[];
  /** All additional insureds across endorsements */
  additionalInsureds?: EndorsementParty[];
  /** All loss payees across endorsements */
  lossPayees?: EndorsementParty[];
  /** All mortgage holders across endorsements */
  mortgageHolders?: EndorsementParty[];

  /** Taxes and fees breakdown */
  taxesAndFees?: TaxFeeItem[];
  /** Total cost (premium + taxes + fees) */
  totalCost?: string;
  /** Minimum earned premium */
  minimumPremium?: string;
  /** Deposit premium */
  depositPremium?: string;
  /** Payment plan */
  paymentPlan?: PaymentPlan;
  /** Premium audit type */
  auditType?: AuditType;
  /** Rating basis */
  ratingBasis?: RatingBasis[];
  /** Premium allocated by location */
  premiumByLocation?: LocationPremium[];

  /** Loss history summary */
  lossSummary?: LossSummary;
  /** Individual claim records */
  individualClaims?: ClaimRecord[];
  /** Experience modification factor (WC) */
  experienceMod?: ExperienceMod;

  /** Cancellation notice days */
  cancellationNoticeDays?: number;
  /** Nonrenewal notice days */
  nonrenewalNoticeDays?: number;
}

export interface PolicyDocument extends BaseDocument {
  type: "policy";
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  /** Time of day coverage begins */
  effectiveTime?: string;
}

export interface QuoteDocument extends BaseDocument {
  type: "quote";
  quoteNumber: string;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  subjectivities?: Subjectivity[];
  underwritingConditions?: UnderwritingCondition[];
  premiumBreakdown?: PremiumLine[];

  // ── Enriched quote fields (v1.2+) ──
  /** Enriched subjectivities with category, due date, status */
  enrichedSubjectivities?: EnrichedSubjectivity[];
  /** Enriched underwriting conditions */
  enrichedUnderwritingConditions?: EnrichedUnderwritingCondition[];
  /** Warranty requirements */
  warrantyRequirements?: string[];
  /** Loss control recommendations */
  lossControlRecommendations?: string[];
  /** Binding authority details */
  bindingAuthority?: BindingAuthority;
}

export type InsuranceDocument = PolicyDocument | QuoteDocument;
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS — all new fields are optional, so existing code continues to work

- [ ] **Step 3: Commit**

```bash
git add src/types/document.ts
git commit -m "feat: add enriched fields to BaseDocument, PolicyDocument, QuoteDocument

All new fields are optional for backward compatibility. Integrates
endorsements, exclusions, conditions, declarations, coverage, parties,
financial, loss-history, and underwriting types."
```

---

## Phase 2: Update Extraction Prompts

### Task 8: Expand extraction prompts with new structured fields

**Files:**
- Modify: `src/prompts/extraction.ts:24` (policyTypes array)
- Modify: `src/prompts/extraction.ts:120-155` (METADATA_PROMPT)
- Modify: `src/prompts/extraction.ts:161-210` (QUOTE_METADATA_PROMPT)
- Modify: `src/prompts/extraction.ts:215-249` (buildSectionsPrompt)
- Modify: `src/prompts/extraction.ts:258-295` (buildQuoteSectionsPrompt)

- [ ] **Step 1: Update policyTypes in EXTRACTION_PROMPT (line 24)**

In `src/prompts/extraction.ts`, replace the policyTypes array in the deprecated EXTRACTION_PROMPT:

Old (line 24):
```
    "policyTypes": ["general_liability", "workers_comp", "commercial_auto", "non_owned_auto", "property", "umbrella", "professional_liability", "cyber", "epli", "directors_officers", "other"],
```

New:
```
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "other"],
```

- [ ] **Step 2: Replace METADATA_PROMPT (lines 120-155) with enriched version**

Replace lines 120-155 of `src/prompts/extraction.ts`:

Old:
```typescript
export const METADATA_PROMPT = `You are an expert insurance document analyst. Extract ONLY the high-level metadata from this insurance document. Do NOT extract full section content — that will be done in a separate pass.
...
`;
```

New:
```typescript
export const METADATA_PROMPT = `You are an expert insurance document analyst. Extract the high-level metadata AND structured declarations data from this insurance document. Do NOT extract full section content — that will be done in a separate pass.

Respond with JSON only:

{
  "metadata": {
    "carrier": "primary insurance company name",
    "carrierLegalName": "legal entity name of insurer, or null",
    "carrierNaicNumber": "NAIC company code, or null",
    "carrierAmBestRating": "AM Best rating (e.g. 'A+ XV'), or null",
    "carrierAdmittedStatus": "admitted" or "non_admitted" or "surplus_lines" or null,
    "security": "insurer or underwriter entity providing coverage, or null",
    "underwriter": "named individual underwriter, or null",
    "mga": "MGA or Program Administrator, or null",
    "broker": "insurance broker agency name, or null",
    "brokerContactName": "individual producer name, or null",
    "brokerLicenseNumber": "producer license number, or null",
    "policyNumber": "policy number",
    "priorPolicyNumber": "previous policy number if renewal, or null",
    "documentType": "policy" or "quote",
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "other"],
    "coverageForm": "occurrence" or "claims_made" or "accident" or null,
    "policyYear": number,
    "effectiveDate": "MM/DD/YYYY",
    "expirationDate": "MM/DD/YYYY",
    "effectiveTime": "e.g. 12:01 AM, or null",
    "retroactiveDate": "MM/DD/YYYY for claims-made policies, or null",
    "isRenewal": boolean,
    "isPackage": boolean,
    "programName": "named program, or null",
    "premium": "$X,XXX",
    "insuredName": "name of primary named insured",
    "insuredDba": "doing-business-as name, or null",
    "insuredAddress": { "street1": "", "city": "", "state": "", "zip": "" } or null,
    "insuredEntityType": "corporation" or "llc" or "partnership" or "sole_proprietor" or "joint_venture" or "trust" or "nonprofit" or "municipality" or "other" or null,
    "insuredFein": "FEIN, or null",
    "summary": "1-2 sentence summary"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "policyNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "additionalNamedInsureds": [
    { "name": "insured name", "relationship": "subsidiary, affiliate, etc., or null" }
  ],
  "coverages": [
    { "name": "coverage name", "limit": "$X,XXX,XXX", "deductible": "$X,XXX or null", "pageNumber": number, "sectionRef": "section ref or null" }
  ],
  "limits": {
    "perOccurrence": "$X,XXX,XXX or null",
    "generalAggregate": "$X,XXX,XXX or null",
    "productsCompletedOpsAggregate": "or null",
    "personalAdvertisingInjury": "or null",
    "fireDamage": "or null",
    "medicalExpense": "or null",
    "combinedSingleLimit": "or null",
    "bodilyInjuryPerPerson": "or null",
    "bodilyInjuryPerAccident": "or null",
    "propertyDamage": "or null",
    "eachOccurrenceUmbrella": "or null",
    "umbrellaAggregate": "or null",
    "umbrellaRetention": "or null",
    "statutory": boolean or null,
    "employersLiability": { "eachAccident": "", "diseasePolicyLimit": "", "diseaseEachEmployee": "" } or null,
    "defenseCostTreatment": "inside_limits" or "outside_limits" or "supplementary" or null
  },
  "deductibles": {
    "perClaim": "or null",
    "perOccurrence": "or null",
    "selfInsuredRetention": "or null",
    "waitingPeriod": "or null"
  },
  "locations": [
    { "number": 1, "address": { "street1": "", "city": "", "state": "", "zip": "" }, "description": "or null", "buildingValue": "or null", "contentsValue": "or null" }
  ],
  "vehicles": [
    { "number": 1, "year": 2024, "make": "", "model": "", "vin": "", "vehicleType": "or null" }
  ],
  "classifications": [
    { "code": "12345", "description": "class description", "premiumBasis": "payroll or revenue or area", "basisAmount": "or null", "rate": "or null", "premium": "or null" }
  ],
  "formInventory": [
    { "formNumber": "CG 00 01", "editionDate": "04 13", "title": "or null", "formType": "coverage or endorsement or declarations or application or notice or other" }
  ],
  "taxesAndFees": [
    { "name": "fee name", "amount": "$X,XXX", "type": "tax or fee or surcharge or assessment or null" }
  ],
  "totalPages": number,
  "tableOfContents": [
    { "title": "section title", "pageStart": number, "pageEnd": number }
  ]
}

IMPORTANT:
- policyTypes should include ALL coverage types found in the document
- coverageForm is the primary trigger type: "occurrence" for occurrence-based, "claims_made" for claims-made, "accident" for auto/WC
- isPackage is true if this is a Commercial Package Policy (CPP) with multiple coverage parts
- Extract locations ONLY if a location/premises schedule is visible on the declarations
- Extract vehicles ONLY if a vehicle schedule is visible
- Extract classifications ONLY if a classification/rating schedule is visible
- formInventory: list ALL form numbers found in any forms schedule or endorsement schedule
- For limits, extract the standard limit fields that appear on the declarations page
- For deductibles, extract from the declarations or deductible schedule`;
```

- [ ] **Step 3: Replace QUOTE_METADATA_PROMPT (lines 161-210) with enriched version**

Replace lines 161-210 of `src/prompts/extraction.ts`:

```typescript
export const QUOTE_METADATA_PROMPT = `You are an expert insurance document analyst. Extract the high-level metadata AND structured data from this insurance QUOTE or PROPOSAL. Do NOT extract full section content — that will be done in a separate pass.

Respond with JSON only:

{
  "metadata": {
    "carrier": "primary insurance company name",
    "carrierLegalName": "legal entity name, or null",
    "carrierNaicNumber": "NAIC code, or null",
    "carrierAdmittedStatus": "admitted or non_admitted or surplus_lines, or null",
    "security": "insurer or underwriter entity, or null",
    "underwriter": "named individual underwriter, or null",
    "mga": "MGA or Program Administrator, or null",
    "broker": "insurance broker, or null",
    "brokerContactName": "individual producer, or null",
    "quoteNumber": "quote or proposal reference number",
    "policyTypes": ["general_liability", "commercial_property", "commercial_auto", "non_owned_auto", "workers_comp", "umbrella", "excess_liability", "professional_liability", "cyber", "epli", "directors_officers", "fiduciary_liability", "crime_fidelity", "inland_marine", "builders_risk", "environmental", "ocean_marine", "surety", "product_liability", "bop", "management_liability_package", "property", "other"],
    "coverageForm": "occurrence or claims_made or accident, or null",
    "quoteYear": number,
    "proposedEffectiveDate": "MM/DD/YYYY or null",
    "proposedExpirationDate": "MM/DD/YYYY or null",
    "quoteExpirationDate": "MM/DD/YYYY — when this quote offer expires, or null",
    "retroactiveDate": "MM/DD/YYYY for claims-made, or null",
    "isRenewal": boolean,
    "premium": "$X,XXX — total proposed premium",
    "insuredName": "name of insured party",
    "insuredAddress": { "street1": "", "city": "", "state": "", "zip": "" } or null,
    "summary": "1-2 sentence summary of the quote"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "quoteNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "coverages": [
    { "name": "coverage name", "proposedLimit": "$X,XXX,XXX", "proposedDeductible": "$X,XXX or null", "pageNumber": number, "sectionRef": "or null" }
  ],
  "limits": {
    "perOccurrence": "or null",
    "generalAggregate": "or null",
    "defenseCostTreatment": "inside_limits or outside_limits or supplementary, or null"
  },
  "deductibles": {
    "perClaim": "or null",
    "perOccurrence": "or null",
    "selfInsuredRetention": "or null",
    "waitingPeriod": "or null"
  },
  "premiumBreakdown": [
    { "line": "coverage line name", "amount": "$X,XXX" }
  ],
  "subjectivities": [
    { "description": "subjectivity description", "category": "pre_binding or post_binding or information, or null", "dueDate": "or null", "pageNumber": number or null }
  ],
  "underwritingConditions": [
    { "description": "condition description", "category": "or null", "pageNumber": number or null }
  ],
  "warrantyRequirements": ["warranty text"],
  "taxesAndFees": [
    { "name": "fee name", "amount": "$X,XXX", "type": "tax or fee or surcharge, or null" }
  ],
  "totalPages": number,
  "tableOfContents": [
    { "title": "section title", "pageStart": number, "pageEnd": number }
  ]
}

IMPORTANT:
- quoteExpirationDate is when the quote offer itself expires (not the proposed policy period)
- subjectivities are conditions that must be met before or after binding
- premiumBreakdown should list each coverage line's individual premium if available
- warrantyRequirements: extract any warranty provisions required for coverage
- For limits and deductibles, extract the proposed structure from the quote`;
```

- [ ] **Step 4: Replace buildSectionsPrompt (lines 215-249) with enriched version**

Replace the `buildSectionsPrompt` function in `src/prompts/extraction.ts`:

```typescript
export function buildSectionsPrompt(pageStart: number, pageEnd: number): string {
  return `You are an expert insurance document analyst. Extract ALL sections, clauses, endorsements, and schedules found on pages ${pageStart} through ${pageEnd} of this document. Preserve the original language verbatim.

For ENDORSEMENTS, extract structured data. For other sections, extract content and metadata.

Respond with JSON only:

{
  "sections": [
    {
      "title": "section title",
      "sectionNumber": "section number or null",
      "pageStart": number,
      "pageEnd": number or null,
      "type": "one of: declarations, insuring_agreement, policy_form, endorsement, application, exclusion, condition, definition, schedule, notice, regulatory, other",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "content": "full verbatim text of the section",
      "subsections": [
        { "title": "subsection title", "sectionNumber": "or null", "pageNumber": number, "content": "full verbatim text" }
      ]
    }
  ],
  "endorsements": [
    {
      "formNumber": "e.g. CG 20 10",
      "editionDate": "e.g. 04 13, or null",
      "title": "endorsement title",
      "endorsementType": "one of: additional_insured, waiver_of_subrogation, primary_noncontributory, blanket_additional_insured, loss_payee, mortgage_holder, broadening, restriction, exclusion, amendatory, notice_of_cancellation, designated_premises, classification_change, schedule_update, deductible_change, limit_change, territorial_extension, other",
      "affectedCoverageParts": ["coverage part names"],
      "namedParties": [
        { "name": "party name", "role": "additional_insured or loss_payee or mortgage_holder or certificate_holder or notice_recipient or other", "relationship": "e.g. As required by written contract, or null", "scope": "e.g. Ongoing operations only, or null" }
      ],
      "keyTerms": ["key modification 1", "key modification 2"],
      "content": "full verbatim text",
      "pageStart": number,
      "pageEnd": number or null
    }
  ],
  "exclusions": [
    {
      "name": "exclusion name",
      "formNumber": "form number if from endorsement, or null",
      "excludedPerils": ["what is excluded"],
      "isAbsolute": boolean,
      "exceptions": ["exceptions to exclusion"],
      "appliesTo": ["coverage parts affected"],
      "content": "full verbatim text",
      "pageNumber": number
    }
  ],
  "conditions": [
    {
      "name": "condition name",
      "conditionType": "one of: duties_after_loss, notice_requirements, other_insurance, cancellation, nonrenewal, transfer_of_rights, liberalization, arbitration, concealment_fraud, examination_under_oath, legal_action, loss_payment, appraisal, mortgage_holders, policy_territory, separation_of_insureds, other",
      "keyValues": { "e.g. noticeDays": "30", "e.g. method": "written notice" },
      "content": "full verbatim text",
      "pageNumber": number
    }
  ],
  "regulatoryContext": { "content": "verbatim text", "pageNumber": number } or null,
  "complaintContact": { "content": "verbatim text", "pageNumber": number } or null,
  "costsAndFees": { "content": "verbatim text", "pageNumber": number } or null,
  "claimsContact": { "content": "verbatim text about how to report/file claims", "pageNumber": number } or null
}

SECTION TYPE GUIDANCE:
- "declarations" — the declarations page(s) listing named insured, policy period, limits, premiums
- "policy_form" — named ISO or proprietary forms (e.g. CG 00 01, IL 00 17)
- "endorsement" — standalone endorsements modifying the base policy. ALSO add to the "endorsements" array with structured data
- "application" — the insurance application or supplemental application
- "insuring_agreement" — the insuring agreement clause (only if standalone, not inside a policy_form)
- "exclusion" — exclusion sections. ALSO add to the "exclusions" array with structured data
- "condition" — condition sections. ALSO add to the "conditions" array with structured data
- Other types for standalone sections only

ENDORSEMENT TYPE GUIDANCE:
- "additional_insured" — adds an additional insured (AI). Extract the named party with role "additional_insured"
- "waiver_of_subrogation" — waives right of recovery. Extract the named party
- "primary_noncontributory" — makes coverage primary and non-contributory
- "blanket_additional_insured" — blanket AI for all required by written contract
- "broadening" — broadens coverage beyond base form
- "restriction" — restricts or limits coverage
- "exclusion" — adds an exclusion to the policy

IMPORTANT: Only extract content from pages ${pageStart}-${pageEnd}. Preserve original language exactly. When a section is an endorsement, exclusion, or condition, include it in BOTH the sections array AND the corresponding structured array.`;
}
```

- [ ] **Step 5: Replace buildQuoteSectionsPrompt (lines 258-295) with enriched version**

Replace the `buildQuoteSectionsPrompt` function:

```typescript
export function buildQuoteSectionsPrompt(pageStart: number, pageEnd: number): string {
  return `You are an expert insurance document analyst. Extract ALL sections found on pages ${pageStart} through ${pageEnd} of this insurance QUOTE or PROPOSAL. Preserve the original language verbatim.

Respond with JSON only:

{
  "sections": [
    {
      "title": "section title",
      "sectionNumber": "section number or null",
      "pageStart": number,
      "pageEnd": number or null,
      "type": "one of: terms_summary, premium_indication, underwriting_condition, subjectivity, coverage_summary, exclusion, other",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "content": "full verbatim text of the section",
      "subsections": [
        { "title": "subsection title", "sectionNumber": "or null", "pageNumber": number, "content": "full verbatim text" }
      ]
    }
  ],
  "exclusions": [
    {
      "name": "exclusion name",
      "excludedPerils": ["what is excluded"],
      "isAbsolute": boolean,
      "appliesTo": ["coverage parts affected"],
      "content": "full verbatim text",
      "pageNumber": number
    }
  ],
  "subjectivities": [
    { "description": "subjectivity text", "category": "pre_binding or post_binding or information, or null", "dueDate": "or null", "pageNumber": number or null }
  ],
  "underwritingConditions": [
    { "description": "condition text", "category": "or null", "pageNumber": number or null }
  ]
}

SECTION TYPE GUIDANCE:
- "terms_summary" — overview of proposed terms, key conditions
- "premium_indication" — premium tables, rate schedules, premium breakdown
- "underwriting_condition" — conditions for coverage
- "subjectivity" — items "subject to" that must be provided or completed
- "coverage_summary" — proposed coverage limits, deductibles, descriptions
- "exclusion" — excluded coverages. ALSO add to "exclusions" array with structured data
- "other" — anything else

IMPORTANT: Only extract content from pages ${pageStart}-${pageEnd}. Preserve original language exactly.`;
}
```

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS (prompts are just strings)

- [ ] **Step 7: Commit**

```bash
git add src/prompts/extraction.ts
git commit -m "feat: expand extraction prompts with enriched structured fields

- Expand policyTypes from 11 to 22 values
- METADATA_PROMPT now extracts: carrier details, insured address/entity,
  limits schedule, deductibles, locations, vehicles, classifications,
  form inventory, taxes/fees
- QUOTE_METADATA_PROMPT adds: warranty requirements, enriched subjectivities
- buildSectionsPrompt now extracts structured endorsements, exclusions,
  and conditions alongside section content
- buildQuoteSectionsPrompt adds structured exclusions"
```

---

## Phase 3: Update Pipeline

### Task 9: Update pipeline merge and apply functions

**Files:**
- Modify: `src/extraction/pipeline.ts`

This task updates `applyExtracted`, `applyExtractedQuote`, `mergeChunkedSections`, and `mergeChunkedQuoteSections` to handle the new structured fields from the enriched prompts.

- [ ] **Step 1: Update `applyExtracted()` in `src/extraction/pipeline.ts`**

Find the `applyExtracted` function (starts around line 139) and add the new fields after the existing mappings. Add these lines before the closing `return`:

After the existing field mappings in `applyExtracted()`, add:

```typescript
  // Enriched metadata fields (v1.2+)
  if (raw.metadata?.carrierLegalName) fields.carrierLegalName = raw.metadata.carrierLegalName;
  if (raw.metadata?.carrierNaicNumber) fields.carrierNaicNumber = raw.metadata.carrierNaicNumber;
  if (raw.metadata?.carrierAmBestRating) fields.carrierAmBestRating = raw.metadata.carrierAmBestRating;
  if (raw.metadata?.carrierAdmittedStatus) fields.carrierAdmittedStatus = raw.metadata.carrierAdmittedStatus;
  if (raw.metadata?.mga) fields.mga = raw.metadata.mga;
  if (raw.metadata?.underwriter) fields.underwriter = raw.metadata.underwriter;
  if (raw.metadata?.brokerAgency ?? raw.metadata?.broker) fields.brokerAgency = raw.metadata.brokerAgency ?? raw.metadata.broker;
  if (raw.metadata?.brokerContactName) fields.brokerContactName = raw.metadata.brokerContactName;
  if (raw.metadata?.brokerLicenseNumber) fields.brokerLicenseNumber = raw.metadata.brokerLicenseNumber;
  if (raw.metadata?.priorPolicyNumber) fields.priorPolicyNumber = raw.metadata.priorPolicyNumber;
  if (raw.metadata?.programName) fields.programName = raw.metadata.programName;
  if (raw.metadata?.isRenewal != null) fields.isRenewal = raw.metadata.isRenewal;
  if (raw.metadata?.isPackage != null) fields.isPackage = raw.metadata.isPackage;
  if (raw.metadata?.coverageForm) fields.coverageForm = raw.metadata.coverageForm;
  if (raw.metadata?.retroactiveDate) fields.retroactiveDate = raw.metadata.retroactiveDate;
  if (raw.metadata?.effectiveTime) fields.effectiveTime = raw.metadata.effectiveTime;
  if (raw.metadata?.insuredDba) fields.insuredDba = raw.metadata.insuredDba;
  if (raw.metadata?.insuredAddress) fields.insuredAddress = raw.metadata.insuredAddress;
  if (raw.metadata?.insuredEntityType) fields.insuredEntityType = raw.metadata.insuredEntityType;
  if (raw.metadata?.insuredFein) fields.insuredFein = raw.metadata.insuredFein;
  if (raw.additionalNamedInsureds?.length) fields.additionalNamedInsureds = raw.additionalNamedInsureds;
  if (raw.limits) fields.limits = raw.limits;
  if (raw.deductibles) fields.deductibles = raw.deductibles;
  if (raw.locations?.length) fields.locations = raw.locations;
  if (raw.vehicles?.length) fields.vehicles = raw.vehicles;
  if (raw.classifications?.length) fields.classifications = raw.classifications;
  if (raw.formInventory?.length) fields.formInventory = raw.formInventory;
  if (raw.taxesAndFees?.length) fields.taxesAndFees = raw.taxesAndFees;
```

- [ ] **Step 2: Update `mergeChunkedSections()` to merge new structured arrays**

Find the `mergeChunkedSections` function (around line 179). After the existing merge logic that combines sections and takes last non-null supplementary fields, add merging for the new arrays:

Add after the sections merge loop:

```typescript
  // Merge structured endorsements, exclusions, conditions from all chunks
  const allEndorsements: any[] = [];
  const allExclusions: any[] = [];
  const allConditions: any[] = [];

  for (const chunk of chunks) {
    if (chunk.endorsements?.length) allEndorsements.push(...chunk.endorsements);
    if (chunk.exclusions?.length) allExclusions.push(...chunk.exclusions);
    if (chunk.conditions?.length) allConditions.push(...chunk.conditions);
  }
```

And include them in the return object:

```typescript
  // Add to document object
  if (allEndorsements.length) result.document.endorsements = allEndorsements;
  if (allExclusions.length) result.document.exclusions = allExclusions;
  if (allConditions.length) result.document.conditions = allConditions;
```

- [ ] **Step 3: Update `applyExtractedQuote()` to include enriched quote fields**

Find `applyExtractedQuote` (around line 412). Add after existing mappings:

```typescript
  // Enriched quote fields (v1.2+)
  if (raw.metadata?.carrierLegalName) fields.carrierLegalName = raw.metadata.carrierLegalName;
  if (raw.metadata?.carrierNaicNumber) fields.carrierNaicNumber = raw.metadata.carrierNaicNumber;
  if (raw.metadata?.carrierAdmittedStatus) fields.carrierAdmittedStatus = raw.metadata.carrierAdmittedStatus;
  if (raw.metadata?.coverageForm) fields.coverageForm = raw.metadata.coverageForm;
  if (raw.metadata?.retroactiveDate) fields.retroactiveDate = raw.metadata.retroactiveDate;
  if (raw.metadata?.insuredAddress) fields.insuredAddress = raw.metadata.insuredAddress;
  if (raw.limits) fields.limits = raw.limits;
  if (raw.deductibles) fields.deductibles = raw.deductibles;
  if (raw.warrantyRequirements?.length) fields.warrantyRequirements = raw.warrantyRequirements;
  if (raw.taxesAndFees?.length) fields.taxesAndFees = raw.taxesAndFees;

  // Map enriched subjectivities
  if (raw.subjectivities?.length) {
    fields.enrichedSubjectivities = raw.subjectivities.map((s: any) => ({
      description: s.description,
      category: s.category ?? undefined,
      dueDate: s.dueDate ?? undefined,
      pageNumber: s.pageNumber ?? undefined,
    }));
  }

  // Map enriched underwriting conditions
  if (raw.underwritingConditions?.length) {
    fields.enrichedUnderwritingConditions = raw.underwritingConditions.map((c: any) => ({
      description: c.description,
      category: c.category ?? undefined,
      pageNumber: c.pageNumber ?? undefined,
    }));
  }
```

- [ ] **Step 4: Update `mergeChunkedQuoteSections()` to merge new arrays**

Find `mergeChunkedQuoteSections` (around line 460). Add exclusion merging similar to policy chunks:

```typescript
  const allExclusions: any[] = [];
  for (const chunk of chunks) {
    if (chunk.exclusions?.length) allExclusions.push(...chunk.exclusions);
  }
  if (allExclusions.length) result.document.exclusions = allExclusions;
```

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/extraction/pipeline.ts
git commit -m "feat: update pipeline to extract and merge enriched structured data

- applyExtracted/applyExtractedQuote map new metadata fields
- mergeChunkedSections merges endorsements, exclusions, conditions
- mergeChunkedQuoteSections merges exclusions and enriched subjectivities"
```

---

### Task 10: Update barrel exports

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add new type exports to `src/index.ts`**

Add the following export blocks after the existing document type exports (after line 13):

```typescript
// Types - Enums
export type {
  PolicyType,
  EndorsementType,
  ConditionType,
  PolicySectionType,
  QuoteSectionType,
  CoverageForm,
  CoverageTrigger,
  LimitType,
  DeductibleType,
  ValuationMethod,
  DefenseCostTreatment,
  EntityType,
  AdmittedStatus,
  AuditType,
  EndorsementPartyRole,
  ClaimStatus,
  SubjectivityCategory,
  DocumentType,
  ChunkType,
  RatingBasisType,
  VehicleCoverageType,
} from "./types/enums";

export { POLICY_TYPES } from "./types/enums";

// Types - Shared
export type {
  Address,
  Contact,
  FormReference,
  TaxFeeItem,
  RatingBasis,
  Sublimit,
  SharedLimit,
  ExtendedReportingPeriod,
  NamedInsured,
} from "./types/shared";

// Types - Declarations
export type {
  LimitSchedule,
  DeductibleSchedule,
  EmployersLiabilityLimits,
  InsuredLocation,
  InsuredVehicle,
  VehicleCoverage,
  ClassificationCode,
} from "./types/declarations";

// Types - Coverage
export type { EnrichedCoverage } from "./types/coverage";

// Types - Endorsement
export type { Endorsement, EndorsementParty } from "./types/endorsement";

// Types - Exclusion
export type { Exclusion } from "./types/exclusion";

// Types - Condition
export type { PolicyCondition } from "./types/condition";

// Types - Parties
export type { InsurerInfo, ProducerInfo } from "./types/parties";

// Types - Financial
export type { PaymentPlan, PaymentInstallment, LocationPremium } from "./types/financial";

// Types - Loss History
export type { LossSummary, ClaimRecord, ExperienceMod } from "./types/loss-history";

// Types - Underwriting
export type { EnrichedSubjectivity, EnrichedUnderwritingCondition, BindingAuthority } from "./types/underwriting";

// Types - Context Keys
export type { ContextKeyMapping } from "./types/context-keys";
export { CONTEXT_KEY_MAP } from "./types/context-keys";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export all new types from barrel index"
```

---

### Task 11: Build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS with no errors

- [ ] **Step 2: Run build**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run build`
Expected: PASS — tsup outputs ESM + CJS + types to dist/

- [ ] **Step 3: Verify build output includes new types**

Run: `cd /Users/terrywang/Repos/cl-sdk && ls dist/ && head -100 dist/index.d.ts | grep -c "export"`
Expected: dist/index.js, dist/index.mjs, dist/index.d.ts exist. Export count should be significantly higher than before.

---

## Phase 4: Reference Documents

These tasks produce the three reference documents specified in the design. They can be written in parallel with Phase 1-3 code tasks.

### Task 12: Write Data Dictionary document

**Files:**
- Create: `docs/data-dictionary.md`

- [ ] **Step 1: Write `docs/data-dictionary.md`**

Content: Take the Data Dictionary section from the design spec (`docs/superpowers/specs/2026-04-02-insurance-extraction-enhancement-design.md`, Deliverable 1) and expand it into a standalone reference document. Include:

- Header with purpose and how-to-use
- All 11 domains with complete field tables
- TypeScript interface references for each domain
- Business context key mapping table
- Shared types appendix

The document should be comprehensive enough that a developer can implement extraction logic from it alone.

- [ ] **Step 2: Commit**

```bash
git add docs/data-dictionary.md
git commit -m "docs: add comprehensive insurance data dictionary

Covers 11 domains with ~150+ fields: core metadata, declarations,
coverages, endorsements, exclusions, conditions, parties, financial,
underwriting, loss history, and business context storage."
```

---

### Task 13: Write Form Structure Guide document

**Files:**
- Create: `docs/form-structure-guide.md`

- [ ] **Step 1: Write `docs/form-structure-guide.md`**

Content: Take the Form Structure Guide section from the design spec and expand into a standalone reference. Include:

- Part 1: General structural patterns (CPP, monoline, quote structures with ASCII diagrams)
- Part 2: Intelligent chunking strategies (pre-scan, form-boundary, section-boundary, table-preservation)
- Part 3: ISO/ACORD form catalog (GL, property, auto, WC, umbrella, professional/management, ACORD certificates/applications)
- Structural signal detection table
- Chunking decision matrix by document type

- [ ] **Step 2: Commit**

```bash
git add docs/form-structure-guide.md
git commit -m "docs: add insurance form structure and chunking guide

Covers document composition patterns, structure-aware chunking
strategies, and ISO/ACORD form catalog across all major lines."
```

---

### Task 14: Write Line-of-Business Profiles document

**Files:**
- Create: `docs/line-of-business-profiles.md`

- [ ] **Step 1: Write `docs/line-of-business-profiles.md`**

Content: Take the 20 line-of-business profiles from the design spec and expand into a standalone reference. Each profile includes:

- Overview, key forms, declarations fields
- Coverage structure, common endorsements, standard exclusions
- Line-specific extraction notes and carrier variation warnings
- Business context mapping

- [ ] **Step 2: Commit**

```bash
git add docs/line-of-business-profiles.md
git commit -m "docs: add line-of-business profiles for 20 insurance lines

Each profile covers key forms, declarations fields, coverage structure,
endorsements, exclusions, extraction notes, and context mappings."
```

---

### Task 15: Final integration commit

**Files:** None (verification + commit)

- [ ] **Step 1: Run full typecheck**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run typecheck`
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `cd /Users/terrywang/Repos/cl-sdk && npm run build`
Expected: PASS

- [ ] **Step 3: Verify git status is clean**

Run: `cd /Users/terrywang/Repos/cl-sdk && git status`
Expected: Clean working tree (all changes committed)

- [ ] **Step 4: Review commit log**

Run: `cd /Users/terrywang/Repos/cl-sdk && git log --oneline -15`
Expected: All task commits visible in order
