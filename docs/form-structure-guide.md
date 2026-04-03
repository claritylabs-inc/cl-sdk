# Insurance Form Structure and Chunking Guide

**Version:** 1.0
**Last Updated:** 2026-04-02
**Scope:** Document organization patterns, intelligent chunking strategies, and ISO/ACORD form catalog for insurance extraction

---

## Purpose

This guide is the reference for understanding how insurance documents are physically organized, how the extraction pipeline should decompose them into processable chunks, and what standard forms appear in each type of document.

Use this guide when:
- **Writing or updating extraction prompts** — understanding which section contains which data
- **Implementing intelligent chunking** in `src/extraction/pipeline.ts` — knowing where form and section boundaries are
- **Debugging extraction failures** — identifying why a particular document structure confused the pipeline
- **Onboarding new lines of business** — checking what forms to expect for a given coverage type

---

## Part 1: General Structural Patterns

### 1.1 Commercial Package Policy (CPP)

The CPP is the most structurally complex insurance document. It combines multiple coverage parts under a single policy number, with a common declarations page that indexes the entire package.

```
Commercial Package Policy (CPP)
├── Common Policy Declarations (IL DS 00 09 or carrier equivalent)
│   ├── Named Insured, Mailing Address, Policy Period
│   ├── Business Description / Description of Operations
│   ├── Forms and Endorsements Schedule
│   │   └── Lists EVERY form in the entire policy (this is your document map)
│   └── Total Premium Summary
│
├── Coverage Part: Commercial General Liability
│   ├── CGL Declarations Page (CG DS 01)
│   │   ├── Limits of Insurance table
│   │   ├── Classification code table (code | description | basis | est. basis | rate | premium)
│   │   └── Retroactive date (if CG 00 02 claims-made)
│   ├── Coverage Form: CG 00 01 (Occurrence) or CG 00 02 (Claims-Made)
│   │   ├── Section I — Coverages
│   │   │   ├── Coverage A — Bodily Injury and Property Damage Liability
│   │   │   ├── Coverage B — Personal and Advertising Injury Liability
│   │   │   └── Coverage C — Medical Payments
│   │   ├── Section II — Who Is an Insured
│   │   ├── Section III — Limits of Insurance
│   │   ├── Section IV — Commercial General Liability Conditions
│   │   └── Section V — Definitions
│   └── GL Endorsements (in schedule order)
│       ├── Additional Insured endorsements
│       ├── Waiver of Subrogation endorsement
│       └── Other GL endorsements
│
├── Coverage Part: Commercial Property
│   ├── Property Declarations Page (CP DS 01)
│   │   ├── Location schedule (location # | address | building $ | BPP $ | BI $ | coinsurance%)
│   │   ├── Causes of Loss form designation (Basic/Broad/Special)
│   │   └── Valuation method (RC or ACV)
│   ├── Building and Personal Property Coverage Form (CP 00 10)
│   │   ├── A — Coverage (what is and is not covered)
│   │   ├── B — Exclusions
│   │   ├── C — Limits of Insurance
│   │   ├── D — Deductible
│   │   ├── E — Loss Conditions
│   │   ├── F — Additional Conditions
│   │   └── G — Optional Coverages
│   ├── Causes of Loss Form
│   │   ├── CP 10 10 (Basic) — named perils only
│   │   ├── CP 10 20 (Broad) — basic + additional named perils
│   │   └── CP 10 30 (Special) — open perils with named exclusions
│   ├── Business Income Form (CP 00 30, if included)
│   └── Property Endorsements
│
├── Coverage Part: Commercial Auto
│   ├── Auto Declarations Page (CA DS 03)
│   │   ├── Covered auto symbols
│   │   └── Vehicle schedule (vehicle # | year | make | model | VIN | coverages)
│   ├── Business Auto Coverage Form (CA 00 01)
│   │   ├── Section I — Covered Autos
│   │   ├── Section II — Liability Coverage
│   │   ├── Section III — Physical Damage Coverage
│   │   ├── Section IV — Business Auto Conditions
│   │   └── Section V — Definitions
│   ├── Vehicle Schedule (may be separate page)
│   └── Auto Endorsements
│
├── Coverage Part: Workers' Compensation (if included in package)
│   ├── Information Page / WC Declarations (WC 00 01)
│   │   ├── States covered (Part One)
│   │   ├── Classification table (state | class | description | payroll | rate | premium)
│   │   └── Experience modification factor
│   ├── WC and EL Policy Form (WC 00 00)
│   │   ├── Part One — Workers' Compensation Insurance
│   │   ├── Part Two — Employers' Liability Insurance
│   │   ├── Part Three — Other States Insurance
│   │   ├── Part Four — Your Duties if Injury Occurs
│   │   ├── Part Five — Premium
│   │   └── Part Six — Conditions
│   └── WC Endorsements
│
├── Common Policy Conditions (IL 00 17)
│   └── Applies to all coverage parts
├── Nuclear Energy Liability Exclusion (IL 00 21)
└── Terrorism Risk Insurance Act Disclosure
```

