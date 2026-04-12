// Framework-agnostic document interfaces for the insurance intelligence engine

import type { PolicyType, EntityType, CoverageForm, PolicyTermType, AuditType } from "./enums";
import type { Address, Contact, FormReference, TaxFeeItem, RatingBasis, NamedInsured, ExtendedReportingPeriod } from "./shared";
import type { EnrichedCoverage } from "./coverage";
import type { Endorsement, EndorsementParty } from "./endorsement";
import type { Exclusion } from "./exclusion";
import type { PolicyCondition } from "./condition";
import type { LimitSchedule, DeductibleSchedule, InsuredLocation, InsuredVehicle, ClassificationCode } from "./declarations";
import type { Declarations } from "./declarations/index";
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

  // ── Enriched fields ──

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
  /** @deprecated Use declarations instead. Structured limits schedule */
  limits?: LimitSchedule;
  /** @deprecated Use declarations instead. Structured deductible schedule */
  deductibles?: DeductibleSchedule;
  /** @deprecated Use declarations instead. Insured locations/premises */
  locations?: InsuredLocation[];
  /** @deprecated Use declarations instead. Insured vehicles */
  vehicles?: InsuredVehicle[];
  /** @deprecated Use declarations instead. Rating classification codes */
  classifications?: ClassificationCode[];
  /** All form numbers in the policy */
  formInventory?: FormReference[];

  /** Typed declarations union — line-specific structured data */
  declarations?: Declarations;

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
  /** Expiration date — absent for continuous ("until cancelled") policies */
  expirationDate?: string;
  /** "fixed" = standard term policy, "continuous" = until cancelled or replaced */
  policyTermType?: PolicyTermType;
  /** Next annual review/renewal date (primarily for continuous policies) */
  nextReviewDate?: string;
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

  // ── Enriched quote fields ──
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
