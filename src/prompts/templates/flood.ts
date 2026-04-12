import type { DocumentTemplate } from "./index";

export const FLOOD_TEMPLATE: DocumentTemplate = {
  type: "flood",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "flood_zone_determination", "building_description", "endorsements",
    "exclusions", "conditions", "premium_breakdown", "waiting_period",
  ],
  pageHints: {
    declarations: "first 3 pages",
    flood_zone_determination: "first 5 pages, often on declarations",
    building_description: "first half of document",
    endorsements: "last 20%",
  },
  required: ["carrier_info", "named_insured", "coverage_limits", "declarations", "flood_zone_determination"],
  optional: ["building_description", "waiting_period", "loss_history", "supplementary", "sections"],
};