**Key extraction insight:** The Common Policy Declarations' forms schedule is the master index. It lists every form number and edition date in the policy. Parsing this schedule first gives you a complete inventory of what to expect in the rest of the document, enabling form-boundary aware chunking.

### 1.2 Monoline Policy Structure

A monoline policy covers a single line of business. Simpler structure; typically 10-50 pages.

```
Standalone (Monoline) Policy
├── Declarations Page
│   ├── Insured name, address, policy period
│   ├── Limits of insurance
│   ├── Premium (total and breakdown)
│   ├── Forms and endorsements schedule
│   └── Classification/rating data
├── Coverage Form
│   ├── Insuring Agreement(s)
│   │   └── What the insurer agrees to cover
│   ├── Exclusions
│   │   └── What is not covered
│   ├── Conditions
│   │   └── Rights and obligations of all parties
│   └── Definitions
│       └── Defined terms used throughout the form
├── Endorsement Schedule
│   └── List of all endorsements (form # | title | effective date)
├── Endorsements
│   └── Each endorsement is self-contained with its own form number
├── Application (sometimes attached)
│   └── The original submission application
└── Notices
    ├── State-required regulatory notices
    └── TRIA disclosure
```

### 1.3 Quote / Proposal Structure

Quotes are not policies — they have a different structure optimized for presentation rather than legal coverage definition. Quotes vary more across carriers than bound policies.

```
Quote / Proposal
├── Cover Letter / Transmittal (optional)
│   ├── Broker or carrier letterhead
│   ├── Addressed to: client name
│   ├── Subject: Quote reference number
│   └── Quote expiration date
├── Executive Summary / Coverage Summary
│   ├── Named insured, proposed policy period
│   ├── High-level coverage summary (may be one table)
│   └── Total premium indication
├── Coverage Terms (one section per line of business)
│   ├── Proposed limits and deductibles
│   ├── Coverage forms and endorsements that would be used
│   ├── Named exclusions or restrictions
│   └── Retroactive date (claims-made lines)
├── Premium Indication
│   ├── Premium breakdown by coverage part
│   ├── Taxes and fees
│   └── Total annual premium
├── Subjectivities
│   ├── Pre-binding requirements (must satisfy before binding)
│   ├── Post-binding requirements (due after binding)
│   └── Information requirements (needed for final pricing)
├── Underwriting Conditions / Warranties
│   └── Conditions that apply to the quote terms
├── Specimen Forms (sometimes)
│   └── Sample policy forms that would be attached at binding
└── Signature / Authorization Page (sometimes)
    └── Broker or carrier signature confirming quote terms
```

**Key extraction insight:** Quotes often lack explicit section headers. The pipeline must infer section boundaries from content patterns (premium tables, subjectivity lists, coverage description blocks) rather than labeled headers.

### 1.4 Management Liability Package Structure

D&O + EPLI + Fiduciary + Crime policies have a distinct modular structure:

```
Management Liability Package Policy
├── Declarations / Coverage Summary
│   ├── Shared policy aggregate limit
│   ├── Per-coverage-part limits and retentions
│   └── Claims-made periods (retroactive dates by part)
├── Common Terms and Conditions
│   ├── Definitions shared across parts
│   └── Claims reporting conditions
├── Coverage Part A: Directors & Officers
│   ├── Insuring Agreements (Side A, B, C, optionally D)
│   ├── Exclusions specific to D&O
│   └── D&O Conditions
├── Coverage Part B: Employment Practices Liability
│   ├── Insuring Agreement
│   ├── EPLI-specific exclusions
│   └── EPLI Conditions
├── Coverage Part C: Fiduciary Liability
│   ├── Insuring Agreement
│   ├── Fiduciary-specific exclusions
│   └── Fiduciary Conditions
├── Coverage Part D: Crime / Fidelity
│   ├── Insuring Agreements A through F (named perils)
│   └── Crime Conditions
└── Endorsements
    └── Modifications to any or all coverage parts
```

---

## Part 2: Structural Signal Detection

Before chunking, the extraction pipeline scans for structural signals that mark document boundaries. The following signals are reliable indicators of structure.

### 2.1 Structural Signal Reference Table

