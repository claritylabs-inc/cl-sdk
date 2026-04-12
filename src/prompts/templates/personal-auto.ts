import type { DocumentTemplate } from "./index";

export const PERSONAL_AUTO_TEMPLATE: DocumentTemplate = {
  type: "personal_auto",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "vehicle_schedule", "driver_schedule", "endorsements", "exclusions",
    "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    vehicle_schedule: "first 5 pages, after declarations",
    driver_schedule: "first 5 pages, near vehicle schedule",
    endorsements: "last 30%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "vehicle_schedule"],
  optional: ["driver_schedule", "loss_history", "supplementary", "sections"],
};
