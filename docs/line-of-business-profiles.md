# Line-of-Business Profiles

**Version:** 1.0
**Last Updated:** 2026-04-02
**Scope:** Extraction profiles for all 20 lines of business supported by the CL-0 SDK

---

## Purpose

Each profile in this document provides a complete reference for extracting one line of insurance. Use these profiles when:

- **Writing extraction prompts** — each profile defines exactly which fields to request and from which sections
- **Diagnosing extraction failures** — carrier variation warnings explain common surprises
- **Implementing business context mapping** — each profile ends with a context key mapping table
- **Training the agent system** — profiles define what structured data is available to agent prompts for each line

Profiles reference field names from the [Data Dictionary](./data-dictionary.md) and form numbers from the [Form Structure Guide](./form-structure-guide.md). A reader of this document does not need to reference either of those documents to implement extraction for a given line.

---

## Profile 1: General Liability (GL)

### Overview

Commercial General Liability is the broadest commercial liability coverage and the most frequently placed line. It covers bodily injury and property damage liability arising from business operations, products, and completed work. GL is the "foundation" line — almost all other liability lines are built on top of it or adjacent to it.

GL is usually written as part of a Commercial Package Policy (CPP) but can be placed as a monoline. The standard ISO coverage form is either occurrence-trigger (CG 00 01) or claims-made trigger (CG 00 02).

**PolicyType enum value:** `"general_liability"`

### Key Forms

| Form | Purpose |
|------|---------|
| **CG 00 01 04 13** | Occurrence coverage form (current ISO edition) |
| **CG 00 02 04 13** | Claims-made coverage form (current ISO edition) |
| **CG DS 01** | CGL Declarations page |
| **CG 20 10, 20 26, 20 33, 20 37** | Additional insured endorsements (see below) |
| **CG 24 04** | Waiver of subrogation |
| **CG 25 03, 25 04** | Project and location aggregate endorsements |
| **IL 00 17** | Common policy conditions (applies to entire package) |

### Declarations Fields

The CGL declarations page is structured and highly reliable. Extract all of these fields:

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per occurrence limit | high | Usually $1M, $2M, or $3M for most commercial insureds |
| General aggregate limit | high | Usually 2× per occurrence |
| Products/completed operations aggregate | high | Separate from general aggregate |
| Personal and advertising injury limit | high | Per person/organization |
| Damage to premises rented to you | high | Fire legal liability (e.g., $100K, $300K) |
| Medical expense limit | medium | Per person (e.g., $5K, $10K) |
| Classification codes table | high | Each row: code number, description, premium basis, estimated basis amount, rate, premium |
| Retroactive date | high (CG 00 02 only) | Required for claims-made; verify "None" vs a specific date |
| Total GL premium | high | |

### Coverage Structure

- **Coverage A — Bodily Injury and Property Damage Liability**: The core coverage. Pays for BI and PD claims arising from covered operations. Occurrence trigger (CG 00 01) or claims-made trigger (CG 00 02). Defense costs are supplementary (outside limits).
- **Coverage B — Personal and Advertising Injury Liability**: Covers offenses including libel, slander, copyright infringement, invasion of privacy, wrongful eviction. Offense-based trigger (not occurrence or claims-made).
- **Coverage C — Medical Payments**: First-aid medical costs for injuries on insured premises or arising from operations, regardless of fault. Per-person limit, accident trigger.
- **Territory**: Typically US, territories, possessions, and Canada for Coverage A; worldwide for products sold or made in the US.

### Common Endorsements by Category

**Additional Insured (most frequently required):**
- `CG 20 10` — Scheduled AI, ongoing operations only (most common for contractors)
- `CG 20 26` — Designated person or organization (general AI, broader)
- `CG 20 33` — Blanket AI, ongoing operations, per written contract (no schedule needed)
- `CG 20 37` — Completed operations (often paired with CG 20 10 for construction)
- `CG 20 38` — Managers or lessors of premises

**Subrogation:**
- `CG 24 04` — Waiver of subrogation (scheduled entity or blanket)

**Primary/Non-Contributory:**
- `CG 20 01` — Primary and noncontributory (older)
- Carrier-specific endorsement amending the Other Insurance condition

**Exclusion Endorsements (watch for these):**
- `CG 21 06` — Excludes data breach/personal information claims from GL (very common post-2014)
- `CG 21 67` — Fungi/bacteria exclusion
- `CG 21 86` — EIFS exclusion (exterior insulation on buildings)
- `CG 21 96` — Silica exclusion (common for contractors)
- Pollution exclusion endorsements (carrier-specific buyback or full exclusion)

**Aggregate Management:**
- `CG 25 03` — Project-specific aggregate (each construction project gets its own aggregate)
- `CG 25 04` — Location-specific aggregate (each location gets its own aggregate)

### Standard Exclusions in Base Form

These exclusions are standard in CG 00 01/02 and their presence is expected:
- Expected or intended injury
- Contractual liability (with exception for "insured contracts")
- Liquor liability (unless coverage purchased)
- Workers compensation and employers liability
- Pollution (absolute exclusion in base form; buybacks common)
- Aircraft, auto (owned), and watercraft (owned)
- Mobile equipment (covered under auto or inland marine)
- War
- Professional services (when a professional services exclusion endorsement is attached)
- Product recall (no coverage for recall costs; only resulting BI/PD)

### Extraction Notes

**Classification code table:** This table is the most information-dense part of the GL declarations. Each row represents a rating classification. The columns are: class code number | description | premium basis (payroll or revenue) | estimated basis amount | rate per unit | classification premium. Always extract this full table, not just the summary totals.

**Blanket vs scheduled endorsements:** Additional insured endorsements may be scheduled (list of specific entities on the endorsement form) or blanket (endorsement applies to any entity required by a written contract). Blanket endorsements have no schedule to extract — note them as type `blanket_additional_insured`.

**Carrier-specific GL forms:** Many carriers file their own GL forms rather than using ISO CG 00 01. These forms follow similar section numbering (Coverage A, B, C; Sections I–V) but may have different exclusion language. The extraction schema is the same; rely on section headers rather than form numbers.

**Products vs operations claims:** GL aggregates work differently for products/completed ops vs general liability. The products/completed ops aggregate and general aggregate are separate pools. Always extract both.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `classifications[].description` | `description_of_operations` | `operations` |
| `classifications[].basis_amount` (payroll basis) | `annual_payroll` | `financial` |
| `classifications[].basis_amount` (revenue basis) | `annual_revenue` | `financial` |
| `locations[].address` | `premises_addresses` | `premises` |
| `limits.per_occurrence` | `current_gl_per_occ_limit` | `coverage` |
| `limits.general_aggregate` | `current_gl_aggregate_limit` | `coverage` |
| `carrier` | `gl_carrier` | `coverage` |
| `policy_number` | `gl_policy_number` | `coverage` |

---

## Profile 2: Commercial Property

### Overview

Commercial property covers physical loss or damage to the insured's buildings, business personal property, and lost income from covered causes of loss. The three key variables that determine scope are: (1) causes of loss form (basic/broad/special), (2) valuation method (replacement cost vs ACV), and (3) coinsurance percentage.

**PolicyType enum value:** `"commercial_property"`

### Key Forms

| Form | Purpose |
|------|---------|
| **CP 00 10** | Building and Personal Property Coverage Form |
| **CP 00 30** | Business Income and Extra Expense |
| **CP 10 10/20/30** | Causes of Loss (Basic/Broad/Special) |
| **CP DS 01** | Property Declarations |
| **CP 04 02** | Ordinance or Law Coverage |
| **CP 12 18** | Loss Payable Provisions |
| **CP 15 08** | Equipment Breakdown |

### Declarations Fields

The property declarations page centers on the location schedule. Extract:

| Field | Reliability | Notes |
|-------|-------------|-------|
| Location number | high | Sequential per location |
| Location address | high | Full street address |
| Building limit (Cov A) | high | Replacement cost or ACV of building |
| Business personal property (Cov B) | high | Contents/equipment value |
| Business income/extra expense limit | medium | Not always present; may be separate form |
| Causes of loss form | high | "Basic", "Broad", "Special" — always extract |
| Coinsurance percentage | high | 80%, 90%, or 100% — always extract; affects claim payment |
| Valuation method | high | "RC" (replacement cost) or "ACV" (actual cash value) — always extract |
| Deductible | high | Per occurrence; may be flat dollar or percentage of loss |
| Total property premium | high | |

### Coverage Structure

- **Coverage A — Building**: The building structure, fixtures, permanently installed machinery and equipment, outdoor fixtures, personal property used to service/maintain the building.
- **Coverage B — Your Business Personal Property**: Furniture, fixtures, equipment, stock, tenant improvements, labor/materials/services, leased property you are responsible for.
- **Coverage C — Personal Property of Others**: Property of others in the insured's care, custody, or control.
- **Business Income (CP 00 30)**: Pays for lost net income plus continuing expenses (payroll, rent) during the period of restoration after a covered loss. Extended period of indemnity available.
- **Extra Expense**: Additional costs incurred to minimize the suspension of operations (e.g., renting temporary space, overtime wages).

**Additional Coverages** (included in base form, sublimited):
- Debris removal (25% of loss + $25K)
- Preservation of property (30 days)
- Fire department service charge ($1K–$2.5K)
- Pollutant cleanup from covered cause of loss (10% of limits, $10K min)

**Coverage Extensions** (included, typically limited):
- Newly acquired property (30 days, capped)
- Personal effects of officers/employees (capped)
- Valuable papers and records (capped)
- Property off-premises (capped)
- Outdoor property (named perils, capped)

### Common Endorsements

| Endorsement | Purpose |
|-------------|---------|
| **CP 04 02** | Ordinance or Law — pays for code upgrades required when rebuilding after loss |
| **CP 12 18** | Loss Payable Provisions — adds loss payee, lender's loss payee (mortgagee) |
| **CP 15 08** | Equipment Breakdown — mechanical/electrical equipment failure (not a "cause of loss") |
| **CP 01 40** | Protective Safeguards — requires maintaining alarms/sprinklers; endorsement can void coverage |
| **CP 04 05** | Windstorm or Hail Exclusion — common in coastal or high-wind states |
| **CP 04 17** | Earthquake and Volcanic Eruption — adds earthquake coverage (always excluded in base form) |
| **Agreed Value** | Waives coinsurance requirement for specified value; extract agreed value amounts |
| **Inflation Guard** | Automatically increases limits by a percentage annually |
| **CP 99 04** | Value Reporting — for businesses with fluctuating inventory values |
| **Flood Exclusion** | May be added to clarify flood is excluded (base form excludes it, but endorsement adds specificity) |

### Standard Exclusions in Base Form

- Earth movement (earthquake)
- Water (flood, surface water, backed-up sewer/drain)
- Governmental action
- Nuclear hazard
- War
- Utility services failure (power outage)
- Faulty workmanship / design defect
- Mechanical breakdown (not covered; add CP 15 08)
- Ordinance or law (not covered; add CP 04 02)
- Collapse (limited coverage under Broad/Special; excluded under Basic)

### Extraction Notes

**Location schedule is the anchor:** For multi-location risks, the location schedule may span multiple pages. Never split this table across chunks. The table columns (location number, address, building value, BPP value, coinsurance %, valuation, deductible) must all be captured for each row.

**Causes of loss form matters enormously:** "Special" (open perils) is far broader than "Basic" or "Broad". Always extract which form applies. Some policies have different causes of loss forms for different locations.

**Coinsurance penalty:** If the property is insured for less than the coinsurance percentage of its value at the time of loss, the insured bears a proportional share of the loss. Always extract the coinsurance percentage for every location.

**Valuation method at loss:** RC (replacement cost) pays to replace with new; ACV deducts depreciation. This is one of the most material distinctions in property insurance. Some policies use RC for buildings and ACV for contents.

**Equipment breakdown:** CP 15 08 is a separate form that adds mechanical/electrical breakdown coverage. It is often included in BOP policies but must be explicitly added to commercial property. Extract whether it is present.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `locations[].address` (all) | `all_locations` | `premises` |
| `locations[].building_value` (sum) | `total_property_values` | `financial` |
| `locations[].contents_value` (sum) | `total_contents_values` | `financial` |
| `locations[].construction_type` | `construction_type` | `premises` |
| `locations[].year_built` | `year_built` | `premises` |
| `locations[].sprinklered` | `sprinkler_system` | `premises` |
| `locations[].protection_class` | `protection_class` | `premises` |
| `locations[].square_footage` | `total_square_footage` | `premises` |

---

## Profile 3: Commercial Auto

### Overview

Commercial auto covers liability and physical damage for vehicles used in business. The "symbol system" is the unique structural feature of commercial auto — instead of listing every vehicle, the policy uses numbered symbols to define which vehicles are covered for which coverages.

**PolicyType enum value:** `"commercial_auto"`

### Key Forms

| Form | Purpose |
|------|---------|
| **CA 00 01** | Business Auto Coverage Form |
| **CA DS 03** | Business Auto Declarations |
| **CA 20 48** | Designated Insured |
| **CA 04 44** | Hired Auto Physical Damage |
| **MCS-90** | Motor Carrier Act Endorsement (for-hire interstate) |

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Covered auto symbols (per coverage) | high | Critical — see symbol table in Form Structure Guide |
| Vehicle schedule (VIN, year, make, model) | high | Each vehicle is a row |
| Coverage per vehicle (liability, comp, collision) | high | May be per-vehicle or blanket |
| CSL or split limits | high | CSL: one limit; split: BI/person, BI/accident, PD |
| Physical damage deductibles (comp, collision) | high | Per vehicle or blanket |
| UM/UIM limits | medium | Often same as liability limit |
| Hired auto / non-owned auto | high | May be included (symbols 8/9) or endorsed |
| Total auto premium | high | |

### Coverage Structure

- **Section I — Covered Autos**: Defined by symbols. Symbols 1 (any auto) through 9 (non-owned) determine which vehicles each coverage applies to. Symbol 7 (specifically described) requires the vehicle schedule.
- **Section II — Liability Coverage**: Pays for BI and PD the insured is legally obligated to pay arising from use of a covered auto. Defense costs included. CSL or split limits.
- **Section III — Physical Damage Coverage**: Comprehensive (non-collision), collision, and specified causes of loss. Per-vehicle deductibles.
- **Section IV — Business Auto Conditions**: Duties after accident/loss, cooperation, legal action against us, other insurance.

**Hired Auto**: Coverage for autos leased, hired, or rented by the insured. Must be designated by symbol 8 or by endorsement.

**Non-Owned Auto**: Coverage for autos the insured doesn't own (employees' personal vehicles used for business). Must be designated by symbol 9 or by endorsement.

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| **CA 20 48** | Designated Insured — extends insured status to named entity; used when a customer or client requires AI status |
| **CA 04 44** | Hired Auto Physical Damage — adds physical damage coverage for hired/rented autos |
| **MCS-90** | Federally mandated for for-hire interstate motor carriers; endorses minimum limits regardless of other policy provisions |
| Drive Other Car Coverage | Covers officers/owners while driving non-owned personal vehicles for business |
| Individual Named Insured | Extends personal auto-type coverage to a specific individual |
| CA 99 48 | Pollution Liability Broadened Coverage — limited pollution coverage for auto liability |

### Extraction Notes

**Symbol extraction is critical:** The symbols assigned to each coverage (liability, physical damage, UM/UIM) define the breadth of coverage. Symbol 1 (any auto) is the broadest. Always extract symbols per coverage section.

**Split limits vs CSL:** Some policies use split limits (separate BI/person, BI/accident, PD limits) rather than a combined single limit. Extract all three split limits or the CSL as applicable.

**MCS-90:** The Motor Carrier Act endorsement is federally mandated for trucks that operate in interstate commerce for hire. It obligates the insurer to pay minimum limits even if the policy would otherwise deny coverage. Always flag its presence.