| Signal Pattern | What It Means | Extraction Action |
|----------------|---------------|-------------------|
| Form number in header or footer, e.g., `CG 00 01 04 13` | This page belongs to a specific form. The number uniquely identifies the form; the edition date identifies the version. | Record as form boundary; start new form extraction context |
| `THIS ENDORSEMENT CHANGES THE POLICY. PLEASE READ IT CAREFULLY.` | Beginning of an endorsement. This phrase is mandatory on ISO endorsements and common on carrier-specific forms. | Start new endorsement extraction; capture form number from this page's header |
| `DECLARATIONS` in page header or as a bold title | Declarations page for a coverage part. High-value structured data follows. | Switch to declarations extraction mode; expect tables of limits, premiums, schedules |
| Page numbering resets to `1` or `1 of N` (where N differs from surrounding pages) | New form begins. Each ISO form has its own page numbering (e.g., "Page 1 of 16" for CG 00 01). | Use as corroborating evidence of form boundary |
| Coverage part name as page header (e.g., `COMMERCIAL GENERAL LIABILITY`, `COMMERCIAL PROPERTY`) | This page belongs to a specific coverage part within a package. | Tag all subsequent pages with the coverage part until a new part header is found |
| `SCHEDULE` as a header, followed by a table | A structured schedule follows (locations, vehicles, classifications, endorsements). | Extract as table/records; do not split this table across chunks |
| `ENDORSEMENT SCHEDULE`, `FORMS AND ENDORSEMENTS`, `SCHEDULE OF FORMS` | List of all forms in the policy. | Extract as the document's form inventory |
| `SECTION I`, `SECTION II`, `SECTION III`, etc. | Major section boundary within a coverage form. | Note as section boundary for chunking decisions |
| `EXCLUSIONS` as a standalone header | Exclusions section. | Extract with `exclusions[]` schema; each labeled exclusion is a separate record |
| `CONDITIONS` as a standalone header | Conditions section. | Extract with `conditions[]` schema |
| `DEFINITIONS` as a standalone header | Definitions section. | Lower extraction priority — extract as reference only unless specific definition requested |
| `INFORMATION PAGE` | Workers' compensation declarations (NCCI standard). | Extract WC-specific fields: states, classifications, payroll, experience mod |
| `INSURING AGREEMENT` or `COVERAGE AGREEMENT` | The insuring agreement — core coverage grant. | Extract trigger type, coverage scope, territory |
| `IN WITNESS WHEREOF` or signature block | End of policy form. | Mark as form end boundary |
| `IMPORTANT NOTICE` or `POLICYHOLDER NOTICE` | State-mandated notice. | Low extraction priority; capture as notice text |

### 2.2 Endorsement Detection Signals

Beyond the mandatory `THIS ENDORSEMENT CHANGES THE POLICY` header, endorsements can also be detected by:

- **Form number pattern in header/footer**: ISO endorsements follow patterns like `CG XX XX MM YY` (where CG = line, XX XX = endorsement number, MM YY = edition month/year)
- **"NAMED INSURED" followed by a blank or schedule**: Indicates an endorsement with a named party schedule
- **"POLICY NUMBER" field on an otherwise non-declarations page**: Endorsement header repeating the policy number
- **Page numbering that appears independent** from surrounding pages

### 2.3 Table Detection Signals

Tables are the highest-value structured data in insurance documents. Never split a table across chunk boundaries.

| Table Type | Header Signals | Data Characteristics |
|------------|---------------|---------------------|
| Classification / rating table | `CLASS CODE`, `CLASSIFICATION CODE`, `CODE` | Multiple rows with code numbers, descriptions, dollar amounts |
| Location schedule | `LOCATION`, `LOC NO`, `PREMISES ADDRESS` | Multiple rows with addresses and dollar values |
| Vehicle schedule | `VEHICLE`, `VIN`, `YEAR MAKE MODEL` | Multiple rows with vehicle identifiers |
| Limits table | `LIMITS OF INSURANCE`, `COVERAGE AMOUNT`, `LIMIT` | Small table, typically 5-10 rows, dollar amounts |
| Endorsement schedule | `FORM NO`, `FORM NUMBER`, `ENDORSEMENT TITLE` | Multiple rows with form numbers and titles |
| Loss runs / claims table | `DATE OF LOSS`, `CLAIM NO`, `PAID`, `RESERVED` | Multiple rows with claim data |
| Premium breakdown | `PREMIUM`, `COVERAGE PART`, `TOTAL` | Multiple rows with coverage names and dollar amounts |

---

## Part 3: Intelligent Chunking Strategies

### 3.1 Current Baseline Approach

The current pipeline uses fixed page-count chunking with adaptive fallback:

- Primary: 15-page chunks
- First fallback: 10-page chunks (on JSON parse failure)
- Second fallback: 5-page chunks
- No awareness of document structure

This works for simple documents but fails for:
- Package policies where a 15-page chunk spans a coverage part boundary
- Endorsements where the chunk starts mid-endorsement
- Large schedules where a vehicle or location table is split across chunks

### 3.2 Proposed: Structure-Aware Chunking

