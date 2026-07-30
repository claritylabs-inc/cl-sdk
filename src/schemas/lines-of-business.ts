import { z } from "zod";
import {
  ACORD_LOB_CODES,
  ACORD_LOB_ENTRIES,
  ACORD_LOB_LABELS,
  ACORD_LOB_SOURCE_HEADERS,
  ACORD_LOB_SOURCE_ROWS,
} from "./acord-taxonomy.generated";

export {
  ACORD_LOB_CODES,
  ACORD_LOB_ENTRIES,
  ACORD_LOB_LABELS,
  ACORD_LOB_SOURCE_HEADERS,
  ACORD_LOB_SOURCE_ROWS,
};

export const AcordLobCodeSchema = z.enum(ACORD_LOB_CODES);
export type AcordLobCode = (typeof ACORD_LOB_CODES)[number];

export const EXCLUDED_ACORD_LOB_CODES = new Set([
  "INTER",
  "PAPER",
]);

export const LEGACY_ACORD_LOB_CODE_TO_CURRENT: Readonly<Record<string, AcordLobCode>> = {
  AAPPL: "AIRC",
  APKG: "APKGE",
  ARVP: "RECV",
  CEQFL: "INMRC",
  COMAR: "COMR",
  EDP: "TECH",
  EQPFL: "INMRC",
  FINEA: "INMAR",
  GL: "CGL",
  GLASS: "PROP",
  INBR: "INMAR",
  MTRTK: "CARGO",
  PROPC: "PROP",
  SCHPR: "INMAR",
  SIGNS: "INMAR",
  TRANS: "MTRCR",
};

export const LEGACY_POLICY_TYPE_TO_LOB: Record<string, AcordLobCode[]> = {
  general_liability: ["CGL"],
  commercial_general_liability: ["CGL"],
  commercial_property: ["PROP"],
  commercial_auto: ["AUTOB"],
  non_owned_auto: ["AUTOB"],
  workers_comp: ["WORK"],
  umbrella: ["UMBRC"],
  excess_liability: ["EXLIA"],
  professional_liability: ["PL"],
  cyber: ["CYBER"],
  epli: ["EPLI"],
  directors_officers: ["DO"],
  fiduciary_liability: ["FIDUC"],
  crime_fidelity: ["CRIM"],
  inland_marine: ["INMRC"],
  builders_risk: ["INMRC"],
  environmental: ["OLIB"],
  ocean_marine: ["COMR"],
  surety: ["SURE"],
  product_liability: ["OLIB"],
  bop: ["BOP"],
  management_liability_package: ["MGMLI"],
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
  travel: ["TRVL"],
  identity_theft: ["UN"],
  title: ["UN"],
  other: ["UN"],
  unknown: ["UN"],
  auto: ["AUTOB"],
  crime: ["CRIM"],
  crim: ["CRIM"],
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

const LOB_CODE_BY_LABEL = new Map(
  ACORD_LOB_CODES.map((code) => [canonicalLegacyKey(ACORD_LOB_LABELS[code]), code]),
);

export function isLobCode(value: unknown): value is AcordLobCode {
  return typeof value === "string" && hasOwn(ACORD_LOB_LABELS, value);
}

function resolveLobCode(value: string): AcordLobCode | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isLobCode(trimmed)) return trimmed;
  if (trimmed.toLowerCase() === "motorcycle") return "Motorcycle";
  const byLabel = LOB_CODE_BY_LABEL.get(canonicalLegacyKey(trimmed));
  if (byLabel) return byLabel;
  const legacy = LEGACY_POLICY_TYPE_TO_LOB[canonicalLegacyKey(trimmed)];
  if (legacy?.[0]) return legacy[0];
  const upper = trimmed.toUpperCase();
  if (isLobCode(upper)) return upper;
  return LEGACY_ACORD_LOB_CODE_TO_CURRENT[upper];
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
    const byLabel = LOB_CODE_BY_LABEL.get(canonicalLegacyKey(trimmed));
    if (byLabel) {
      codes.push(byLabel);
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
    const legacyCode = LEGACY_ACORD_LOB_CODE_TO_CURRENT[upper];
    if (legacyCode) {
      codes.push(legacyCode);
      continue;
    }
    codes.push("UN");
  }
  const normalized = Array.from(new Set(codes));
  return normalized.some((code) => code !== "UN")
    ? normalized.filter((code) => code !== "UN")
    : ["UN"];
}

export function lobLabel(value: string): string {
  const code = resolveLobCode(value);
  return code ? ACORD_LOB_LABELS[code] : humanize(value);
}

export function isPersonalLob(code: string): boolean {
  return isLobCode(code) && PERSONAL_LOB_CODES.has(code);
}