**Hired/non-owned in GL vs auto:** Non-owned auto liability coverage can be in the GL policy (as a coverage extension or endorsement) or in the commercial auto policy. Cross-reference both policies when doing coverage analysis.

**For-hire trucking:** Large fleets with interstate operations have additional regulatory requirements. Look for MCS-90, individual state endorsements, commodity schedules, and operating authority references.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `vehicles` (count) | `vehicle_count` | `vehicles` |
| `vehicles` (types distribution) | `fleet_composition` | `vehicles` |
| `limits.combined_single_limit` or split | `current_auto_limit` | `coverage` |
| `carrier` | `auto_carrier` | `coverage` |
| `policy_number` | `auto_policy_number` | `coverage` |

---

## Profile 4: Workers' Compensation

### Overview

Workers' compensation provides statutory benefits to employees injured in the course of employment, covering medical treatment, lost wages, and permanent disability. It is heavily regulated — each state has its own benefit schedule, class codes, and rates. Experience modification factors (mods) reflect the employer's loss history relative to its industry.

**PolicyType enum value:** `"workers_comp"`

### Key Forms

| Form | Purpose |
|------|---------|
| **WC 00 00 00** | WC and Employers' Liability Coverage Form |
| **WC 00 01 01** | Information Page (Declarations) |
| **WC 00 03 04** | Waiver of Subrogation |
| **WC 00 04 01** | Broad Form All States |
| State-specific endorsements | Required in most states |

### Declarations Fields

The Information Page (WC declarations) is structured around states and classification codes:

| Field | Reliability | Notes |
|-------|-------------|-------|
| States listed in Part One | high | States where employees work and coverage is provided |
| Classification code table (per state) | high | Each row: state code, class code, description, estimated annual payroll, rate per $100, classification premium |
| Experience modification factor | high | Usually shown as "Exp Mod" or "Modifier" (e.g., 0.85 = 15% credit) |
| Employers' liability limits | high | Three separate limits: each accident, disease-policy limit, disease-each employee |
| Premium discount (if applicable) | medium | Sliding scale discount for larger policies |
| Total estimated annual premium | high | |
| Minimum premium | medium | |
| Estimated payroll total | high | Sum across all class codes |

### Coverage Structure

- **Part One — Workers' Compensation Insurance**: Statutory benefits. No dollar limit — pays whatever the state statute requires. Defenses are limited; coverage is no-fault.
- **Part Two — Employers' Liability Insurance**: Covers the employer for BI claims by employees outside the WC statute (maritime workers, railroad employees, executive officers who opt out). Three limits: each accident / disease-policy limit / disease-each employee.
- **Part Three — Other States Insurance**: Extends coverage to states not listed in Part One if an employee is injured while working in an unlisted state.
- **Part Four — Duties If Injury Occurs**: Notice requirements, cooperation obligations.
- **Part Five — Premium**: How premium is computed, basis for audit.
- **Part Six — Conditions**: Standard policy conditions.

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| **WC 00 03 04** | Waiver of Our Right to Recover (waiver of subrogation) — required by many contracts |
| **WC 00 03 01** | Alternate Employer — for temp/leased workers; extends WC to alternate employer relationship |
| **WC 00 03 10** | Voluntary Compensation — covers employees not subject to state WC statute |
| **WC 00 04 01** | Broad Form All States — automatically extends to any state if employee is injured there |
| State-specific mandatory endorsements | e.g., California requires the California Workers' Compensation endorsement; New York requires specific forms |
| USL&H (USL&H Act) | Maritime workers (longshore, harbor workers) covered under federal statute |

### Extraction Notes

**Classification table is the most complex structured data in WC:** Multiple states × multiple class codes = potentially dozens of rows. Each row must be captured: state, NCCI class code, class description, estimated payroll, rate per $100 payroll, classification premium. Use table-preservation chunking.

**Experience modification:** The mod is usually shown on the Information Page or on a separate mod worksheet from the rating bureau (NCCI or state bureau). A mod below 1.0 is favorable (better loss history than peers). A mod above 1.0 is adverse. Always extract with precision — 0.85 is materially different from 0.88.

**Monopolistic states:** Ohio, Washington, Wyoming, and North Dakota require WC from the state fund. Private carriers cannot write WC for employees in those states. Policies from these states look completely different — they are state fund certificates, not private policy documents. Flag these appropriately.

**Part Three (other states):** This coverage is often overlooked. It protects the employer if an employee is injured while temporarily working in a state not listed in Part One. Extract which states (if any) are listed in Part Three.

**USL&H and FELA:** Maritime workers are covered under the federal USL&H Act (not state WC). Railroad employees are covered under FELA (not WC). These may appear as endorsements to the WC policy or as separate policies.

**Carrier variations:** Some carriers use their own Information Page format. The structure is always the same (states, class codes, payroll, mod) but column headers and formatting vary. Rely on content signals (NCCI class code pattern = 4 digits, payroll in dollar amounts, rate per $100) rather than column headers.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `classifications[].basis_amount` (payroll) | `annual_payroll` | `financial` |
| `classifications[].basis_amount` by state | `annual_payroll_by_state` | `employees` |
| `experience_modification.factor` | `experience_mod` | `loss_history` |
| `limits.employers_liability.each_accident` | `el_limit_each_accident` | `coverage` |
| Derived employee count from payroll + avg wage | `employee_count` | `employees` |
| `carrier` | `wc_carrier` | `coverage` |
| `policy_number` | `wc_policy_number` | `coverage` |

---

## Profile 5: Commercial Umbrella / Excess Liability

### Overview

Umbrella and excess policies provide limits above primary policies. An umbrella may "drop down" to cover claims not covered by underlying policies (but covered by the umbrella); excess policies strictly follow the underlying policy's terms without drop-down. Almost entirely carrier-proprietary forms — no ISO standard coverage forms exist.

**PolicyType enum values:** `"umbrella"` / `"excess_liability"`

### Key Forms

All forms are carrier-proprietary. No ISO standard coverage forms. The declarations and schedule of underlying are the highest-priority extraction targets.

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Each occurrence / each claim limit | high | The "limit per event" |
| Aggregate limit | high | Annual maximum across all occurrences |
| Self-insured retention (SIR) | high | Applies when underlying policies don't respond; insured pays first |
| Schedule of underlying insurance | high | Each row: underlying policy type, carrier, policy number, limits |
| Retained limit (per retained limit endorsement) | medium | Some umbrella policies have a retained limit instead of SIR |
| Total umbrella/excess premium | high | |

