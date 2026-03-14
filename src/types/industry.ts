export type Vertical = {
  value: string;
  label: string;
};

export type Industry = {
  value: string;
  label: string;
  verticals: Vertical[];
};

export const INDUSTRIES: Industry[] = [
  {
    value: "agriculture",
    label: "Agriculture & Farming",
    verticals: [
      { value: "crop_farming", label: "Crop Farming" },
      { value: "livestock", label: "Livestock & Ranching" },
      { value: "nursery_greenhouse", label: "Nursery & Greenhouse" },
      { value: "aquaculture", label: "Aquaculture" },
      { value: "forestry_logging", label: "Forestry & Logging" },
    ],
  },
  {
    value: "mining_oil_gas",
    label: "Mining, Oil & Gas",
    verticals: [
      { value: "oil_gas_extraction", label: "Oil & Gas Extraction" },
      { value: "drilling_services", label: "Drilling Services" },
      { value: "mining", label: "Mining & Quarrying" },
      { value: "renewable_energy", label: "Renewable Energy" },
    ],
  },
  {
    value: "utilities",
    label: "Utilities",
    verticals: [
      { value: "electric_power", label: "Electric Power" },
      { value: "natural_gas", label: "Natural Gas Distribution" },
      { value: "water_wastewater", label: "Water & Wastewater" },
      { value: "telecom", label: "Telecommunications" },
    ],
  },
  {
    value: "construction",
    label: "Construction",
    verticals: [
      { value: "general_contractor", label: "General Contractor" },
      { value: "residential_builder", label: "Residential Builder" },
      { value: "specialty_trades", label: "Specialty Trades (Elec/Plumb/HVAC)" },
      { value: "roofing", label: "Roofing & Siding" },
      { value: "civil_infrastructure", label: "Civil & Infrastructure" },
    ],
  },
  {
    value: "manufacturing",
    label: "Manufacturing",
    verticals: [
      { value: "food_beverage_mfg", label: "Food & Beverage" },
      { value: "chemicals_plastics", label: "Chemicals & Plastics" },
      { value: "metals_fabrication", label: "Metals & Fabrication" },
      { value: "electronics_mfg", label: "Electronics" },
      { value: "medical_devices", label: "Medical Devices" },
      { value: "textiles_apparel_mfg", label: "Textiles & Apparel" },
    ],
  },
  {
    value: "wholesale_distribution",
    label: "Wholesale & Distribution",
    verticals: [
      { value: "durable_goods", label: "Durable Goods" },
      { value: "food_beverage_dist", label: "Food & Beverage" },
      { value: "medical_pharma_dist", label: "Medical & Pharma" },
      { value: "ecommerce_fulfillment", label: "E-Commerce Fulfillment" },
    ],
  },
  {
    value: "retail",
    label: "Retail",
    verticals: [
      { value: "grocery", label: "Grocery & Supermarket" },
      { value: "apparel_retail", label: "Apparel & Fashion" },
      { value: "auto_dealers", label: "Auto Dealers" },
      { value: "electronics_retail", label: "Electronics & Appliances" },
      { value: "ecommerce", label: "E-Commerce" },
    ],
  },
  {
    value: "transportation_logistics",
    label: "Transportation & Logistics",
    verticals: [
      { value: "trucking_freight", label: "Trucking & Freight" },
      { value: "courier_delivery", label: "Courier & Delivery" },
      { value: "air_cargo", label: "Air Cargo & Airlines" },
      { value: "warehousing", label: "Warehousing & Storage" },
      { value: "maritime", label: "Maritime & Shipping" },
    ],
  },
  {
    value: "technology",
    label: "Technology & Software",
    verticals: [
      { value: "saas", label: "SaaS" },
      { value: "it_consulting", label: "IT Consulting" },
      { value: "cybersecurity", label: "Cybersecurity" },
      { value: "data_ai", label: "Data & AI" },
      { value: "fintech", label: "Fintech" },
      { value: "digital_media", label: "Digital Media" },
    ],
  },
  {
    value: "financial_services",
    label: "Financial Services",
    verticals: [
      { value: "banking", label: "Banking" },
      { value: "investment_mgmt", label: "Investment Management" },
      { value: "insurance_brokerage", label: "Insurance Brokerage" },
      { value: "accounting_cpa", label: "Accounting & CPA" },
      { value: "mortgage_lending", label: "Mortgage & Lending" },
    ],
  },
  {
    value: "real_estate",
    label: "Real Estate",
    verticals: [
      { value: "residential_re", label: "Residential Real Estate" },
      { value: "commercial_re", label: "Commercial Real Estate" },
      { value: "property_management", label: "Property Management" },
      { value: "landlord", label: "Landlord" },
    ],
  },
  {
    value: "professional_services",
    label: "Professional Services",
    verticals: [
      { value: "legal", label: "Legal / Law Firm" },
      { value: "engineering_architecture", label: "Engineering & Architecture" },
      { value: "management_consulting", label: "Management Consulting" },
      { value: "marketing_pr", label: "Marketing & PR" },
      { value: "staffing_recruiting", label: "Staffing & Recruiting" },
    ],
  },
  {
    value: "business_services",
    label: "Business Services",
    verticals: [
      { value: "security_services", label: "Security Services" },
      { value: "cleaning_janitorial", label: "Cleaning & Janitorial" },
      { value: "facilities_mgmt", label: "Facilities Management" },
      { value: "waste_management", label: "Waste Management" },
    ],
  },
  {
    value: "education",
    label: "Education",
    verticals: [
      { value: "k12_private", label: "K-12 Private School" },
      { value: "higher_ed", label: "Higher Education" },
      { value: "childcare_daycare", label: "Childcare & Daycare" },
      { value: "edtech", label: "EdTech" },
      { value: "tutoring_training", label: "Tutoring & Training" },
    ],
  },
  {
    value: "healthcare",
    label: "Healthcare & Life Sciences",
    verticals: [
      { value: "hospitals", label: "Hospitals & Health Systems" },
      { value: "physician_practices", label: "Physician Practices" },
      { value: "dental", label: "Dental Practices" },
      { value: "mental_health", label: "Mental Health & Counseling" },
      { value: "biotech_pharma", label: "Biotech & Pharma" },
      { value: "home_health", label: "Home Health & Hospice" },
    ],
  },
  {
    value: "hospitality_entertainment",
    label: "Hospitality & Entertainment",
    verticals: [
      { value: "restaurants", label: "Restaurants" },
      { value: "bars_nightlife", label: "Bars & Nightlife" },
      { value: "hotels_lodging", label: "Hotels & Lodging" },
      { value: "fitness_wellness", label: "Fitness & Wellness" },
      { value: "event_venues", label: "Event Venues" },
      { value: "catering", label: "Catering" },
    ],
  },
  {
    value: "personal_consumer_services",
    label: "Personal & Consumer Services",
    verticals: [
      { value: "auto_repair", label: "Auto Repair & Body Shop" },
      { value: "hair_salons", label: "Hair Salons & Barbershops" },
      { value: "pet_care", label: "Pet Care & Veterinary" },
      { value: "nonprofits", label: "Nonprofits & Associations" },
      { value: "funeral_services", label: "Funeral Services" },
    ],
  },
];
