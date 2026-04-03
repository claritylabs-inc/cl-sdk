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
  | "individual"
  | "married_couple"
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
  | "dwelling_value"
  | "vehicle_value"
  | "contents_value"
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