The structure-aware approach adds a pre-scan pass before extraction chunking begins.

#### Phase 1: Pre-Scan (Before Extraction)

Scan all pages for structural signals to build a document map:

```typescript
interface DocumentMap {
  total_pages: number;
  has_form_numbers: boolean;      // True if ISO form numbers detected
  has_section_headers: boolean;   // True if SECTION I/II headers detected
  has_schedules: boolean;         // True if table/schedule content detected
  segments: DocumentSegment[];
}

interface DocumentSegment {
  type: "declarations" | "coverage_form" | "endorsement" | "schedule" | "conditions" | "notice" | "application" | "mixed";
  page_start: number;
  page_end: number;
  form_number?: string;           // e.g., "CG 00 01"
  edition_date?: string;          // e.g., "04 13"
  coverage_part?: string;         // e.g., "Commercial General Liability"
  title?: string;                 // e.g., "Additional Insured — Scheduled"
  confidence: "high" | "medium" | "low";  // How confident we are in this segmentation
}
```

Signals to scan for in pre-scan pass:
1. Form numbers in headers/footers (ISO pattern: `XX XX XX MM YY`)
2. Section headers (`DECLARATIONS`, `INSURING AGREEMENT`, `EXCLUSIONS`, `CONDITIONS`, `DEFINITIONS`)
3. Endorsement start markers (`THIS ENDORSEMENT CHANGES THE POLICY`)
4. Coverage part name headers
5. Page number resets (detected by comparing page numbering sequences)
6. Table headers (`SCHEDULE`, `LOCATION NO`, `VIN`, `CLASS CODE`, `DATE OF LOSS`)

#### Phase 2: Chunk by Structure

Once the document map is built, apply the chunking strategy appropriate to the detected structure:

**Strategy A: Form-Boundary Chunking** (use when `has_form_numbers == true`)

- Each form becomes its own chunk
- Exception: forms longer than 20 pages are split at section boundaries within the form
- Endorsements: each endorsement is a separate chunk (typically 1-3 pages)
- Declarations pages: always a separate chunk per coverage part
- Forms schedule / endorsement schedule: always a separate chunk

**Strategy B: Section-Boundary Chunking** (use when `has_form_numbers == false` but `has_section_headers == true`)

- Never split a major section (EXCLUSIONS, CONDITIONS, INSURING AGREEMENT) across chunks
- Keep logically related sections together: insuring agreement + definitions often belong in the same chunk
- Maximum section group size: 20 pages. If a section group exceeds 20 pages, split at subsection boundaries.

**Strategy C: Table-Preservation Chunking** (apply in combination with A or B when `has_schedules == true`)

- Identify all table boundaries before chunking
- If a proposed chunk boundary falls within a table, extend the chunk to include the complete table
- Exception: if extending would make the chunk exceed 25 pages, start a new chunk at the beginning of the table instead

**Strategy D: Fixed Page Chunking** (fallback when no structure detected)

- Current behavior: 15 → 10 → 5 page chunks
- Use when document map has low confidence across all segments

#### Phase 3: Chunk Metadata

Each chunk carries metadata that guides the extraction prompt:

```typescript
interface ExtractionChunk {
  pages: number[];
  chunk_type: "declarations" | "coverage_form" | "endorsement" | "schedule" | "conditions" | "notice" | "mixed";
  form_number?: string;        // e.g., "CG 00 01" — tells the extraction prompt which form this is
  edition_date?: string;       // e.g., "04 13"
  coverage_part?: string;      // e.g., "Commercial General Liability"
  context_hint?: string;       // Free-text hint for the extraction prompt, e.g., "This is the CGL declarations page. Extract limits, classification codes, and premium."
  is_endorsement: boolean;
  endorsement_type_hint?: string; // e.g., "additional_insured" — detected from form number or title
}
```

The `context_hint` is passed to the extraction prompt as additional context, allowing the prompt to specialize its extraction behavior for known form types without a separate prompt per form.

### 3.3 Chunking Decision Matrix

