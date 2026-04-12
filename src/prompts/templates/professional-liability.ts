import type { DocumentTemplate } from "./index";

export const PROFESSIONAL_LIABILITY_TEMPLATE: DocumentTemplate = {
  type: "professional_liability",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "retroactive_date", "extended_reporting_period", "defense_costs",
    "covered_professional_services", "endorsements", "exclusions",
    "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    retroactive_date: "declarations page, claims-made trigger",
    extended_reporting_period: "conditions section, tail coverage options",
    defense_costs: "coverage form, whether inside or outside limits",
    covered_professional_services: "declarations or coverage form, scope of practice",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "retroactive_date", "covered_professional_services",
  ],
  optional: [
    "extended_reporting_period", "defense_costs", "loss_history",
    "supplementary", "sections",
  ],
};
