// Framework-agnostic document interfaces for the insurance intelligence engine

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
