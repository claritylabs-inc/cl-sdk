// Commercial lines declarations variants (retrofit from flat BaseDocument fields)

import type { CoverageForm, DefenseCostTreatment, ValuationMethod } from "../enums";
import type { ExtendedReportingPeriod } from "../shared";
import type { InsuredLocation, InsuredVehicle, ClassificationCode, EmployersLiabilityLimits } from "../declarations";
import type { ExperienceMod } from "../loss-history";

export interface GLDeclarations {
  line: "gl";
  coverageForm?: CoverageForm;
  perOccurrenceLimit?: string;
  generalAggregate?: string;
  productsCompletedOpsAggregate?: string;
  personalAdvertisingInjury?: string;
  fireDamage?: string;
  medicalExpense?: string;
  defenseCostTreatment?: DefenseCostTreatment;
  deductible?: string;
  classifications?: ClassificationCode[];
  retroactiveDate?: string;
}

export interface CommercialPropertyDeclarations {
  line: "commercial_property";
  causesOfLossForm?: "basic" | "broad" | "special";
  coinsurancePercent?: number;
  valuationMethod?: ValuationMethod;
  locations: InsuredLocation[];
  blanketLimit?: string;
  businessIncomeLimit?: string;
  extraExpenseLimit?: string;
}

export interface CommercialAutoDeclarations {
  line: "commercial_auto";
  vehicles: InsuredVehicle[];
  coveredAutoSymbols?: number[];
  liabilityLimit?: string;
  umLimit?: string;
  uimLimit?: string;
  hiredAutoLiability?: boolean;
  nonOwnedAutoLiability?: boolean;
}

export interface WorkersCompDeclarations {
  line: "workers_comp";
  coveredStates?: string[];
  classifications: ClassificationCode[];
  experienceMod?: ExperienceMod;
  employersLiability?: EmployersLiabilityLimits;
}

export interface UmbrellaExcessDeclarations {
  line: "umbrella_excess";
  perOccurrenceLimit?: string;
  aggregateLimit?: string;
  retention?: string;
  underlyingPolicies: Array<{
    carrier?: string;
    policyNumber?: string;
    policyType?: string;
    limits?: string;
  }>;
}

export interface ProfessionalLiabilityDeclarations {
  line: "professional_liability";
  perClaimLimit?: string;
  aggregateLimit?: string;
  retroactiveDate?: string;
  defenseCostTreatment?: DefenseCostTreatment;
  extendedReportingPeriod?: ExtendedReportingPeriod;
}

export interface CyberDeclarations {
  line: "cyber";
  aggregateLimit?: string;
  retroactiveDate?: string;
  waitingPeriodHours?: number;
  sublimits?: Array<{
    coverageName: string;
    limit: string;
  }>;
}

export interface DODeclarations {
  line: "directors_officers";
  sideALimit?: string;
  sideBLimit?: string;
  sideCLimit?: string;
  sideARetention?: string;
  sideBRetention?: string;
  sideCRetention?: string;
  continuityDate?: string;
}

export interface CrimeDeclarations {
  line: "crime";
  formType?: "discovery" | "loss_sustained";
  agreements: Array<{
    agreement: string;
    coverageName: string;
    limit: string;
    deductible: string;
  }>;
}
