import type { DocumentTemplate } from "./index";

export const DEFAULT_TEMPLATE: DocumentTemplate = {
  type: "unknown",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits",
    "endorsements", "exclusions", "conditions", "premium_breakdown", "sections",
  ],
  pageHints: {
    declarations: "first 5 pages",
    endorsements: "last 25%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits"],
  optional: ["declarations", "loss_history", "supplementary", "endorsements", "exclusions", "conditions"],
};
