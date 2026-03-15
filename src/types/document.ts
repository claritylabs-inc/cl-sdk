// Framework-agnostic document interfaces for the insurance intelligence engine

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
}

export interface PolicyDocument extends BaseDocument {
  type: "policy";
  policyNumber: string;
  effectiveDate: string;
  expirationDate: string;
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
}

export type InsuranceDocument = PolicyDocument | QuoteDocument;
