import { z } from "zod";

// ── PolicyType (42 values) ──

export const PolicyTypeSchema = z.enum([
  // Commercial lines
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
  // Personal lines
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
]);
export type PolicyType = z.infer<typeof PolicyTypeSchema>;
export const POLICY_TYPES = PolicyTypeSchema.options;

// ── EndorsementType ──

export const EndorsementTypeSchema = z.enum([
  "additional_insured",
  "waiver_of_subrogation",
  "primary_noncontributory",
  "blanket_additional_insured",
  "loss_payee",
  "mortgage_holder",
  "broadening",
  "restriction",
  "exclusion",
  "amendatory",
  "notice_of_cancellation",
  "designated_premises",
  "classification_change",
  "schedule_update",
  "deductible_change",
  "limit_change",
  "territorial_extension",
  "other",
]);
export type EndorsementType = z.infer<typeof EndorsementTypeSchema>;
export const ENDORSEMENT_TYPES = EndorsementTypeSchema.options;

// ── ConditionType ──

export const ConditionTypeSchema = z.enum([
  "duties_after_loss",
  "notice_requirements",
  "other_insurance",
  "cancellation",
  "nonrenewal",
  "transfer_of_rights",
  "liberalization",
  "arbitration",
  "concealment_fraud",
  "examination_under_oath",
  "legal_action",
  "loss_payment",
  "appraisal",
  "mortgage_holders",
  "policy_territory",
  "separation_of_insureds",
  "other",
]);
export type ConditionType = z.infer<typeof ConditionTypeSchema>;
export const CONDITION_TYPES = ConditionTypeSchema.options;

// ── PolicySectionType ──

export const PolicySectionTypeSchema = z.enum([
  "declarations",
  "insuring_agreement",
  "policy_form",
  "endorsement",
  "application",
  "exclusion",
  "condition",
  "definition",
  "schedule",
  "notice",
  "regulatory",
  "other",
]);
export type PolicySectionType = z.infer<typeof PolicySectionTypeSchema>;
export const POLICY_SECTION_TYPES = PolicySectionTypeSchema.options;

// ── QuoteSectionType ──

export const QuoteSectionTypeSchema = z.enum([
  "terms_summary",
  "premium_indication",
  "underwriting_condition",
  "subjectivity",
  "coverage_summary",
  "exclusion",
  "other",
]);
export type QuoteSectionType = z.infer<typeof QuoteSectionTypeSchema>;
export const QUOTE_SECTION_TYPES = QuoteSectionTypeSchema.options;

// ── CoverageForm ──

export const CoverageFormSchema = z.enum(["occurrence", "claims_made", "accident"]);
export type CoverageForm = z.infer<typeof CoverageFormSchema>;
export const COVERAGE_FORMS = CoverageFormSchema.options;

// ── PolicyTermType ──

export const PolicyTermTypeSchema = z.enum(["fixed", "continuous"]);
export type PolicyTermType = z.infer<typeof PolicyTermTypeSchema>;
export const POLICY_TERM_TYPES = PolicyTermTypeSchema.options;

// ── CoverageTrigger ──

export const CoverageTriggerSchema = z.enum(["occurrence", "claims_made", "accident"]);
export type CoverageTrigger = z.infer<typeof CoverageTriggerSchema>;
export const COVERAGE_TRIGGERS = CoverageTriggerSchema.options;

// ── LimitType ──

export const LimitTypeSchema = z.enum([
  "per_occurrence",
  "per_claim",
  "aggregate",
  "per_person",
  "per_accident",
  "statutory",
  "blanket",
  "scheduled",
]);
export type LimitType = z.infer<typeof LimitTypeSchema>;
export const LIMIT_TYPES = LimitTypeSchema.options;

// ── DeductibleType ──

export const DeductibleTypeSchema = z.enum([
  "per_occurrence",
  "per_claim",
  "aggregate",
  "percentage",
  "waiting_period",
]);
export type DeductibleType = z.infer<typeof DeductibleTypeSchema>;
export const DEDUCTIBLE_TYPES = DeductibleTypeSchema.options;

