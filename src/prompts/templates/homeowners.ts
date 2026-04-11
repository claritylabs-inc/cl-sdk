import type { DocumentTemplate } from "./index";

export const HOMEOWNERS_TEMPLATE: DocumentTemplate = {
  type: "homeowners",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    endorsements: "last 30%",
    conditions: "middle of document",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations"],
  optional: ["loss_history", "supplementary", "sections"],
};
