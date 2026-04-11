import type { DocumentTemplate } from "./index";

export const CYBER_TEMPLATE: DocumentTemplate = {
  type: "cyber",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "retroactive_date", "first_party_coverages", "third_party_coverages",
    "incident_response", "sublimits_schedule", "waiting_period",
    "endorsements", "exclusions", "conditions", "premium_breakdown",
  ],
  pageHints: {
    declarations: "first 5 pages",
    retroactive_date: "declarations page, claims-made trigger",
    first_party_coverages: "coverage form, business interruption/data restoration/ransomware",
    third_party_coverages: "coverage form, privacy liability/network security",
    incident_response: "coverage form or endorsement, breach coach/forensics/notification",
    sublimits_schedule: "declarations or schedule, per-coverage sublimits",
    waiting_period: "first party section, hours before BI coverage triggers",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "first_party_coverages", "third_party_coverages",
  ],
  optional: [
    "retroactive_date", "incident_response", "sublimits_schedule",
    "waiting_period", "loss_history", "supplementary", "sections",
  ],
};
