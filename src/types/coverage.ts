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
