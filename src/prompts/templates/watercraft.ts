import type { DocumentTemplate } from "./index";

export const WATERCRAFT_TEMPLATE: DocumentTemplate = {
  type: "watercraft",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "vessel_schedule", "navigation_limits", "trailer_coverage",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    vessel_schedule: "first 5 pages, hull details and motor info",
    navigation_limits: "middle of document, geographic restrictions",
    endorsements: "last 25%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "vessel_schedule"],
  optional: ["navigation_limits", "trailer_coverage", "loss_history", "supplementary", "sections"],
};
