import type { DocumentTemplate } from "./index";

export const EARTHQUAKE_TEMPLATE: DocumentTemplate = {
  type: "earthquake",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "deductible_schedule", "property_description", "endorsements",
    "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    deductible_schedule: "first 5 pages, percentage-based deductibles",
    property_description: "first half of document",
    endorsements: "last 20%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "deductible_schedule"],
  optional: ["property_description", "loss_history", "supplementary", "sections"],
};