| Document Type | Typical Page Range | Primary Strategy | Typical Chunk Count | Special Considerations |
|---------------|-------------------|-----------------|--------------------|-----------------------|
| Commercial Package Policy | 50–200 pages | Form-boundary (A) | 10–40 chunks | Dec pages separate; each endorsement individual |
| Monoline GL Policy | 15–35 pages | Section-boundary (B) | 3–8 chunks | May fit in 2 chunks; watch for endorsements |
| Monoline Property Policy | 20–50 pages | Section-boundary (B) | 4–10 chunks | Location schedule table must not split |
| Monoline Auto Policy | 15–35 pages | Section-boundary (B) | 3–7 chunks | Vehicle schedule table must not split |
| WC Policy | 15–30 pages | Section-boundary (B) | 3–6 chunks | Classification table (state + codes) must not split |
| Professional Liability | 20–50 pages | Section-boundary (B) | 4–10 chunks | All carrier-proprietary; rely on content signals |
| Cyber Policy | 25–60 pages | Section-boundary (B) | 5–12 chunks | Sublimit schedule is a critical table |
| Management Liability Package | 40–100 pages | Section-boundary (B) | 8–20 chunks | Each coverage part is its own section group |
| Quote / Proposal | 5–20 pages | Section-boundary (B) | 1–4 chunks | Usually few enough for 1-2 chunks |
| Certificate (ACORD 25) | 1–2 pages | No chunking | 1 chunk | Highly standardized; single extraction pass |
| Endorsement-only document | 1–5 pages | No chunking | 1 chunk | Always process whole |
| Loss runs | 3–15 pages | Table-preservation (C) | 1–3 chunks | Claims table must not split |
| Umbrella / Excess | 20–50 pages | Section-boundary (B) | 4–10 chunks | Schedule of underlying is a critical table |
| BOP | 30–60 pages | Form-boundary or section (A or B) | 5–12 chunks | Some carriers use ISO BOP forms; others proprietary |

### 3.4 Adaptive Fallback Within Chunking

Even with structure-aware chunking, JSON parse failures will occur. The fallback hierarchy should be:

1. **First failure**: Re-split the failed chunk at the next detected section boundary (not mid-page)
2. **Second failure**: Reduce to 5-page fixed chunks for that segment
3. **Third failure**: Trigger the `sectionsFallback` model (currently configured for simpler prompts)
4. **Final fallback**: Return raw text for the failed section rather than empty structured data

---

## Part 4: ISO/ACORD Form Catalog

This section catalogs all standard forms by line of business. Form numbers help the extraction pipeline identify document structure, specialize extraction behavior, and correlate endorsements with their type.

### 4.1 Commercial General Liability Forms

#### Base Coverage Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **CG 00 01** | Commercial General Liability Coverage Form (Occurrence) | Coverage A (BI/PD), Coverage B (Personal/Advertising Injury), Coverage C (Medical Payments), Who Is An Insured, Limits, Conditions, Definitions | 16–20 |
| **CG 00 02** | Commercial General Liability Coverage Form (Claims-Made) | Same as CG 00 01 but claims-made trigger; adds retroactive date, extended reporting period provisions | 18–22 |
| **CG DS 01** | Commercial General Liability Declarations | Named insured, limits table, classification codes with premium basis, retroactive date (CG 00 02 only) | 1–2 |

#### Additional Insured Endorsements

| Form Number | Title | Notes |
|-------------|-------|-------|
| **CG 20 10** | Additional Insured — Owners, Lessees or Contractors — Scheduled Person or Organization | Named scheduled entities; ongoing operations only |
| **CG 20 26** | Additional Insured — Designated Person or Organization | General designated entity AI; broad application |
| **CG 20 33** | Additional Insured — Owners, Lessees or Contractors — Automatic Status When Required in Construction Agreement | Blanket AI for construction contracts; no schedule needed |
| **CG 20 37** | Additional Insured — Owners, Lessees or Contractors — Completed Operations | Adds AI for completed operations (often paired with CG 20 10) |
| **CG 20 38** | Additional Insured — Managers or Lessors of Premises | AI for property management and leasing relationships |

#### Waiver / Primary / Non-Contributory Endorsements

| Form Number | Title | Notes |
|-------------|-------|-------|
| **CG 24 04** | Waiver of Transfer of Rights of Recovery Against Others to Us | Waiver of subrogation; requires scheduled entity or blanket version |
| **CG 20 01** | Primary and Noncontributory — Other Insurance Condition | Makes GL coverage primary and non-contributory (older edition) |

#### Exclusion Endorsements

| Form Number | Title | Notes |
|-------------|-------|-------|
| **CG 21 06** | Exclusion — Access or Disclosure of Confidential or Personal Information | Excludes data breach-related BI/PD and P&AI claims |
| **CG 21 39** | Contractual Liability — Railroads | Restricts contractual liability extension |
| **CG 21 67** | Exclusion — Fungi or Bacteria | Excludes mold/fungus claims |
| **CG 21 86** | Exclusion — Exterior Insulation and Finish Systems | EIFS exclusion for contractors |
| **CG 21 96** | Silica or Silica-Related Dust Exclusion | Common for contractors working with silica-containing materials |

#### Aggregate Management Endorsements

| Form Number | Title | Notes |
|-------------|-------|-------|
| **CG 25 03** | Designated Construction Project(s) General Aggregate Limit | Project-specific aggregate (construction) |
| **CG 25 04** | Designated Location(s) General Aggregate Limit | Location-specific aggregate (multi-location risks) |
| **CG 25 08** | Designated Ongoing Operations — Products-Completed Operations Aggregate Limit | Separate products aggregate per project |

