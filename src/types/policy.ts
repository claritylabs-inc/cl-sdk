export const POLICY_TYPE_LABELS: Record<string, string> = {
  general_liability: "General Liability",
  workers_comp: "Workers' Compensation",
  commercial_auto: "Commercial Auto",
  property: "Property",
  umbrella: "Umbrella",
  professional_liability: "Professional Liability",
  cyber: "Cyber",
  epli: "EPLI",
  directors_officers: "Directors & Officers",
  non_owned_auto: "Non-Owned Auto",
  other: "Other",
};

export const INSURANCE_KEYWORDS = [
  "policy",
  "insurance",
  "coverage",
  "premium",
  "renewal",
  "certificate",
  "endorsement",
  "declaration",
  "binder",
  "liability",
  "deductible",
  "claim",
  "underwriting",
  "indemnity",
  "insured",
  "policyholder",
  "workers comp",
  "workers compensation",
  "commercial auto",
  "general liability",
  "umbrella",
  "property insurance",
  "cyber insurance",
  "professional liability",
  "errors and omissions",
  "directors and officers",
  "d&o",
  "epli",
  "COI",
  "certificate of insurance",
];

// Policy section type labels and colors
export const POLICY_SECTION_TYPE_LABELS: Record<string, string> = {
  declarations: "Declarations",
  insuring_agreement: "Insuring Agreement",
  policy_form: "Policy Form",
  endorsement: "Endorsement",
  application: "Application",
  exclusion: "Exclusion",
  condition: "Condition",
  definition: "Definition",
  schedule: "Schedule",
  subjectivity: "Subjectivity",
  warranty: "Warranty",
  notice: "Notice",
  regulatory: "Regulatory",
  other: "Other",
};

export const POLICY_SECTION_TYPE_COLORS: Record<string, string> = {
  declarations: "bg-blue-50 text-blue-600",
  insuring_agreement: "bg-green-50 text-green-600",
  policy_form: "bg-cyan-50 text-cyan-600",
  endorsement: "bg-sky-50 text-sky-600",
  application: "bg-lime-50 text-lime-600",
  exclusion: "bg-red-50 text-red-600",
  condition: "bg-amber-50 text-amber-600",
  definition: "bg-purple-50 text-purple-600",
  schedule: "bg-indigo-50 text-indigo-600",
  subjectivity: "bg-orange-50 text-orange-600",
  warranty: "bg-pink-50 text-pink-600",
  notice: "bg-teal-50 text-teal-600",
  regulatory: "bg-yellow-50 text-yellow-700",
  other: "bg-gray-50 text-gray-600",
};

// Quote section type labels and colors
export const QUOTE_SECTION_TYPE_LABELS: Record<string, string> = {
  terms_summary: "Terms Summary",
  premium_indication: "Premium Indication",
  underwriting_condition: "Underwriting Condition",
  subjectivity: "Subjectivity",
  coverage_summary: "Coverage Summary",
  exclusion: "Exclusion",
  other: "Other",
};

export const QUOTE_SECTION_TYPE_COLORS: Record<string, string> = {
  terms_summary: "bg-blue-50 text-blue-600",
  premium_indication: "bg-emerald-50 text-emerald-600",
  underwriting_condition: "bg-amber-50 text-amber-600",
  subjectivity: "bg-orange-50 text-orange-600",
  coverage_summary: "bg-green-50 text-green-600",
  exclusion: "bg-red-50 text-red-600",
  other: "bg-gray-50 text-gray-600",
};

export const INSURANCE_SENDER_PATTERNS = [
  "hartford",
  "liberty mutual",
  "travelers",
  "chubb",
  "nationwide",
  "state farm",
  "allstate",
  "progressive",
  "zurich",
  "aig",
  "berkshire",
  "geico",
  "usaa",
  "erie insurance",
  "hanover",
  "markel",
  "hiscox",
  "amtrust",
  "insurance",
  "underwriter",
  "broker",
];

// --- Framework-agnostic document interfaces ---

export interface PolicyDocument {
  id: string;
  policyTypes?: string[];
  policyType?: string;
  security?: string;
  carrier: string;
  summary?: string;
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
  insuredName: string;
  premium?: string;
  coverages: Array<{
    name: string;
    limit: string;
    deductible?: string;
    pageNumber?: number;
    sectionRef?: string;
  }>;
  document?: {
    sections?: Array<{
      title: string;
      sectionNumber?: string;
      pageStart: number;
      pageEnd?: number;
      type: string;
      coverageType?: string;
      content: string;
      subsections?: Array<{
        title: string;
        sectionNumber?: string;
        pageNumber?: number;
        content: string;
      }>;
    }>;
  };
}

export interface QuoteDocument {
  id: string;
  policyTypes?: string[];
  security?: string;
  carrier: string;
  summary?: string;
  quoteNumber: string;
  proposedEffectiveDate?: string;
  proposedExpirationDate?: string;
  quoteExpirationDate?: string;
  insuredName: string;
  premium?: string;
  coverages: Array<{
    name: string;
    proposedLimit: string;
    proposedDeductible?: string;
    pageNumber?: number;
    sectionRef?: string;
  }>;
  subjectivities?: Array<{ description: string; category?: string }>;
  underwritingConditions?: Array<{ description: string }>;
  premiumBreakdown?: Array<{ line: string; amount: string }>;
}
