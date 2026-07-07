import { z } from "zod";

export const ACORD_LOB_CODES = [
  "AAPPL",
  "AGLIA",
  "AGPP",
  "AGPR",
  "AIRC",
  "AIRPFB",
  "APKG",
  "APKGE",
  "APROD",
  "ARVP",
  "AUTO",
  "AUTOB",
  "AUTOP",
  "AVPKG",
  "BANDM",
  "BLANK",
  "BMISC",
  "BOAT",
  "BOP",
  "BOPGL",
  "BOPPR",
  "CAVN",
  "CEQFL",
  "CFIRE",
  "CFRM",
  "CGL",
  "COMAR",
  "COMR",
  "CONTR",
  "CPKGE",
  "CPMP",
  "CRIME",
  "DFIRE",
  "DISAB",
  "DO",
  "EDP",
  "EL",
  "EO",
  "EPLI",
  "EQ",
  "EQPFL",
  "EXLIA",
  "FIDTY",
  "FIDUC",
  "FINEA",
  "FLOOD",
  "GARAG",
  "GL",
  "GLASS",
  "HANG",
  "HBB",
  "HOME",
  "INBR",
  "INMAR",
  "INMRC",
  "INMRP",
  "JUDCL",
  "KIDRA",
  "LL",
  "MHOME",
  "MMAL",
  "Motorcycle",
  "MTRTK",
  "OLIB",
  "PHYS",
  "PKG",
  "PL",
  "PLMSC",
  "PPKGE",
  "PROP",
  "PROPC",
  "PUBOF",
  "RECV",
  "SCHPR",
  "SIGNS",
  "SMP",
  "SURE",
  "TRANS",
  "TRUCK",
  "UMBRC",
  "UMBRL",
  "UMBRP",
  "UN",
  "WCMA",
  "WIND",
  "WORK",
  "WORKP",
  "WORKV",
] as const;

export const AcordLobCodeSchema = z.enum(ACORD_LOB_CODES);
export type AcordLobCode = z.infer<typeof AcordLobCodeSchema>;

export const ACORD_LOB_LABELS: Record<AcordLobCode, string> = {
  AAPPL: "Aircraft / Aerial Applicator",
  AGLIA: "Agricultural Liability",
  AGPP: "Agricultural Personal Property",
  AGPR: "Agricultural Property",
  AIRC: "Aircraft",
  AIRPFB: "Airport / Fixed Base Operator",
  APKG: "Agricultural Package",
  APKGE: "Agricultural Package (Extended)",
  APROD: "Agricultural Products",
  ARVP: "Recreational Vehicle Package",
  AUTO: "Automobile",
  AUTOB: "Business Auto",
  AUTOP: "Personal Auto",
  AVPKG: "Aviation Package",
  BANDM: "Boiler & Machinery",
  BLANK: "Blanket",
  BMISC: "Business Miscellaneous",
  BOAT: "Boat",
  BOP: "Businessowners Policy",
  BOPGL: "BOP - General Liability",
  BOPPR: "BOP - Property",
  CAVN: "Commercial Aviation",
  CEQFL: "Contractors Equipment Floater",
  CFIRE: "Commercial Fire",
  CFRM: "Commercial Farm",
  CGL: "Commercial General Liability",
  COMAR: "Commercial Marine / Ocean Marine",
  COMR: "Commercial (misc.)",
  CONTR: "Contractors",
  CPKGE: "Commercial Package",
  CPMP: "Commercial Package (multi-peril)",
  CRIME: "Crime",
  DFIRE: "Dwelling Fire",
  DISAB: "Disability",
  DO: "Directors & Officers Liability",
  EDP: "Electronic Data Processing",
  EL: "Employers Liability",
  EO: "Errors & Omissions",
  EPLI: "Employment Practices Liability",
  EQ: "Earthquake",
  EQPFL: "Equipment Floater",
  EXLIA: "Excess Liability",
  FIDTY: "Fidelity",
  FIDUC: "Fiduciary Liability",
  FINEA: "Fine Arts",
  FLOOD: "Flood",
  GARAG: "Garage",
  GL: "General Liability",
  GLASS: "Glass",
  HANG: "Hangar (Aviation)",
  HBB: "Home-Based Business",
  HOME: "Homeowners",
  INBR: "Inland Marine - Brokers",
  INMAR: "Inland Marine",
  INMRC: "Inland Marine - Commercial",
  INMRP: "Inland Marine - Personal",
  JUDCL: "Judicial Bonds",
  KIDRA: "Kidnap & Ransom",
  LL: "Liquor Liability",
  MHOME: "Mobile Home",
  MMAL: "Medical Malpractice",
  Motorcycle: "Motorcycle",
  MTRTK: "Motor Truck Cargo",
  OLIB: "Other Liability",
  PHYS: "Physical Damage",
  PKG: "Package",
  PL: "Professional Liability",
  PLMSC: "Personal Lines Miscellaneous",
  PPKGE: "Personal Package",
  PROP: "Property",
  PROPC: "Property - Commercial",
  PUBOF: "Public Officials Liability",
  RECV: "Recreational Vehicle",
  SCHPR: "Scheduled Property",
  SIGNS: "Signs",
  SMP: "Special Multi-Peril",
  SURE: "Surety",
  TRANS: "Transportation",
  TRUCK: "Trucking",
  UMBRC: "Umbrella - Commercial",
  UMBRL: "Umbrella",
  UMBRP: "Umbrella - Personal",
  UN: "Unspecified / Unknown",
  WCMA: "Workers Comp - Monopolistic/State",
  WIND: "Wind",
  WORK: "Workers Compensation",
  WORKP: "Workers Compensation (Personal/Package)",
  WORKV: "Workers Compensation (Voluntary)",
};