#### Broadening and Amendatory Endorsements

| Form Number | Title | Notes |
|-------------|-------|-------|
| **CG 04 26** | Amendment of Insured Contract Definition | Broadens contractual liability |
| **CG 24 17** | Contractual Liability — Railroads | Extends contractual to certain railroad operations |
| **CG 04 13** | Contractors Special Conditions — Pollution Liability — Broadened Coverage | Limited pollution buyback |

### 4.2 Commercial Property Forms

#### Building and Personal Property Coverage

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **CP 00 10** | Building and Personal Property Coverage Form | Covered property, additional coverages (debris removal, preservation, fire dept service charge, pollutant cleanup), coverage extensions (newly acquired property, personal effects, valuable papers), exclusions, limits, deductible, loss conditions | 12–16 |
| **CP 00 30** | Business Income (and Extra Expense) Coverage Form | BI + extra expense, period of restoration, extended period of indemnity | 8–10 |
| **CP 00 32** | Business Income (Without Extra Expense) Coverage Form | BI only | 6–8 |
| **CP 00 40** | Legal Liability Coverage Form | Damage to property of others in insured's care, custody, or control | 6–8 |
| **CP 00 90** | Commercial Property Conditions | Common conditions applicable to all property forms | 4–5 |
| **CP DS 01** | Commercial Property Declarations | Location schedule with building values, BPP values, BI limits, coinsurance percentages, valuation methods | 1–3 |

#### Causes of Loss Forms

| Form Number | Title | Perils Covered | Typical Pages |
|-------------|-------|----------------|---------------|
| **CP 10 10** | Causes of Loss — Basic Form | Fire, lightning, explosion, windstorm/hail, smoke, aircraft/vehicles, riot, vandalism, sprinkler leakage, sinkhole collapse, volcanic action | 4–6 |
| **CP 10 20** | Causes of Loss — Broad Form | All Basic perils plus: falling objects, weight of snow/ice, water damage (from appliances), collapse | 6–8 |
| **CP 10 30** | Causes of Loss — Special Form | All-risk (open perils): all causes not specifically excluded. Major exclusions include flood, earthquake, ordinance/law, faulty workmanship, mechanical breakdown | 10–14 |
| **CP 10 32** | Causes of Loss — Special Form (Water Exclusion Endorsement) | Modifies Special Form to add or clarify flood exclusion | 2–3 |

#### Endorsements

| Form Number | Title | Notes |
|-------------|-------|-------|
| **CP 04 02** | Ordinance or Law Coverage | Pays for code upgrades required after a covered loss |
| **CP 12 18** | Loss Payable Provisions | Adds loss payee, lender's loss payee, contract of sale conditions |
| **CP 15 08** | Equipment Breakdown | Adds equipment/machinery breakdown coverage |
| **CP 01 40** | Protective Safeguards | Conditions coverage on maintaining alarms/sprinklers; can void coverage if requirement not met |
| **CP 04 05** | Windstorm or Hail Exclusion | Used in high-wind states to exclude wind/hail |
| **CP 04 17** | Earthquake and Volcanic Eruption | Adds earthquake coverage (not included in any causes of loss form) |
| **CP 99 04** | Value Reporting Form | For businesses with fluctuating inventory; requires periodic value reports |

### 4.3 Commercial Auto Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **CA 00 01** | Business Auto Coverage Form | Covered auto symbols, liability, physical damage (comprehensive + collision), UM/UIM, hired/non-owned auto, conditions, definitions | 10–14 |
| **CA DS 03** | Business Auto Declarations | Vehicle schedule, covered auto symbols, limits, physical damage deductibles | 2–4 |
| **CA 00 12** | Garage Coverage Form | For auto dealers and service operations | 12–16 |
| **CA 20 48** | Designated Insured | Extends insured status to named entity for liability only |
| **CA 04 44** | Hired Auto Physical Damage Coverage | Covers physical damage for hired/rented vehicles |
| **CA 99 10** | Auto Dealers Supplementary Schedule | Additional coverage options for dealerships |
| **MCS-90** | Motor Carrier Act Endorsement | Federally mandated endorsement for for-hire interstate truckers |
| **CA 99 48** | Pollution Liability — Broadened Coverage for Covered Autos | Limited pollution coverage for auto liability |

**Auto Symbol Reference** (critical for extraction):

| Symbol | Description |
|--------|-------------|
| 1 | Any Auto |
| 2 | Owned Autos Only |
| 3 | Owned Private Passenger Autos Only |
| 4 | Owned Autos Other Than Private Passenger |
| 5 | Owned Autos Subject to No-Fault |
| 6 | Owned Autos Subject to Compulsory UM Law |
| 7 | Specifically Described Autos (listed on schedule) |
| 8 | Hired Autos Only |
| 9 | Nonowned Autos Only |
| 19 | Mobile Equipment Subject to Compulsory or Financial Responsibility Law |

