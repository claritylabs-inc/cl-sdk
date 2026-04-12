import type { DocumentTemplate } from "./index";

export const COMMERCIAL_PROPERTY_TEMPLATE: DocumentTemplate = {
  type: "commercial_property",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "building_schedule", "business_personal_property", "business_income",
    "causes_of_loss_form", "coinsurance", "endorsements", "exclusions",
    "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    building_schedule: "first 10 pages, location and building details",
    causes_of_loss_form: "middle of document, basic/broad/special form",
    coinsurance: "conditions section, percentage requirement",
    endorsements: "last 30%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "building_schedule", "causes_of_loss_form",
  ],
  optional: [
    "business_personal_property", "business_income", "coinsurance",
    "loss_history", "supplementary", "sections",
  ],
};
