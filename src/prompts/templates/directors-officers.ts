import type { DocumentTemplate } from "./index";

export const DIRECTORS_OFFICERS_TEMPLATE: DocumentTemplate = {
  type: "directors_officers",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "retroactive_date", "side_a_coverage", "side_b_coverage", "side_c_coverage",
    "insured_persons_definition", "defense_costs", "extended_reporting_period",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    retroactive_date: "declarations page, claims-made trigger",
    side_a_coverage: "coverage form, non-indemnifiable loss to directors/officers",
    side_b_coverage: "coverage form, corporate reimbursement",
    side_c_coverage: "coverage form, entity securities coverage (if public)",
    insured_persons_definition: "definitions section, who qualifies as insured",
    defense_costs: "coverage form, advancement of defense costs",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "retroactive_date", "insured_persons_definition",
  ],
  optional: [
    "side_a_coverage", "side_b_coverage", "side_c_coverage",
    "defense_costs", "extended_reporting_period", "loss_history",
    "supplementary", "sections",
  ],
};