### 4.4 Workers' Compensation Forms

| Form Number | Title | Key Content | Typical Pages |
|-------------|-------|-------------|---------------|
| **WC 00 00 00** | Workers' Compensation and Employers' Liability Insurance Policy | Part One (WC statutory), Part Two (EL: each accident, disease-policy, disease-each employee), Part Three (other states), Part Four (duties after injury), Part Five (premium), Part Six (conditions) | 8–12 |
| **WC 00 01 01** | Information Page (Declarations) | States listed, classification codes with payroll and rates, total premium, experience mod | 2–4 |
| **WC 00 03 01** | Alternate Employer Endorsement | Extends WC to temporary/leased employee relationships |
| **WC 00 03 04** | Waiver of Our Right to Recover From Others | WC waiver of subrogation |
| **WC 00 03 10** | Voluntary Compensation and Employers' Liability Coverage | For employees not subject to WC statute |
| **WC 00 04 01** | Broad Form All States Endorsement | Extends coverage to all states not listed in Part One |

**WC Classification Codes** (NCCI system used in most states; some states have independent bureaus):
- Each class code is a 4-digit number (e.g., "8810" for clerical office employees, "5403" for carpentry)
- Each state has its own rate per $100 of payroll per class code
- The classification table is one of the highest-value structured tables in any WC policy

**Monopolistic State Fund States** (no private WC carriers): Ohio (BWC), Washington (L&I), Wyoming (WCD), North Dakota (WSI). Policies from these states have different formats — they are issued by the state fund, not private carriers.

### 4.5 Umbrella and Excess Liability Forms

Umbrella and excess forms are predominantly carrier-proprietary. No ISO standard base forms exist. Key structural elements to look for regardless of carrier:

**Standard sections present in virtually all umbrella/excess policies:**

| Section | Content |
|---------|---------|
| Declarations | Per occurrence limit, aggregate limit, self-insured retention, total premium |
| Schedule of Underlying Insurance | Table of all underlying policies (carrier, policy number, type, limits) — critical data |
| Insuring Agreement | Following-form vs self-contained language; drop-down provision |
| Who Is An Insured | Often same as underlying but may expand or restrict |
| Exclusions | War, professional services, pollution, workers comp (standard); others vary by carrier |
| Conditions | Maintenance of underlying limits, other insurance, cooperation |
| Definitions | May align with or differ from underlying policy definitions |

**Following-form vs self-contained** is the most important structural distinction:
- **Following-form excess**: The exclusions, conditions, and definitions of the underlying policy apply. Must read the underlying policy to understand what the excess covers.
- **Self-contained umbrella**: Has its own insuring agreement, exclusions, and conditions. May cover claims not covered by underlying (drop-down), but may also have different exclusions.

### 4.6 Professional and Management Liability Forms

All professional and management liability forms are carrier-proprietary. No ISO standard forms. Common structural patterns:

| Line | Typical Structure | Critical Fields to Extract |
|------|------------------|---------------------------|
| **Professional Liability / E&O** | Declarations, Insuring Agreement (claims-made), Exclusions, Conditions, Definitions | Retroactive date, "Professional services" definition (verbatim), defense cost treatment, ERP options |
| **Cyber** | Declarations, Coverage Schedule (with sublimits), First-Party Coverage Form, Third-Party Coverage Form, Conditions | All sublimits, waiting period, retroactive date, war exclusion language (varies significantly) |
| **D&O** | Declarations, Side A Insuring Agreement, Side B Insuring Agreement, Side C Insuring Agreement, Exclusions, Conditions | Side A/B/C limits and retentions (Side A often zero retention), continuity date, insured vs insured exclusion scope |
| **EPLI** | Declarations, Insuring Agreement, Exclusions (especially wage & hour), Conditions | Retroactive date, wage & hour exclusion status, third-party coverage endorsement status |
| **Fiduciary** | Declarations, Insuring Agreement, Exclusions, Conditions | ERISA plan schedule, voluntary correction program coverage |
| **Crime** | Declarations, Insuring Agreements A–F (named perils), Conditions, Definitions | Per-agreement limits and deductibles, social engineering sublimit, discovery vs loss-sustained form type |

### 4.7 ACORD Certificates and Applications

ACORD forms are highly standardized. The same form number has the same structure from any carrier or broker.

#### Certificate Forms