**Schedule of Underlying Insurance** columns:
- Policy type (GL, Auto, WC/EL, Employer's Liability)
- Underlying carrier name
- Underlying policy number
- Underlying limits (per occurrence / aggregate)

### Coverage Structure

**Umbrella (self-contained) characteristics:**
- Has its own insuring agreement, exclusions, and conditions
- May cover claims not covered by underlying (drop-down coverage)
- Applies SIR when no underlying policy responds to the claim type
- Typically broader than the underlying policies

**Excess (following-form) characteristics:**
- Follows the terms, conditions, and exclusions of the underlying policy exactly
- No drop-down provision — only pays above the underlying limit
- No SIR — sits directly above the underlying limit
- Narrower in practice because it inherits all of the underlying's exclusions

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| Additional Insured (carrier-specific) | Follows AI status from underlying or adds new AI |
| Waiver of Subrogation | Follows or adds waiver of subrogation |
| Notice of Cancellation | Extended cancellation notice to additional parties |
| Follow-form endorsements | Makes specific parts of the umbrella follow underlying terms |

### Extraction Notes

**Schedule of underlying is the most critical table:** Underwriters underwrite the umbrella based on the underlying schedule. The underlying schedule establishes: (1) what the umbrella sits on top of, (2) what SIR applies when underlying doesn't respond, and (3) what conditions/exclusions may affect the umbrella if following-form.

**SIR vs retained limit vs deductible:** These are structurally different. A deductible means the insurer defends and pays, then seeks reimbursement. An SIR means the insured defends and pays first up to the retention amount. A retained limit is a specific umbrella concept where the insured retains the first portion of a claim not covered by underlying. Extract whichever term the policy uses and classify it accurately.

**Umbrella vs excess distinction:** The policy form itself usually states whether it is an umbrella (potentially broader terms) or strictly excess (following-form only). The presence or absence of a "drop-down" provision is the key indicator. Always note this distinction.

**"Exhaustion" language:** The umbrella/excess only pays after underlying limits are "exhausted" (fully paid out). Some policies require cash payment; others accept insolvency of underlying carrier. Extract exhaustion language from conditions.

**Carrier variation:** Umbrella and excess policies have more variation across carriers than almost any other line. Form structures vary significantly. Always rely on content signals (limits table, underlying schedule) rather than form numbers.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.each_occurrence_umbrella` | `umbrella_per_occ_limit` | `coverage` |
| `limits.umbrella_aggregate` | `umbrella_aggregate_limit` | `coverage` |
| `limits.umbrella_retention` | `umbrella_sir` | `coverage` |
| `carrier` | `umbrella_carrier` | `coverage` |
| `policy_number` | `umbrella_policy_number` | `coverage` |

---

## Profile 6: Professional Liability / Errors & Omissions (E&O)

### Overview

Professional liability covers claims arising from errors, omissions, or negligent acts in the performance of professional services. All claims-made. Forms are entirely carrier-proprietary. The definition of "professional services" and the retroactive date are the two most critical fields.

**PolicyType enum value:** `"professional_liability"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per claim limit | high | The maximum for any single claim |
| Aggregate limit | high | Annual maximum across all claims |
| Retroactive date | high | Claims arising from acts before this date are excluded. "None" means full prior acts covered |
| Deductible per claim | high | Self-insured portion per claim |
| Defense cost treatment | high | "Inside limits" = defense erodes limit; "Outside limits" = defense is in addition |
| ERP options (tail coverage) | medium | Options and premiums for extended reporting period |
| Individual practitioners covered | medium | Named insureds or all licensed professionals |
| Prior and pending litigation date | medium | Separate date for pending matters |

### Coverage Structure

- **Insuring Agreement**: Pays for damages and defense costs from claims first made during the policy period arising from covered professional services. Claims-made trigger always.
- **Professional Services Definition**: Carrier-defined. This definition is more variable than almost any other policy term and must always be extracted verbatim. A gap between the definition and actual services provided is a major coverage risk.
- **Defense**: Outside limits is insured-favorable (limit remains intact); inside limits is carrier-favorable (defense costs erode the limit). Inside limits is common for lawyers, architects, and technology E&O.
- **Retroactive Date**: The "none" retroactive date gives full prior acts coverage. A specific date excludes claims from earlier acts.

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| Additional insured (carrier-specific) | Common for law firms, design firms |
| Extended reporting period (ERP/tail) | Available at policy expiration; premium typically 100-200% of annual premium for unlimited tail |
| Prior acts exclusion | May exclude coverage for specific prior matter |
| Claim notification endorsement | Extended notice rights to specific parties |
| Deductible modification | Varying deductibles by claim type |
| Cyber liability extension | Some E&O policies include limited data breach coverage |

### Extraction Notes

**"Professional services" definition must be extracted verbatim:** The definition is always carrier-proprietary and varies significantly. It is the most litigated definition in professional liability. Do not paraphrase — extract the full text.

**Defense cost treatment is a material coverage difference:** For a $1M/claim policy with $200K in defense costs: inside limits = $800K remaining for indemnity; outside limits = full $1M plus defense costs. Always extract which applies.

**ERP (tail) coverage:** When a claims-made policy expires or is cancelled, the insured needs tail coverage to protect against claims filed after expiration for acts committed during the policy period. ERP options and pricing are often stated in declarations or endorsements. Extract all options and pricing.

**Carrier variation:** Definitions of "wrongful act", "professional services", "claim", and "damages" vary significantly across carriers and affect coverage scope materially. The extraction prompt should request verbatim text for all defined terms, not just summaries.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `pl_per_claim_limit` | `coverage` |
| `retroactive_date` | `pl_retroactive_date` | `coverage` |
| `carrier` | `pl_carrier` | `coverage` |
| `policy_number` | `pl_policy_number` | `coverage` |

---

## Profile 7: Cyber Liability

### Overview

Cyber liability is the fastest-evolving line. It covers first-party data breach response costs and third-party cyber liability. Forms are entirely carrier-proprietary. The sublimit structure is complex — often 10+ named sublimits. Ransomware and social engineering coverage have been increasingly restricted or sublimited post-2020.

**PolicyType enum value:** `"cyber"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per claim / per incident limit | high | Overall limit for any single event |
| Aggregate limit | high | Annual maximum |
| Retroactive date | high | Claims-made; always extract |
| Deductible per claim | high | |
| Waiting period (BI coverage) | high | Hours before business interruption coverage triggers (e.g., 8 hours) |
| Sublimit schedule | high | Each row: coverage module, sublimit amount |
| Coverage territory | medium | Often worldwide; verify |

**Critical sublimits to extract** (carrier-specific but these are universal):
- Ransomware / cyber extortion sublimit
- Social engineering / funds transfer fraud sublimit
- Bricking (non-recoverable hardware) sublimit
- Voluntary shutdown sublimit
- PCI fines and assessments sublimit
- Reputational harm sublimit
- Regulatory defense and penalties sublimit
- First-party business interruption sublimit

### Coverage Structure

**First-Party Coverages** (insured's own losses):
- **Data breach response**: Forensic investigation, legal counsel, notification costs, credit monitoring, call center
- **Business interruption**: Lost income during network outage (subject to waiting period)
- **Cyber extortion / ransomware**: Ransom payments and negotiation costs
- **Data restoration**: Costs to restore or recreate corrupted/deleted data
- **Bricking**: Replacement cost for hardware rendered non-functional
- **Reputational harm**: Lost income from reputational damage (sometimes)
- **Voluntary shutdown**: Income loss from proactive shutdown to prevent spread

**Third-Party Coverages** (claims by others):
- **Privacy liability**: Claims from individuals whose data was breached
- **Security liability**: Claims from parties harmed by failure of security (e.g., ransomware spreading to third party)
- **Regulatory defense and penalties**: Defense of regulatory investigations and fines (GDPR, CCPA, HIPAA)
- **Media liability**: Claims from online content (defamation, IP infringement)
- **PCI-DSS fines and assessments**: Payment card industry fines

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| Social Engineering coverage (addition or increase) | Carrier may include at low sublimit; endorsement can increase |
| Voluntary Shutdown | Sometimes endorsement-only |
| Systems Failure extension | May extend to non-malicious outages |
| Contingent Business Interruption | Covers BI from outage at a vendor or supplier |
| Retroactive date extension | To include prior acts |

### Extraction Notes

**Sublimit schedule is the most critical extraction:** Standard policy limits (e.g., $1M per claim / $1M aggregate) may be almost meaningless if the most likely cyber events (ransomware, social engineering) are sublimited to $250K or $500K. Always extract the full sublimit schedule.

**Waiting period for BI:** The waiting period (often 8–12 hours) means business interruption coverage doesn't start until the network outage has persisted for the waiting period. This is a significant practical limitation. Always extract.

**War exclusion language:** The war exclusion in cyber has been heavily contested (e.g., Merck vs Ace in the NotPetya case). Different carriers use different language. Some exclude "hostile or warlike acts"; others exclude "acts of terrorism" separately. Extract verbatim.

**Social engineering coverage:** Many cyber policies sublimit social engineering (employee tricked into wiring money) far below the main limit, or exclude it entirely (covered under crime instead). Note whether it is present and at what sublimit.

**Carrier variation is extreme:** Cyber is the least standardized line. Form structure, coverage definitions, sublimits, and exclusions vary enormously. The extraction prompt must be flexible; rely on content signals and section headers rather than form numbers.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `cyber_limit` | `coverage` |
| `limits.sublimits` | `cyber_sublimits` | `coverage` |
| `retroactive_date` | `cyber_retroactive_date` | `coverage` |
| `carrier` | `cyber_carrier` | `coverage` |
| `policy_number` | `cyber_policy_number` | `coverage` |

---

## Profile 8: Employment Practices Liability (EPLI)

### Overview

EPLI covers claims by employees (and sometimes third parties) alleging employment-related wrongful acts: discrimination, harassment, wrongful termination, retaliation, failure to promote. Claims-made trigger always. Defense cost treatment is a key variable.

**PolicyType enum value:** `"epli"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per claim limit | high | |
| Aggregate limit | high | |
| Retroactive date | high | Claims-made; always extract |
| Deductible per claim | high | May vary by claim type (e.g., higher for wage & hour) |
| Defense cost treatment | high | Inside or outside limits |
| Third-party coverage | medium | Harassment by non-employees — endorsement or included |
| Wage & hour coverage | medium | Excluded, sublimited, or included — always note status |

### Coverage Structure

- **Insuring Agreement**: Pays for damages and defense costs from covered employment practices claims first made during the policy period.
- **Covered Employment Practices Wrongful Acts**: Wrongful termination, discrimination (race, sex, age, disability, religion, etc.), sexual harassment, retaliation, failure to promote, wrongful discipline, deprivation of career opportunity.
- **Third-Party Coverage** (when included/endorsed): Extends to harassment claims by non-employees (customers, vendors).

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| Third-Party Coverage | Adds or extends coverage to non-employee harassment claims |
| Wage & Hour Defense | Limited defense cost coverage for wage/hour suits (no indemnity typically) |
| Retention buydown | Reduces deductible for smaller claims |
| Class action exclusion | Excludes class action employment suits |

### Extraction Notes

**Wage & hour coverage:** Wage and hour claims (misclassification, overtime, meal break violations) are the highest-frequency employment claim type. Many EPLI policies exclude them entirely; some add limited defense cost coverage by endorsement with no indemnity. Always extract the status: excluded / defense-cost-only / included.

**Third-party coverage:** The standard form typically covers only employee-vs-employer claims. Third-party coverage (customer-harasses-employee, or insured's employee harasses a client) requires an endorsement. Always note whether it is present.

**Retroactive date scope:** EPLI policies often have a "continuity date" or "pending and prior litigation date" separate from the retroactive date. Extract both if present.

**Carrier variation in definition of wrongful act:** The "employment practices wrongful act" definition determines what triggers coverage. Some carriers include wage & hour, FMLA violations, or ADA accommodation failures; others strictly exclude them. Extract verbatim.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `epli_per_claim_limit` | `coverage` |
| `retroactive_date` | `epli_retroactive_date` | `coverage` |
| `carrier` | `epli_carrier` | `coverage` |
| `policy_number` | `epli_policy_number` | `coverage` |

---

## Profile 9: Directors & Officers (D&O)

### Overview

D&O covers directors and officers (and sometimes the entity itself) for claims arising from alleged wrongful acts in their management capacity. Almost entirely claims-made. The "three-sided" structure of Side A / Side B / Side C is the defining feature.

**PolicyType enum value:** `"directors_officers"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Overall policy limit | high | Shared across all sides unless separate limits |
| Per side limits (if separate) | medium | Some policies break out limits by side |
| Retentions by side | high | Side A: often $0; Sides B/C: substantial |
| Retroactive / continuity date | high | Extract as retroactive date |
| Coverage sides included | high | A, B, C, D — note which are included |
| Defense cost treatment | high | Usually inside limits for D&O |

### Coverage Structure

- **Side A — Individual Coverage**: Covers directors and officers personally for claims when the company cannot or will not indemnify them (company insolvency, adverse court ruling on indemnification). Often has zero or minimal retention. Most critical coverage in bankruptcy scenarios.
- **Side B — Corporate Reimbursement**: Covers the company when it indemnifies directors and officers. Company pays the claim first, then seeks reimbursement from the insurer. Company retains a deductible.
- **Side C — Entity Coverage**: Covers the company itself (as an entity) for securities claims. Applies when the company is a named defendant in a securities class action alongside its D&O.
- **Side D — Derivative Investigation Costs**: Some policies add coverage for costs of responding to derivative demand investigations.

### Common Endorsements

| Endorsement | Notes |
|-------------|-------|
| Side A DIC (Difference in Conditions) | Separate limit for Side A that sits above the primary D&O, providing excess Side A only |
| Prior Acts exclusion | Excludes specific prior matters |
| Worldwide coverage | Extends territory for international operations |
| Deprivation of coverage | Addresses scenarios where insurer might deny coverage to some insureds |
| Entity coverage extensions | Extends entity coverage beyond securities claims |

### Extraction Notes

**Side A retention of $0 is significant:** Side A coverage with no retention is specifically designed to protect individuals when the company is insolvent and cannot indemnify. Always note the Side A retention explicitly.

**Insured vs insured exclusion:** Most D&O policies exclude claims by one insured (director/officer/company) against another insured. This exclusion scope varies: does it apply to derivative suits? Shareholder derivative suits are a major source of D&O claims. Extract the exclusion scope.

**Continuity of coverage:** D&O policies use "continuity date" or "prior acts date" rather than traditional retroactive date. Extract whatever date-limiting concept is present.

**Public vs private/nonprofit D&O:** Public company D&O has entity coverage for securities claims (Side C); private company D&O often omits Side C or provides entity coverage for M&A claims instead. Nonprofit D&O covers board members of nonprofits. The coverage structure differs — extract which type of entity is covered.

**Shared vs separate limits:** Some D&O policies have one aggregate shared across all sides; others have separate limits per side. Shared limits mean Side C securities claims can exhaust the entire limit, leaving nothing for Side A individual coverage. Always extract the limit structure.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `do_limit` | `coverage` |
| `deductibles.per_claim` (Side A) | `do_side_a_retention` | `coverage` |
| `retroactive_date` | `do_continuity_date` | `coverage` |
| `carrier` | `do_carrier` | `coverage` |
| `policy_number` | `do_policy_number` | `coverage` |

---

## Profile 10: Fiduciary Liability

### Overview

Fiduciary liability covers breach of fiduciary duty claims under ERISA (Employee Retirement Income Security Act) arising from management of employee benefit plans (pension, 401(k), health, welfare plans). Claims-made trigger. Relatively straightforward structure compared to other management liability lines.

**PolicyType enum value:** `"fiduciary_liability"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per claim limit | high | |
| Aggregate limit | high | |
| Retroactive date | high | |
| Deductible | high | |
| Plans covered | medium | Schedule of ERISA plans covered |
| Voluntary correction program (VCP) | medium | Coverage for costs of IRS/DOL correction programs |

### Coverage Structure

- **Insuring Agreement**: Covers losses (and sometimes defense costs) arising from breach of fiduciary duty under ERISA in the administration of covered benefit plans.
- **Voluntary Correction Program**: Coverage for costs of participating in IRS Employee Plans Compliance Resolution System (EPCRS) or DOL Voluntary Fiduciary Correction Program (VFCP). This is a distinguishing feature — not all carriers include it.
- **Defense Costs**: May be inside or outside limits.

### Extraction Notes

**Plan schedule:** Most fiduciary policies list the covered ERISA plans (defined benefit pension, 401(k), health plan, etc.). Extract the plan schedule if present.

**Voluntary correction coverage:** Whether the policy covers costs of self-correcting plan errors through the DOL/IRS voluntary correction programs is a significant coverage distinction. Always note.

**Relatively simple form:** Fiduciary is one of the smaller coverage forms. It rarely exceeds 20 pages. Single-chunk extraction is usually appropriate.

**Part of management liability package:** Fiduciary is often sold as part of a management liability package (D&O + EPLI + Fiduciary + Crime). In a package, the fiduciary section is one coverage part. Extract limits and retentions per coverage part.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `fiduciary_limit` | `coverage` |
| `carrier` | `fiduciary_carrier` | `coverage` |
| `policy_number` | `fiduciary_policy_number` | `coverage` |

---

## Profile 11: Crime / Fidelity

### Overview

Crime / fidelity covers direct financial losses from dishonest acts by employees and others. Named perils structure — coverage only applies to the specific insuring agreements selected. Discovery form (loss discovered during policy period) or loss-sustained form (loss occurring during policy period). Social engineering coverage is a recent addition, often sublimited.

**PolicyType enum value:** `"crime_fidelity"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per loss limit (by insuring agreement) | high | Each agreement has its own limit |
| Deductible (by insuring agreement) | high | Each agreement has its own deductible |
| Form type | medium | Discovery vs loss-sustained |
| Retroactive date | medium | Loss-sustained form may have a retroactive date |

### Coverage Structure (Named Perils by Insuring Agreement)

- **Insuring Agreement A — Employee Theft**: Theft of money, securities, or property by an employee. Most fundamental crime coverage.
- **Insuring Agreement B — Forgery or Alteration**: Forgery of checks, drafts, promissory notes by an employee or third party.
- **Insuring Agreement C — Inside the Premises (Theft of Money and Securities)**: Theft, disappearance, or destruction of money and securities inside the premises.
- **Insuring Agreement D — Outside the Premises**: Money and securities in transit by a carrier or messenger.
- **Insuring Agreement E — Computer and Funds Transfer Fraud**: Fraudulent transfer of funds caused by computer fraud or funds transfer fraud instructions.
- **Insuring Agreement F — Money Orders and Counterfeit Money**: Accepting fake currency or invalid money orders.
- **Social Engineering / Impersonation Fraud** (increasingly common, often sublimited): Employee tricked by fraudulent instructions (phone call, email) into transferring funds.
- **ERISA Fidelity Bond**: Federal requirement for anyone handling ERISA plan funds.
- **Client Coverage**: Extends employee theft coverage to include theft from clients.

### Extraction Notes

**Per-agreement limits matter:** Crime policies are unusual in that each insuring agreement has its own limit and deductible. A $1M policy does not mean $1M for every crime scenario — it means $1M for each selected insuring agreement individually. Extract limits per agreement, not just the headline limit.

**Social engineering vs cyber:** Social engineering (employee tricked into wiring money) may be in the crime policy, the cyber policy, or both. Carriers increasingly offer it as an endorsement to crime with sublimits. Note which policy covers it and at what limit.

**Discovery vs loss-sustained form:** Discovery form: losses are covered if discovered during the policy period, regardless of when they occurred. Loss-sustained form: losses must occur during the policy period. This affects how retroactive the coverage is.

**Carrier variation:** Crime forms have more carrier variation than most commercial lines. Some carriers use ISO commercial crime forms (CR 00 21 for discovery, CR 00 22 for loss-sustained); others use entirely proprietary forms.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `endorsements` (type `additional_insured` for ERISA bond) | `erisa_bond_present` | `coverage` |
| `limits.per_occurrence` | `crime_limit` | `coverage` |
| `carrier` | `crime_carrier` | `coverage` |
| `policy_number` | `crime_policy_number` | `coverage` |

---

## Profile 12: Inland Marine / Equipment

### Overview

Inland marine covers property in transit or at locations other than the insured's premises. The most common commercial inland marine coverage is the contractor's equipment floater, covering tools and equipment. Highly customized per risk — the equipment schedule is the most critical data.

**PolicyType enum value:** `"inland_marine"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Equipment schedule (if scheduled) | high | Each item: description, year, serial number, value |
| Blanket limit (if blanket) | high | Single limit covering all unscheduled equipment |
| Deductible | high | Per occurrence; may be percentage |
| Valuation method | high | RC, ACV, or agreed value |
| Coverage territory | medium | On and off-premises; in transit |
| Exclusions | medium | Wear and tear, mechanical breakdown, earthquake |

### Coverage Structure

- **Scheduled Basis**: Each item of equipment is listed with its value. Coverage only applies to listed items.
- **Blanket Basis**: Single limit covers all equipment without itemization, up to a per-item sub-limit.
- **Covered Perils**: Usually open perils (all-risk) with named exclusions. Much broader than property on-premises.
- **Coverage Territory**: Typically "in the US, Canada, and while in transit" — broader than building coverage.

**Common Inland Marine Coverage Types:**

| Type | Description |
|------|-------------|
| Contractor's Equipment Floater | Tools, machinery, equipment owned or rented by contractors |
| Installation Floater | Property during installation/construction before completion |
| Electronic Data Processing (EDP) | Computers, servers, electronic equipment |
| Valuable Papers and Records | Documents, records, maps (often an extension in property) |
| Motor Truck Cargo | Cargo in transit for carriers |
| Sales Floater | Samples, goods carried by salespeople |

### Extraction Notes

**Equipment schedule is the primary data:** The schedule lists every covered item with its serial/ID number and insured value. This table must not be split across chunks. Multi-page schedules are common for contractors with large fleets.

**Blanket vs scheduled:** Large contractors often have blanket inland marine (one limit, no per-item schedule) because maintaining a schedule for hundreds of small tools is impractical. Blanket policies usually have a per-item sub-limit.

**Contractor's equipment vs auto:** Mobile equipment may be covered under the contractor's equipment floater, the commercial auto policy, or the GL policy. The CA 00 01 business auto policy excludes mobile equipment. Inland marine fills this gap.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| Equipment total insured value | `equipment_value` | `financial` |
| Equipment schedule item count | `equipment_count` | `operations` |
| `carrier` | `im_carrier` | `coverage` |
| `policy_number` | `im_policy_number` | `coverage` |

---

## Profile 13: Builders Risk

### Overview

Builders risk is temporary property coverage for structures under construction. Coverage attaches at inception of construction and terminates at project completion, sale, or occupancy. Project-specific or annual reporting forms. The completed project value is the governing limit.

**PolicyType enum value:** `"builders_risk"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Project description and address | high | Specific to each project |
| Completed value (hard costs) | high | Maximum insurable interest at completion |
| Soft costs limit | medium | Professional fees, financing, permits, marketing |
| Policy period / project period | high | Project-specific dates |
| Causes of loss form | high | Usually "Special" (open perils) |
| Deductible | high | |
| Named insureds | medium | Owner, GC, subcontractors as additional named insureds |

### Coverage Structure

- **Hard Costs**: Building materials, labor, contractor's overhead and profit.
- **Soft Costs**: Architect/engineer fees, financing costs, permits, marketing expenses incurred due to delay caused by a covered loss.
- **Delayed Completion (Business Income)**: Lost income arising from project delay due to covered loss.
- **Coverage Territory**: Typically on-site only; some forms extend to materials in transit.
- **Subcontractors**: Major subcontractors are often named as additional named insureds.

### Extraction Notes

**Completed value vs contract value:** The insured limit is based on the expected completed project value, not the current construction-in-place value. This is because losses can occur when the project is nearly complete.

**Soft costs are frequently missed:** Soft costs (architect fees, permit costs, financing charges that continue during delay) can be substantial. Always note whether a soft costs endorsement is present and at what limit.

**Testing and startup coverage:** For manufacturing or industrial projects, coverage for damage during testing and commissioning (before final acceptance) is important. London Engineering Group (LEG) clauses address design defect exclusions in this context.

**Annual reporting form:** Large contractors with ongoing construction use an annual builders risk policy where each project is reported and added to the policy. The limit is the aggregate of all reported projects in progress.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `builders_risk_limit` | `coverage` |
| `locations[0].address` | `project_address` | `premises` |
| `carrier` | `br_carrier` | `coverage` |
| `policy_number` | `br_policy_number` | `coverage` |

---

## Profile 14: Environmental / Pollution Liability

### Overview

Environmental liability covers cleanup costs and third-party liability arising from pollution events. Base GL forms exclude pollution; environmental policies fill this gap. Coverage can be claims-made (most common) or occurrence (rare). Site-specific or contractor's pollution liability (CPL) are the two major types.

**PolicyType enum value:** `"environmental"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per pollution event limit | high | Per occurrence/event |
| Aggregate limit | high | |
| Retroactive date | high | Claims-made trigger usually |
| Covered locations / sites | medium | Specific sites listed or blanket |
| Coverage grants | medium | Cleanup, third-party BI/PD, transportation, non-owned disposal sites |
| Deductible | high | |

### Coverage Structure

- **Third-Party Liability**: BI and PD claims from pollution on covered sites or from covered operations.
- **Cleanup Costs**: Costs to investigate and remediate pollution as required by a regulatory authority.
- **Transportation**: Pollution from the transport of hazardous materials (separate trigger from site coverage).
- **Non-Owned Disposal Sites**: Liability for pollution at off-site disposal sites where the insured sent waste.
- **Contractor's Pollution Liability (CPL)**: Covers contractors who encounter or disturb pre-existing pollution during work.

### Extraction Notes

**Claims-made vs pollution event trigger:** Most environmental policies are claims-made. Some use a "pollution event" trigger (the event must begin during the policy period). This affects the retroactive date and tail coverage importance.

**Site-specific vs blanket:** Some policies cover only listed sites; others are blanket for all owned, operated, or leased locations. Always note which approach applies.

**Remediation cost cap:** Some environmental policies are structured as "remediation cost cap" policies (covering cost overruns on known remediations). These have very different structures from standard environmental liability.

**Carrier variation:** Environmental is a specialty line with significant carrier variation. No standard ISO forms. Reliance on section header analysis is necessary.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `env_limit` | `coverage` |
| `carrier` | `env_carrier` | `coverage` |
| `policy_number` | `env_policy_number` | `coverage` |

---

## Profile 15: Ocean Marine / Cargo

### Overview

Ocean marine covers ships, cargo, freight, and related maritime interests. Unique terminology and primarily London market (Lloyd's and company market) forms. War risks are almost always separately placed.

**PolicyType enum value:** `"ocean_marine"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Hull value (if hull coverage) | high | Agreed value of the vessel |
| Cargo limit | high | Per conveyance or annual aggregate |
| P&I (Protection and Indemnity) limit | high | Third-party maritime liability |
| Deductible | high | |
| Trading area | medium | Geographic limits of hull coverage |
| Conveyance types covered | medium | Vessels, aircraft, land conveyances |

### Coverage Structure

- **Hull**: Physical damage to the vessel itself. Agreed value basis.
- **Cargo**: Goods while in transit. Open cover (blanket annual policy) or per-shipment.
- **Protection and Indemnity (P&I)**: Third-party liability for vessel operators (collision liability, crew injury, oil pollution).
- **Freight**: Liability for cargo owner's loss of freight income.

**Key marine terms (unique to this line):**
- **Particular average**: Partial loss borne by one interest (insured's own loss)
- **General average**: All interests share in a partial loss intentionally incurred to save the voyage
- **Salvage**: Compensation to third parties who save the vessel or cargo
- **Inchmaree clause**: Covers losses from latent defects, negligence of crew/masters
- **Free of Particular Average (FPA)**: Covers only total losses and specified partial losses

### Extraction Notes

**London market forms:** Most ocean marine is placed in the London market using MAR 91 slip forms and Institute Clauses (ICA, ICC). These have no US form numbers. Rely on content analysis.

**War risks placed separately:** War, strikes, riots, and civil commotion are specifically excluded from most marine policies and placed separately (often through Lloyd's or specialists).

**Cargo open cover:** Commercial cargo insureds typically have an "open cover" — an annual policy under which individual shipments are reported (declared) as they occur. The declarations may reference a "certificate" issued for each shipment.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `marine_limit` | `coverage` |
| `carrier` | `marine_carrier` | `coverage` |
| `policy_number` | `marine_policy_number` | `coverage` |

---

## Profile 16: Surety Bonds

### Overview

Surety bonds are not insurance — they are a three-party guarantee. The principal (contractor/licensee) purchases a bond from the surety (bonding company) in favor of the obligee (project owner/government). The surety guarantees that the principal will perform an obligation. Document structure is completely different from insurance policies.

**PolicyType enum value:** `"surety"`

### Key Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Bond type | high | Bid, performance, payment, license, permit, court, fidelity |
| Bond amount (penal sum) | high | The guarantee amount |
| Principal name | high | The party making the guarantee (contractor) |
| Obligee name | high | The party protected by the bond (project owner, government agency) |
| Surety name | high | The guaranteeing company |
| Effective date | high | |
| Expiration date / "continuous" | high | Many license bonds are continuous until cancelled |
| Underlying contract reference | medium | The contract or obligation being bonded |

### Document Structure

Surety bonds are typically 1-5 pages. Structure:
1. Bond face (identifies principal, obligee, surety, penal sum, type)
2. Conditions (what triggers the bond; when the surety must pay)
3. Signatures and notarization

No coverage sections, no exclusions section, no definitions section. The penal sum IS the limit.

### Bond Types

| Type | Purpose |
|------|---------|
| Bid Bond | Guarantees contractor will honor its bid and execute the contract if awarded |
| Performance Bond | Guarantees contractor will complete the contract per its terms |
| Payment Bond (Labor & Material) | Guarantees contractor will pay subcontractors and suppliers |
| Maintenance Bond | Guarantees contractor will correct defects for a period after completion |
| License and Permit Bond | Required by state/local government to obtain a license or permit |
| Court Bond | Guarantees litigants' obligations (appeal bonds, injunction bonds) |
| Fidelity Bond | Guarantees honesty of employees (also appears in crime policies) |

### Extraction Notes

**No coverage/deductible/premium structure:** Surety bonds have no deductibles or coverage limits per se — the penal sum is the maximum the surety will pay. The premium is a fee for the guarantee, not insurance premium. Flag surety documents at classification time.

**The obligee is the protected party:** Unlike insurance where the insured makes claims, in a bond the obligee makes claims. The principal is the party who purchased the bond and is the "insured" in the sense of the premium payer.

**Continuous bonds:** License and permit bonds are often "continuous until cancelled" — no expiration date. They require 30-60 days cancellation notice.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| Bond type list | `surety_bond_types` | `coverage` |
| `limits.per_occurrence` (penal sum) | `surety_bond_amount` | `coverage` |

---

## Profile 17: Product Liability (Standalone)

### Overview

Product liability coverage for bodily injury or property damage arising from the insured's products. This coverage is included in GL Coverage A under the "products-completed operations hazard" in most policies. Separate product liability policies exist for manufacturers with significant product exposure who need limits beyond what a GL policy provides, or who need specialized terms.

**PolicyType enum value:** `"product_liability"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per occurrence / per claim limit | high | |
| Aggregate limit | high | Often separate products aggregate |
| Defense cost treatment | high | |
| Retroactive date (if claims-made) | high | Most are occurrence, some claims-made |
| Products described | medium | Which products are covered |

### Extraction Notes

**Usually under GL:** In most commercial policies, product liability is not a standalone line — it is Coverage A (products-completed operations) under the GL policy. Only extract as `product_liability` if the document is clearly a standalone product liability policy.

**Product recall is separate:** Product liability (BI/PD from defective products) is completely separate from product recall (costs to recall and replace defective products). Recall coverage is its own specialty line (often called "Product Recall" or "Contaminated Products"). Note which is present.

**Claims-made product liability:** While most product liability is occurrence-trigger, some specialty manufacturers buy claims-made product liability. Extract trigger type explicitly.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.per_occurrence` | `pl_product_limit` | `coverage` |
| `carrier` | `product_carrier` | `coverage` |
| `policy_number` | `product_policy_number` | `coverage` |

---

## Profile 18: Business Owners Policy (BOP)

### Overview

The BOP is a pre-packaged combination of GL and property for small to mid-sized businesses. Eligibility is limited to classes carriers have designated as BOP-eligible. Coverage is more restrictive than standalone GL and property but more affordable. Most BOPs include business income by default.

**PolicyType enum value:** `"bop"`

### Declarations Fields

Combined GL and property fields on a single declarations page:

| Field | Reliability | Notes |
|-------|-------------|-------|
| GL per occurrence limit | high | |
| GL aggregate limit | high | |
| Business personal property limit (per location) | high | |
| Building limit (if owned) | medium | |
| Business income / extra expense limit | high | Usually included automatically in BOP |
| Deductible (property) | high | |
| Total BOP premium | high | |

### Coverage Structure

BOP combines:
- **Section I — Property Coverage**: Building (if owned), business personal property, business income/extra expense. Usually special causes of loss.
- **Section II — Liability Coverage**: GL equivalent to CG 00 01 with standard Coverage A, B, C structure.

**Key BOP limitations vs standalone GL/Property:**
- Limited endorsement options
- Smaller eligible businesses (revenue/size limits)
- May not include products/completed operations beyond GL limits
- No separately scheduled equipment; relies on blanket limits

### Extraction Notes

**Extract as both GL and property:** When a BOP is identified, extract all GL fields (limits, classification codes) AND all property fields (location schedule, values, causes of loss). The BOP covers both.

**Business income is usually included:** Unlike standalone property where BI is an optional added form, most BOPs include business income and extra expense by default. Note whether the BI limit is stated separately.

**Carrier variation is high:** Unlike standardized ISO forms for GL (CG 00 01) and property (CP 00 10), BOP forms are carrier-proprietary. ISO does have a BOP form (BP 00 03), but many carriers use their own. Section headers are similar but details vary.

### Business Context Mapping

BOP uses the same context keys as GL and property — extract both sets and store under the same keys as standalone policies.

---

## Profile 19: Management Liability Package

### Overview

A management liability package bundles D&O + EPLI + Fiduciary + Crime into a single policy. Common for private companies, nonprofits, and small public companies. The shared aggregate limit is the most critical structural feature — all coverages draw from the same pool.

**PolicyType enum value:** `"management_liability_package"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Policy aggregate limit | high | Shared across ALL coverage parts unless noted |
| Per-coverage limits (if separate) | medium | Some packages have sub-limits by coverage part |
| Retention by coverage part | high | Each part may have different retention |
| Retroactive date by coverage part | high | D&O, EPLI, Fiduciary each have their own date |

### Extraction Notes

**Shared aggregate is critical:** In a $5M management liability package with a $5M shared aggregate, a large D&O claim can exhaust the limit leaving nothing for EPLI or crime claims in the same year. Always note whether the aggregate is shared.

**Multiple retroactive dates:** Each coverage part has its own retroactive/continuity date. Extract per coverage part — do not use a single policy-level retroactive date.

**Per-coverage sub-limits:** Some packages offer per-coverage sub-limits within the overall aggregate. A $5M policy might have $5M for D&O but only $1M for EPLI. Extract all sub-limits.

**Coverage parts included:** Note which coverage parts are included (D&O, EPLI, Fiduciary, Crime, or any subset). Some packages are D&O + EPLI only; others include all four.

### Business Context Mapping

Extract all context keys from D&O (Profile 9), EPLI (Profile 8), Fiduciary (Profile 10), and Crime (Profile 11) profiles. Additionally:

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.general_aggregate` (shared) | `ml_shared_aggregate` | `coverage` |
| `limits.shared_limits` | `ml_coverage_sub_limits` | `coverage` |

---

## Profile 20: Excess Liability (Standalone)

### Overview

Standalone excess liability (as distinct from umbrella — see Profile 5) is pure "follow-form" coverage that sits above a primary layer without drop-down provisions. Used to build a tower of coverage above primary limits. Multiple excess layers may be stacked (e.g., $5M primary → $10M first excess → $10M second excess = $25M total).

**PolicyType enum value:** `"excess_liability"`

### Declarations Fields

| Field | Reliability | Notes |
|-------|-------------|-------|
| Per occurrence limit | high | This layer's limit |
| Aggregate limit | high | Annual max for this layer |
| Attachment point | high | When this layer attaches (= underlying total limits) |
| Schedule of underlying insurance | high | Policies this excess sits above |

### Differences from Umbrella

| Feature | Umbrella | Excess (Follow-Form) |
|---------|---------|---------------------|
| Drop-down | Yes — covers gaps in underlying | No — strictly above underlying |
| SIR | Yes — for claims underlying doesn't cover | No — always above underlying limit |
| Own terms | Yes — self-contained | No — follows underlying policy terms |
| Breadth | May be broader than underlying | Never broader than underlying |

### Extraction Notes

**Schedule of underlying is the key table:** Just as with umbrella, the schedule of underlying insurance defines what this excess policy sits above. Extract all rows: policy type, carrier, policy number, limits.

**"Attachment point" = sum of underlying limits:** The excess layer only pays after underlying limits are exhausted. The attachment point is the total of all underlying limits (e.g., $5M primary means $5M attachment point for first excess).

**Stacking multiple layers:** When there are multiple excess layers, extract each as a separate policy with its own attachment point and limits. The attachment point for the second excess equals the combined primary + first excess limits.

**Follow-form exclusions:** Because excess "follows form," if the primary GL has an exclusion, the excess has the same exclusion. However, some excess policies carve out exceptions where they apply broader terms. Note any deviations from follow-form.

**Carrier variation:** Like umbrella, excess forms are carrier-proprietary. Structure is simpler than umbrella (no drop-down provisions), but still no standard ISO forms.

### Business Context Mapping

| Extracted Field | Context Key | Category |
|----------------|-------------|----------|
| `limits.each_occurrence_umbrella` | `excess_per_occ_limit` | `coverage` |
| `limits.umbrella_aggregate` | `excess_aggregate_limit` | `coverage` |
| `carrier` | `excess_carrier` | `coverage` |
| `policy_number` | `excess_policy_number` | `coverage` |

---

## Cross-Line Reference: Retroactive Date Status by Line

Claims-made vs occurrence is one of the most important distinctions across lines. This table provides a quick reference:

| Line | Trigger | Retroactive Date | Notes |
|------|---------|-----------------|-------|
| General Liability (CG 00 01) | Occurrence | Not applicable | |
| General Liability (CG 00 02) | Claims-made | Always required | "None" = full prior acts |
| Commercial Property | Loss occurrence | Not applicable | |
| Commercial Auto | Occurrence (CA) | Not applicable | |
| Workers' Compensation | Occurrence (WC) | Not applicable | |
| Umbrella / Excess | Follows underlying | Follows underlying | |
| Professional Liability | Claims-made | Always required | Often "None" for first-time buyer |
| Cyber | Claims-made | Always required | Retroactive date trend: carriers moving toward shorter lookbacks |
| EPLI | Claims-made | Always required | "Prior and pending" date also important |
| D&O | Claims-made | Continuity date | Side A often has longer continuity date |
| Fiduciary | Claims-made | Always required | |
| Crime (discovery form) | Discovery | Not applicable (discovery trigger) | No retroactive date; claims discovered during period |
| Crime (loss-sustained) | Occurrence | Retroactive date applies | |
| Inland Marine | Occurrence | Not applicable | |
| Builders Risk | Occurrence | Not applicable | |
| Environmental | Claims-made (usually) | Often required | |
| Ocean Marine | Occurrence | Not applicable | |
| Surety | Guarantee | Not applicable | |

---

## Cross-Line Reference: Defense Cost Treatment

| Line | Typical Treatment | Impact |
|------|------------------|--------|
| GL (CG 00 01/02) | Outside limits ("supplementary payments") | Defense does not erode limit |
| Commercial Property | N/A | Property disputes rarely involve "defense" in the liability sense |
| Commercial Auto | Outside limits | Defense does not erode limit |
| Workers' Compensation | Outside limits | WC defense is included |
| Umbrella | Outside limits (most) | Follows underlying |
| Professional Liability / E&O | Inside limits (common) | Defense erodes available indemnity limit |
| Cyber | Inside limits (common) | Defense erodes limit; substantial cost in breach response |
| EPLI | Inside limits (common) | Defense is significant; can erode indemnity limit |
| D&O | Inside limits (most) | Defense is often the dominant cost in D&O claims |
| Fiduciary | Inside limits (most) | |
| Crime | Not applicable | Defense is usually not a major element |

The inside-vs-outside distinction is material: for a $1M professional liability policy with a $300K defense cost, inside limits leaves only $700K for indemnity; outside limits leaves the full $1M.
