import type { DocumentTemplate } from "./index";

export const WORKERS_COMP_TEMPLATE: DocumentTemplate = {
  type: "workers_comp",
  expectedSections: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "classification_schedule", "experience_modification", "state_schedule",
    "employers_liability", "endorsements", "exclusions", "conditions",
    "premium_breakdown", "loss_history",
  ],
  pageHints: {
    declarations: "first 5 pages",
    classification_schedule: "first 10 pages, class codes, payroll, and rates",
    experience_modification: "first 5 pages, experience mod factor on declarations",
    state_schedule: "first 10 pages, covered states and class codes per state",
    employers_liability: "declarations page, Part Two limits",
    loss_history: "end of document or separate schedule",
    endorsements: "last 25%",
  },
  required: [
    "carrier_info", "named_insured", "coverage_limits", "declarations",
    "classification_schedule", "experience_modification",
  ],
  optional: [
    "state_schedule", "employers_liability", "loss_history",
    "supplementary", "sections",
  ],
};