| Form Number | Title | Purpose | Key Data |
|-------------|-------|---------|---------|
| **ACORD 25** | Certificate of Liability Insurance | Proof of GL, auto, umbrella, WC coverage | Insured name, carrier, policy numbers, limits, effective/expiration dates, certificate holder, additional insured status, waiver of subrogation status |
| **ACORD 27** | Evidence of Property Insurance | Proof of property coverage (for lenders) | Insured, carrier, policy number, property location, coverage amount, mortgagee |
| **ACORD 28** | Evidence of Commercial Property Insurance | Detailed property evidence (lender use) | Detailed location and coverage data |
| **ACORD 101** | Additional Remarks Schedule | Overflow or additional information attached to any ACORD form | Free-form text continuation |

**ACORD 25 structure** (the most common certificate):
```
ACORD 25 Certificate of Liability Insurance
├── Date Issued
├── Producer Contact Information
├── Insured Name and Address
├── Coverage Grid (one row per coverage type)
│   ├── Column: Insurance Type (Commercial GL, Auto, Umbrella/Excess, WC/EL)
│   ├── Column: Insr Type (coverage form indicator)
│   ├── Column: Addl Insr (Y/N)
│   ├── Column: Subr Wvd (Y/N — waiver of subrogation)
│   ├── Column: Policy Number
│   ├── Column: Eff Date
│   ├── Column: Exp Date
│   └── Column: Limits (by type)
├── Description of Operations / Locations / Vehicles / Exclusions
│   └── Free-form text; often contains additional insured name and scope
└── Certificate Holder
    └── Entity requiring the certificate
```

#### Application Forms

| Form Number | Title | Purpose |
|-------------|-------|---------|
| **ACORD 125** | Commercial Insurance Application | Master application; general business information applicable to all commercial lines |
| **ACORD 126** | Commercial General Liability Section | GL-specific questions (operations, prior losses, contractor relationships) |
| **ACORD 127** | Cyber Liability Coverage Section | Cyber-specific questions (data volumes, security controls, incident history) |
| **ACORD 130** | Workers Compensation Application | WC-specific questions (states, payroll, safety programs, experience mod) |
| **ACORD 131** | Umbrella/Excess Application | Umbrella-specific questions (underlying schedule, operations, prior losses) |
| **ACORD 137** | Commercial Auto Section | Auto-specific questions (drivers, vehicles, prior accidents, DOT) |
| **ACORD 140** | Property Section | Property-specific questions (locations, construction, values, protection) |

**Important note for auto-fill:** When the extraction pipeline reads an ACORD application attached to a policy, the field IDs on those forms are predictable. The data dictionary context keys are designed to map directly to ACORD field names.

### 4.8 London Market Forms

Some specialty risks (ocean marine, some excess, aviation, energy) are placed in the London market and use different form structures:

| Form | Description |
|------|-------------|
| **MAR 91** | Marine policy slip (standard Lloyd's marine form) |
| **Institute Cargo Clauses A** | All-risk cargo coverage (London) |
| **Institute Cargo Clauses B** | Named perils cargo coverage |
| **Institute Cargo Clauses C** | Minimal named perils cargo coverage |
| **Institute War Clauses (Cargo)** | War risks for marine cargo |
| **Lloyds Open Cover** | Blanket marine cargo policy |

**Key difference from US forms**: London market certificates and slips use "slip language" rather than standardized form numbers. Policy terms are often written in manuscript on a slip, then incorporated by reference. Extraction from London market documents requires reliance on section headers and content analysis rather than form number detection.

---

## Part 5: Form Number Pattern Reference

Use these patterns in the pre-scan pass to detect and classify forms:

| Pattern | Line / Type |
|---------|------------|
| `CG XX XX` or `CG XX XX MM YY` | Commercial General Liability |
| `CP XX XX` or `CP XX XX MM YY` | Commercial Property |
| `CA XX XX` or `CA XX XX MM YY` | Commercial Auto |
| `WC XX XX XX` or `WC XX XX XX X` | Workers' Compensation |
| `IL XX XX` or `IL XX XX MM YY` | Common Policy (Interline) — applies across all lines |
| `IM XX XX` | Inland Marine |
| `CR XX XX` | Crime |
| `CU XX XX` | Commercial Umbrella (some carriers use ISO umbrella forms) |
| `MH XX XX` | Homeowners (residential — not commercial) |
| `ACORD XXX` | ACORD standardized form |
| `MCS-90` | Motor Carrier endorsement (federal) |

**ISO edition date format:** The two-digit pairs after the form number are MM YY (month, year). For example, `CG 00 01 04 13` = Commercial General Liability Coverage Form, April 2013 edition. This matters because different editions have materially different terms (e.g., the 2004 CG 00 01 removed the "your work" exclusion exception for subcontractors).

**Carrier-specific form numbers:** Carriers that file their own forms (non-ISO) typically use patterns like `[CARRIER CODE] GL 001 05/22` or `[STATE][LINE][SEQUENCE]`. These cannot be pre-identified from a form number catalog, but the section header structure is usually similar to ISO.

---

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
