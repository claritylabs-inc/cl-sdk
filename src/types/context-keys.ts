// Maps extracted policy fields → business context storage keys for application auto-fill
// Keys: (contextKey, category) together form the unique identifier — contextKey alone is not unique
// across commercial and personal lines (e.g., "construction_type" and "year_built" appear in both
// "premises" (commercial) and "property_info" (personal lines) with different source field paths).

export interface ContextKeyMapping {
  extractedField: string;
  category: "company_info" | "operations" | "financial" | "coverage" | "loss_history" | "premises" | "vehicles" | "employees" | "property_info" | "driver_info" | "vehicle_info" | "pet_info";
  contextKey: string;
  description: string;
}

export const CONTEXT_KEY_MAP: ContextKeyMapping[] = [
  { extractedField: "insuredName", category: "company_info", contextKey: "company_name", description: "Primary named insured" },
  { extractedField: "insuredDba", category: "company_info", contextKey: "dba_name", description: "Doing-business-as name" },
  { extractedField: "insuredAddress", category: "company_info", contextKey: "company_address", description: "Primary insured mailing address" },
  { extractedField: "insuredEntityType", category: "company_info", contextKey: "entity_type", description: "Legal entity type" },
  { extractedField: "insuredFein", category: "company_info", contextKey: "fein", description: "Federal Employer ID Number" },
  { extractedField: "insuredSicCode", category: "company_info", contextKey: "sic_code", description: "SIC classification code" },
  { extractedField: "insuredNaicsCode", category: "company_info", contextKey: "naics_code", description: "NAICS classification code" },
  { extractedField: "classifications[].description", category: "operations", contextKey: "description_of_operations", description: "Description of business operations" },
  { extractedField: "classifications[].basisAmount(payroll)", category: "operations", contextKey: "annual_payroll", description: "Annual payroll from classification schedule" },
  { extractedField: "classifications[].basisAmount(revenue)", category: "operations", contextKey: "annual_revenue", description: "Annual revenue from classification schedule" },
  { extractedField: "totalPremium", category: "financial", contextKey: "current_premium", description: "Total policy premium" },
  { extractedField: "locations[].buildingValue", category: "financial", contextKey: "total_property_values", description: "Sum of building values" },
  { extractedField: "locations[].contentsValue", category: "financial", contextKey: "total_contents_values", description: "Sum of contents values" },
  { extractedField: "policyTypes", category: "coverage", contextKey: "coverage_types", description: "Lines of business covered" },
  { extractedField: "coverages[].limit", category: "coverage", contextKey: "current_limits", description: "Current coverage limits" },
  { extractedField: "coverages[].deductible", category: "coverage", contextKey: "current_deductibles", description: "Current deductibles" },
  { extractedField: "experienceMod.factor", category: "loss_history", contextKey: "experience_mod", description: "Workers comp experience modification factor" },
  { extractedField: "lossSummary.totalClaims", category: "loss_history", contextKey: "total_claims", description: "Total claim count from loss runs" },
  { extractedField: "locations[]", category: "premises", contextKey: "premises_addresses", description: "All insured location addresses" },
  { extractedField: "locations[].constructionType", category: "premises", contextKey: "construction_type", description: "Building construction type" },
  { extractedField: "locations[].yearBuilt", category: "premises", contextKey: "year_built", description: "Year built for primary location" },
  { extractedField: "locations[].sprinklered", category: "premises", contextKey: "sprinkler_system", description: "Sprinkler system presence" },
  { extractedField: "vehicles[]", category: "vehicles", contextKey: "vehicle_schedule", description: "Complete vehicle schedule" },
  { extractedField: "vehicles[].length", category: "vehicles", contextKey: "vehicle_count", description: "Number of insured vehicles" },
  { extractedField: "classifications[](WC)", category: "employees", contextKey: "employee_count_by_class", description: "Employee count by WC classification" },
  { extractedField: "classifications[].basisAmount(payroll,byState)", category: "employees", contextKey: "annual_payroll_by_state", description: "Annual payroll by state" },
  // ── Personal lines context keys (v1.3+) ──
  { extractedField: "declarations.dwelling.yearBuilt", category: "property_info", contextKey: "year_built", description: "Year dwelling was built" },
  { extractedField: "declarations.dwelling.constructionType", category: "property_info", contextKey: "construction_type", description: "Dwelling construction type" },
  { extractedField: "declarations.dwelling.squareFootage", category: "property_info", contextKey: "square_footage", description: "Dwelling square footage" },
  { extractedField: "declarations.dwelling.roofType", category: "property_info", contextKey: "roof_type", description: "Roof material type" },
  { extractedField: "declarations.dwelling.roofAge", category: "property_info", contextKey: "roof_age", description: "Roof age in years" },
  { extractedField: "declarations.dwelling.stories", category: "property_info", contextKey: "num_stories", description: "Number of stories" },
  { extractedField: "declarations.dwelling.heatingType", category: "property_info", contextKey: "heating_type", description: "Heating system type" },
  { extractedField: "declarations.dwelling.protectiveDevices", category: "property_info", contextKey: "protective_devices", description: "Alarm, sprinkler, deadbolt, smoke detector" },
  { extractedField: "declarations.coverageA", category: "coverage", contextKey: "dwelling_coverage_limit", description: "Homeowners Coverage A dwelling limit" },
  { extractedField: "declarations.coverageE", category: "coverage", contextKey: "personal_liability_limit", description: "Homeowners Coverage E personal liability" },
  { extractedField: "declarations.drivers[].name", category: "driver_info", contextKey: "driver_names", description: "Listed driver names" },
  { extractedField: "declarations.drivers[].licenseNumber", category: "driver_info", contextKey: "driver_license_numbers", description: "Driver license numbers" },
  { extractedField: "declarations.vehicles[].vin", category: "vehicle_info", contextKey: "vehicle_vins", description: "Personal vehicle VINs" },
  { extractedField: "declarations.vehicles[].annualMileage", category: "vehicle_info", contextKey: "annual_mileage", description: "Annual mileage per vehicle" },
  { extractedField: "declarations.floodZone", category: "property_info", contextKey: "flood_zone", description: "FEMA flood zone designation" },
  { extractedField: "declarations.elevationCertificate", category: "property_info", contextKey: "has_elevation_cert", description: "Elevation certificate on file" },
  { extractedField: "declarations.mortgagee.name", category: "financial", contextKey: "mortgagee_name", description: "Mortgage holder name" },
  { extractedField: "insuredAddress", category: "company_info", contextKey: "primary_residence_address", description: "Primary insured residence address" },
  { extractedField: "declarations.petName", category: "pet_info", contextKey: "pet_name", description: "Insured pet name" },
  { extractedField: "declarations.species", category: "pet_info", contextKey: "pet_species", description: "Pet species (dog, cat, other)" },
  { extractedField: "declarations.breed", category: "pet_info", contextKey: "pet_breed", description: "Pet breed" },
];
