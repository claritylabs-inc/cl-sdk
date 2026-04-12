import type { DocumentTemplate } from "./index";

export const COMMERCIAL_AUTO_TEMPLATE: DocumentTemplate = {
  type: "commercial_auto",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "vehicle_schedule", "driver_schedule", "hired_auto", "non_owned_auto",
    "cargo_coverage", "endorsements", "exclusions", "conditions",
    "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    vehicle_schedule: "first 10 pages, VINs and coverage symbols",
    driver_schedule: "first 10 pages, near vehicle schedule",
    hired_auto: "endorsements or coverage form",
    cargo_coverage: "middle of document, motor truck cargo",
    endorsements: "last 30%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "vehicle_schedule",
  ],
  optional: [
    "driver_schedule", "hired_auto", "non_owned_auto", "cargo_coverage",
    "loss_history", "supplementary", "sections",
  ],
};
