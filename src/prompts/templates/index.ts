export interface DocumentTemplate {
  type: string;
  expectedSections: string[];
  pageHints: Record<string, string>;
  required: string[];
  optional: string[];
}

import { HOMEOWNERS_TEMPLATE } from "./homeowners";
import { PERSONAL_AUTO_TEMPLATE } from "./personal-auto";
import { GENERAL_LIABILITY_TEMPLATE } from "./general-liability";
import { COMMERCIAL_PROPERTY_TEMPLATE } from "./commercial-property";
import { COMMERCIAL_AUTO_TEMPLATE } from "./commercial-auto";
import { WORKERS_COMP_TEMPLATE } from "./workers-comp";
import { UMBRELLA_EXCESS_TEMPLATE } from "./umbrella-excess";
import { PROFESSIONAL_LIABILITY_TEMPLATE } from "./professional-liability";
import { CYBER_TEMPLATE } from "./cyber";
import { DIRECTORS_OFFICERS_TEMPLATE } from "./directors-officers";
import { CRIME_TEMPLATE } from "./crime";
import { DWELLING_FIRE_TEMPLATE } from "./dwelling-fire";
import { FLOOD_TEMPLATE } from "./flood";
import { EARTHQUAKE_TEMPLATE } from "./earthquake";
import { PERSONAL_UMBRELLA_TEMPLATE } from "./personal-umbrella";
import { PERSONAL_ARTICLES_TEMPLATE } from "./personal-articles";
import { WATERCRAFT_TEMPLATE } from "./watercraft";
import { RECREATIONAL_VEHICLE_TEMPLATE } from "./recreational-vehicle";
import { FARM_RANCH_TEMPLATE } from "./farm-ranch";
import { DEFAULT_TEMPLATE } from "./default";

const TEMPLATE_MAP: Record<string, DocumentTemplate> = {
  homeowners_ho3: HOMEOWNERS_TEMPLATE,
  homeowners_ho5: HOMEOWNERS_TEMPLATE,
  renters_ho4: HOMEOWNERS_TEMPLATE,
  condo_ho6: HOMEOWNERS_TEMPLATE,
  mobile_home: HOMEOWNERS_TEMPLATE,
  personal_auto: PERSONAL_AUTO_TEMPLATE,
  dwelling_fire: DWELLING_FIRE_TEMPLATE,
  flood_nfip: FLOOD_TEMPLATE,
  flood_private: FLOOD_TEMPLATE,
  earthquake: EARTHQUAKE_TEMPLATE,
  personal_umbrella: PERSONAL_UMBRELLA_TEMPLATE,
  personal_inland_marine: PERSONAL_ARTICLES_TEMPLATE,
  watercraft: WATERCRAFT_TEMPLATE,
  recreational_vehicle: RECREATIONAL_VEHICLE_TEMPLATE,
  farm_ranch: FARM_RANCH_TEMPLATE,
  general_liability: GENERAL_LIABILITY_TEMPLATE,
  commercial_property: COMMERCIAL_PROPERTY_TEMPLATE,
  commercial_auto: COMMERCIAL_AUTO_TEMPLATE,
  workers_comp: WORKERS_COMP_TEMPLATE,
  umbrella: UMBRELLA_EXCESS_TEMPLATE,
  excess_liability: UMBRELLA_EXCESS_TEMPLATE,
  professional_liability: PROFESSIONAL_LIABILITY_TEMPLATE,
  cyber: CYBER_TEMPLATE,
  directors_officers: DIRECTORS_OFFICERS_TEMPLATE,
  crime_fidelity: CRIME_TEMPLATE,
};

export function getTemplate(policyType: string): DocumentTemplate {
  return TEMPLATE_MAP[policyType] ?? DEFAULT_TEMPLATE;
}