export const EXCLUDED_ACORD_LOB_CODES = new Set([
  "ACHE",
  "INTER",
  "LICPT",
  "LSTIN",
  "NWFGR",
  "PAPER",
  "SCAP",
  "SFRNC",
]);

export const LEGACY_POLICY_TYPE_TO_LOB: Record<string, AcordLobCode[]> = {
  general_liability: ["CGL"],
  commercial_property: ["PROPC"],
  commercial_auto: ["AUTOB"],
  non_owned_auto: ["AUTOB"],
  workers_comp: ["WORK"],
  umbrella: ["UMBRC"],
  excess_liability: ["EXLIA"],
  professional_liability: ["EO"],
  cyber: ["OLIB"],
  epli: ["EPLI"],
  directors_officers: ["DO"],
  fiduciary_liability: ["FIDUC"],
  crime_fidelity: ["CRIME"],
  inland_marine: ["INMRC"],
  builders_risk: ["INMRC"],
  environmental: ["OLIB"],
  ocean_marine: ["COMAR"],
  surety: ["SURE"],
  product_liability: ["OLIB"],
  bop: ["BOP"],
  management_liability_package: ["DO", "EPLI", "FIDUC"],
  property: ["PROP"],
  homeowners_ho3: ["HOME"],
  homeowners_ho5: ["HOME"],
  renters_ho4: ["HOME"],
  condo_ho6: ["HOME"],
  dwelling_fire: ["DFIRE"],
  mobile_home: ["MHOME"],
  personal_auto: ["AUTOP"],
  personal_umbrella: ["UMBRP"],
  flood_nfip: ["FLOOD"],
  flood_private: ["FLOOD"],
  earthquake: ["EQ"],
  personal_inland_marine: ["INMRP"],
  watercraft: ["BOAT"],
  recreational_vehicle: ["RECV"],
  farm_ranch: ["CFRM"],
  life: ["UN"],
  critical_illness: ["DISAB"],
  disability: ["DISAB"],
  long_term_care: ["UN"],
  pet: ["UN"],
  travel: ["UN"],
  identity_theft: ["UN"],
  title: ["UN"],
  other: ["UN"],
  unknown: ["UN"],
  auto: ["AUTOB"],
  crime: ["CRIME"],
  crim: ["CRIME"],
  fiduciary: ["FIDUC"],
  d_and_o: ["DO"],
  d_o: ["DO"],
  homeowners: ["HOME"],
  renters: ["HOME"],
  flood: ["FLOOD"],
  boat: ["BOAT"],
  motorcycle: ["Motorcycle"],
};

export const PERSONAL_LOB_CODES = new Set<AcordLobCode>([
  "AUTOP",
  "HOME",
  "MHOME",
  "DFIRE",
  "FLOOD",
  "EQ",
  "INMRP",
  "UMBRP",
  "BOAT",
  "RECV",
  "Motorcycle",
  "PPKGE",
  "DISAB",
  "PLMSC",
  "HBB",
]);

function hasOwn<T extends object>(object: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function canonicalLegacyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function humanize(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isLobCode(value: unknown): value is AcordLobCode {
  return typeof value === "string" && hasOwn(ACORD_LOB_LABELS, value);
}

function resolveLobCode(value: string): AcordLobCode | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isLobCode(trimmed)) return trimmed;
  if (trimmed.toLowerCase() === "motorcycle") return "Motorcycle";
  const legacy = LEGACY_POLICY_TYPE_TO_LOB[canonicalLegacyKey(trimmed)];
  if (legacy?.[0]) return legacy[0];
  const upper = trimmed.toUpperCase();
  if (upper === "CRIM") return "CRIME";
  if (isLobCode(upper)) return upper;
  return undefined;
}

export function normalizeOperationalLinesOfBusiness(values: unknown): AcordLobCode[] {
  const source = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return toLobCodes(source);
}

export function toLobCodes(values?: readonly string[]): AcordLobCode[] {
  const source = values?.filter((value) => typeof value === "string" && value.trim()) ?? [];
  if (source.length === 0) return ["UN"];
  const codes: AcordLobCode[] = [];
  for (const value of source) {
    const trimmed = value.trim();
    if (isLobCode(trimmed)) {
      codes.push(trimmed);
      continue;
    }
    if (trimmed.toUpperCase() === "CRIM") {
      codes.push("CRIME");
      continue;
    }
    const mapped = LEGACY_POLICY_TYPE_TO_LOB[canonicalLegacyKey(trimmed)];
    if (mapped) {
      codes.push(...mapped);
      continue;
    }
    const upper = trimmed.toUpperCase();
    if (isLobCode(upper)) {
      codes.push(upper);
      continue;
    }
    codes.push("UN");
  }
  return Array.from(new Set(codes));
}

export function lobLabel(value: string): string {
  const code = resolveLobCode(value);
  return code ? ACORD_LOB_LABELS[code] : humanize(value);
}

export function isPersonalLob(code: string): boolean {
  return isLobCode(code) && PERSONAL_LOB_CODES.has(code);
}
