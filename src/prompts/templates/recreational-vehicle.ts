import type { DocumentTemplate } from "./index";

export const RECREATIONAL_VEHICLE_TEMPLATE: DocumentTemplate = {
  type: "recreational_vehicle",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "vehicle_schedule", "accessory_schedule", "total_loss_replacement",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    vehicle_schedule: "first 5 pages, RV/ATV/snowmobile details",
    accessory_schedule: "near vehicle schedule, aftermarket equipment",
    endorsements: "last 25%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "vehicle_schedule"],
  optional: ["accessory_schedule", "total_loss_replacement", "loss_history", "supplementary", "sections"],
};
