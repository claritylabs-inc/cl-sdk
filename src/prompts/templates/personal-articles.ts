import type { DocumentTemplate } from "./index";

export const PERSONAL_ARTICLES_TEMPLATE: DocumentTemplate = {
  type: "personal_inland_marine",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "scheduled_articles", "valuation_method", "endorsements",
    "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    scheduled_articles: "first half, itemized list with appraised values",
    endorsements: "last 20%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "scheduled_articles"],
  optional: ["valuation_method", "loss_history", "supplementary", "sections"],
};