// ── ValuationMethod ──

export const ValuationMethodSchema = z.enum([
  "replacement_cost",
  "actual_cash_value",
  "agreed_value",
  "functional_replacement",
]);
export type ValuationMethod = z.infer<typeof ValuationMethodSchema>;
export const VALUATION_METHODS = ValuationMethodSchema.options;

// ── DefenseCostTreatment ──

export const DefenseCostTreatmentSchema = z.enum(["inside_limits", "outside_limits", "supplementary"]);
export type DefenseCostTreatment = z.infer<typeof DefenseCostTreatmentSchema>;
export const DEFENSE_COST_TREATMENTS = DefenseCostTreatmentSchema.options;

// ── EntityType ──

export const EntityTypeSchema = z.enum([
  "corporation",
  "llc",
  "partnership",
  "sole_proprietor",
  "joint_venture",
  "trust",
  "nonprofit",
  "municipality",
  "individual",
  "married_couple",
  "other",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;
export const ENTITY_TYPES = EntityTypeSchema.options;

// ── AdmittedStatus ──

export const AdmittedStatusSchema = z.enum(["admitted", "non_admitted", "surplus_lines"]);
export type AdmittedStatus = z.infer<typeof AdmittedStatusSchema>;
export const ADMITTED_STATUSES = AdmittedStatusSchema.options;

// ── AuditType ──

export const AuditTypeSchema = z.enum([
  "annual",
  "semi_annual",
  "quarterly",
  "monthly",
  "self",
  "physical",
  "none",
]);
export type AuditType = z.infer<typeof AuditTypeSchema>;
export const AUDIT_TYPES = AuditTypeSchema.options;

// ── EndorsementPartyRole ──

export const EndorsementPartyRoleSchema = z.enum([
  "additional_insured",
  "loss_payee",
  "mortgage_holder",
  "certificate_holder",
  "notice_recipient",
  "other",
]);
export type EndorsementPartyRole = z.infer<typeof EndorsementPartyRoleSchema>;
export const ENDORSEMENT_PARTY_ROLES = EndorsementPartyRoleSchema.options;

// ── ClaimStatus ──

export const ClaimStatusSchema = z.enum(["open", "closed", "reopened"]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export const CLAIM_STATUSES = ClaimStatusSchema.options;

// ── SubjectivityCategory ──

export const SubjectivityCategorySchema = z.enum(["pre_binding", "post_binding", "information"]);
export type SubjectivityCategory = z.infer<typeof SubjectivityCategorySchema>;
export const SUBJECTIVITY_CATEGORIES = SubjectivityCategorySchema.options;

// ── DocumentType ──

export const DocumentTypeSchema = z.enum(["policy", "quote", "binder", "endorsement", "certificate"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;
export const DOCUMENT_TYPES = DocumentTypeSchema.options;

// ── ChunkType ──

export const ChunkTypeSchema = z.enum([
  "declarations",
  "coverage_form",
  "endorsement",
  "schedule",
  "conditions",
  "mixed",
]);
export type ChunkType = z.infer<typeof ChunkTypeSchema>;
export const CHUNK_TYPES = ChunkTypeSchema.options;

// ── RatingBasisType ──

export const RatingBasisTypeSchema = z.enum([
  "payroll",
  "revenue",
  "area",
  "units",
  "vehicle_count",
  "employee_count",
  "per_capita",
  "dwelling_value",
  "vehicle_value",
  "contents_value",
  "other",
]);
export type RatingBasisType = z.infer<typeof RatingBasisTypeSchema>;
export const RATING_BASIS_TYPES = RatingBasisTypeSchema.options;

// ── VehicleCoverageType ──

export const VehicleCoverageTypeSchema = z.enum([
  "liability",
  "collision",
  "comprehensive",
  "uninsured_motorist",
  "underinsured_motorist",
  "medical_payments",
  "hired_auto",
  "non_owned_auto",
  "cargo",
  "physical_damage",
]);
export type VehicleCoverageType = z.infer<typeof VehicleCoverageTypeSchema>;
export const VEHICLE_COVERAGE_TYPES = VehicleCoverageTypeSchema.options;

// ── Personal lines ──

export const HomeownersFormTypeSchema = z.enum(["HO-3", "HO-5", "HO-4", "HO-6", "HO-7", "HO-8"]);
export type HomeownersFormType = z.infer<typeof HomeownersFormTypeSchema>;
export const HOMEOWNERS_FORM_TYPES = HomeownersFormTypeSchema.options;

export const DwellingFireFormTypeSchema = z.enum(["DP-1", "DP-2", "DP-3"]);
export type DwellingFireFormType = z.infer<typeof DwellingFireFormTypeSchema>;
export const DWELLING_FIRE_FORM_TYPES = DwellingFireFormTypeSchema.options;

export const FloodZoneSchema = z.enum(["A", "AE", "AH", "AO", "AR", "V", "VE", "B", "C", "X", "D"]);
export type FloodZone = z.infer<typeof FloodZoneSchema>;
export const FLOOD_ZONES = FloodZoneSchema.options;

export const ConstructionTypeSchema = z.enum(["frame", "masonry", "superior", "mixed", "other"]);
export type ConstructionType = z.infer<typeof ConstructionTypeSchema>;
export const CONSTRUCTION_TYPES = ConstructionTypeSchema.options;

export const RoofTypeSchema = z.enum(["asphalt_shingle", "tile", "metal", "slate", "flat", "wood_shake", "other"]);
export type RoofType = z.infer<typeof RoofTypeSchema>;
export const ROOF_TYPES = RoofTypeSchema.options;

export const FoundationTypeSchema = z.enum(["basement", "crawl_space", "slab", "pier", "other"]);
export type FoundationType = z.infer<typeof FoundationTypeSchema>;
export const FOUNDATION_TYPES = FoundationTypeSchema.options;

export const PersonalAutoUsageSchema = z.enum(["pleasure", "commute", "business", "farm"]);
export type PersonalAutoUsage = z.infer<typeof PersonalAutoUsageSchema>;
export const PERSONAL_AUTO_USAGES = PersonalAutoUsageSchema.options;

export const LossSettlementSchema = z.enum([
  "replacement_cost",
  "actual_cash_value",
  "extended_replacement_cost",
  "guaranteed_replacement_cost",
]);
export type LossSettlement = z.infer<typeof LossSettlementSchema>;
export const LOSS_SETTLEMENTS = LossSettlementSchema.options;

export const BoatTypeSchema = z.enum(["sailboat", "powerboat", "pontoon", "jet_ski", "kayak_canoe", "yacht", "other"]);
export type BoatType = z.infer<typeof BoatTypeSchema>;
export const BOAT_TYPES = BoatTypeSchema.options;

export const RVTypeSchema = z.enum(["rv_motorhome", "travel_trailer", "atv", "snowmobile", "golf_cart", "dirt_bike", "other"]);
export type RVType = z.infer<typeof RVTypeSchema>;
export const RV_TYPES = RVTypeSchema.options;

export const ScheduledItemCategorySchema = z.enum([
  "jewelry",
  "fine_art",
  "musical_instruments",
  "silverware",
  "furs",
  "cameras",
  "collectibles",
  "firearms",
  "golf_equipment",
  "other",
]);
export type ScheduledItemCategory = z.infer<typeof ScheduledItemCategorySchema>;
export const SCHEDULED_ITEM_CATEGORIES = ScheduledItemCategorySchema.options;

export const TitlePolicyTypeSchema = z.enum(["owners", "lenders"]);
export type TitlePolicyType = z.infer<typeof TitlePolicyTypeSchema>;
export const TITLE_POLICY_TYPES = TitlePolicyTypeSchema.options;

export const PetSpeciesSchema = z.enum(["dog", "cat", "other"]);
export type PetSpecies = z.infer<typeof PetSpeciesSchema>;
export const PET_SPECIES = PetSpeciesSchema.options;
