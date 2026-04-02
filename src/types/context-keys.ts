// Maps extracted policy fields → business context storage keys for application auto-fill

export interface ContextKeyMapping {
  extractedField: string;
  category: "company_info" | "operations" | "financial" | "coverage" | "loss_history" | "premises" | "vehicles" | "employees";
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
];
