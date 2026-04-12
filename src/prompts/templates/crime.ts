import type { DocumentTemplate } from "./index";

export const CRIME_TEMPLATE: DocumentTemplate = {
  type: "crime_fidelity",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "employee_theft", "forgery_alteration", "computer_fraud",
    "funds_transfer_fraud", "social_engineering", "discovery_period",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    employee_theft: "coverage form, Insuring Agreement A",
    forgery_alteration: "coverage form, Insuring Agreement B",
    computer_fraud: "coverage form, Insuring Agreement C/D",
    funds_transfer_fraud: "coverage form, Insuring Agreement E",
    social_engineering: "endorsement, voluntary parting/invoice manipulation",
    discovery_period: "conditions section, discovery vs loss-sustained trigger",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "employee_theft",
  ],
  optional: [
    "forgery_alteration", "computer_fraud", "funds_transfer_fraud",
    "social_engineering", "discovery_period", "loss_history",
    "supplementary", "sections",
  ],
};
