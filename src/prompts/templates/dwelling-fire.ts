import type { DocumentTemplate } from "./index";

export const DWELLING_FIRE_TEMPLATE: DocumentTemplate = {
  type: "dwelling_fire",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "property_description", "endorsements", "exclusions", "conditions",
    "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    property_description: "first 5 pages, after declarations",
    endorsements: "last 25%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "property_description"],
  optional: ["loss_history", "supplementary", "sections"],
};
