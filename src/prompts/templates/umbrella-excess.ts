import type { DocumentTemplate } from "./index";

export const UMBRELLA_EXCESS_TEMPLATE: DocumentTemplate = {
  type: "umbrella_excess",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "underlying_insurance_schedule", "self_insured_retention",
    "retained_limit", "defense_costs", "endorsements", "exclusions",
    "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    underlying_insurance_schedule: "first 10 pages, required underlying policies and limits",
    self_insured_retention: "declarations or first few pages",
    defense_costs: "coverage form, whether inside or outside limits",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "underlying_insurance_schedule",
  ],
  optional: [
    "self_insured_retention", "retained_limit", "defense_costs",
    "loss_history", "supplementary", "sections",
  ],
};
