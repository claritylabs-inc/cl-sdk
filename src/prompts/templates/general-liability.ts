import type { DocumentTemplate } from "./index";

export const GENERAL_LIABILITY_TEMPLATE: DocumentTemplate = {
  type: "general_liability",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "schedule_of_locations", "classification_schedule", "additional_insureds",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    schedule_of_locations: "first 10 pages, after declarations",
    classification_schedule: "first 10 pages, class codes and rates",
    additional_insureds: "endorsements section, last 30%",
    endorsements: "last 30%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "classification_schedule",
  ],
  optional: [
    "schedule_of_locations", "additional_insureds", "loss_history",
    "supplementary", "sections",
  ],
};
