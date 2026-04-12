import type { DocumentTemplate } from "./index";

export const FARM_RANCH_TEMPLATE: DocumentTemplate = {
  type: "farm_ranch",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "dwelling_schedule", "farm_structures_schedule", "livestock_schedule",
    "equipment_schedule", "farm_liability", "endorsements", "exclusions",
    "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 3 pages",
    dwelling_schedule: "first 5 pages",
    farm_structures_schedule: "first half, barns/silos/outbuildings",
    livestock_schedule: "middle of document",
    equipment_schedule: "middle of document, machinery and implements",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "dwelling_schedule", "farm_liability",
  ],
  optional: [
    "farm_structures_schedule", "livestock_schedule", "equipment_schedule",
    "loss_history", "supplementary", "sections",
  ],
};
