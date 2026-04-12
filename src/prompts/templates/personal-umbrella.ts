import type { DocumentTemplate } from "./index";

export const PERSONAL_UMBRELLA_TEMPLATE: DocumentTemplate = {
  type: "personal_umbrella",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "underlying_insurance_schedule", "self_insured_retention",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    underlying_insurance_schedule: "first 5 pages, lists required underlying policies",
    endorsements: "last 25%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "underlying_insurance_schedule"],
  optional: ["self_insured_retention", "loss_history", "supplementary", "sections"],
};
