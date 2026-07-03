import { POLICY_TYPES } from "../schemas/enums";
import type { OperationalCoverageLine } from "./schemas";

const POLICY_TYPE_KEYS = new Set<string>(POLICY_TYPES);

const POLICY_TYPE_ALIASES: Record<string, string> = {
  "general liability": "general_liability",
  "commercial general liability": "general_liability",
  cgl: "general_liability",
  "commercial property": "commercial_property",
  property: "property",
  "property insurance": "commercial_property",
  "commercial auto": "commercial_auto",
  "commercial automobile": "commercial_auto",
  "business auto": "commercial_auto",
  "business automobile": "commercial_auto",
  "auto physical damage": "commercial_auto",
  "automobile physical damage": "commercial_auto",
  "hired non owned auto": "non_owned_auto",
  "hired non-owned auto": "non_owned_auto",
  "non owned auto": "non_owned_auto",
  "non-owned auto": "non_owned_auto",
  "workers comp": "workers_comp",
  "workers compensation": "workers_comp",
  "workers' compensation": "workers_comp",
  umbrella: "umbrella",
  "excess liability": "excess_liability",
  "professional liability": "professional_liability",
  "errors and omissions": "professional_liability",
  "e&o": "professional_liability",
  cyber: "cyber",
  "cyber liability": "cyber",
  "network security": "cyber",
  "privacy liability": "cyber",
  epli: "epli",
  "employment practices liability": "epli",
  "directors and officers": "directors_officers",
  "directors & officers": "directors_officers",
  "d&o": "directors_officers",
  "fiduciary liability insurance": "fiduciary_liability",
  "crime insurance": "crime_fidelity",
  "fidelity bond": "crime_fidelity",
  "inland marine insurance": "inland_marine",
  "motor truck cargo": "inland_marine",
  "motor truck cargo legal liability": "inland_marine",
  "builders risk insurance": "builders_risk",
  "pollution liability": "environmental",
  "premises pollution liability": "environmental",
  "environmental liability": "environmental",
  "ocean marine insurance": "ocean_marine",
  "surety bond": "surety",
  "product liability insurance": "product_liability",
  "life insurance": "life",
  "permanent life": "life",
  "term life": "life",
  "whole life": "life",
  "universal life": "life",
  "critical illness": "critical_illness",
  "critical illness insurance": "critical_illness",
  "disability insurance": "disability",
  "long term care": "long_term_care",
  "long-term care": "long_term_care",
};

const POLICY_TYPE_TEXT_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: "general_liability", pattern: /\b(?:commercial\s+)?general\s+liability\b|\bcgl\b/i },
  { type: "commercial_property", pattern: /\bcommercial\s+property\b|\bproperty\s+insurance\b/i },
  { type: "commercial_auto", pattern: /\bcommercial\s+auto(?:mobile)?\b|\bbusiness\s+auto(?:mobile)?\b|\bauto(?:mobile)?\s+physical\s+damage\b/i },
  { type: "non_owned_auto", pattern: /\b(?:hired\s+(?:and\s+)?)?non[-\s]?owned\s+auto\b/i },
  { type: "workers_comp", pattern: /\bworkers['’]?\s+comp(?:ensation)?\b/i },
  { type: "umbrella", pattern: /\bcommercial\s+umbrella\b|\bumbrella\s+liability\b/i },
  { type: "excess_liability", pattern: /\bexcess\s+liability\b/i },
  { type: "professional_liability", pattern: /\bprofessional\s+liability\b|\berrors?\s*(?:and|&)\s*omissions?\b|\be&o\b/i },
  { type: "cyber", pattern: /\bcyber\b|\bnetwork\s+security\b|\bprivacy\s+liability\b/i },
  { type: "epli", pattern: /\bemployment\s+practices?\s+liability\b|\bepli\b/i },
  { type: "directors_officers", pattern: /\bdirectors?\s*(?:and|&)\s*officers?\b|\bd&o\b/i },
  { type: "fiduciary_liability", pattern: /\bfiduciary\s+liability\b/i },
  { type: "crime_fidelity", pattern: /\bcrime\b|\bfidelity\b/i },
  { type: "inland_marine", pattern: /\binland\s+marine\b|\bmotor\s+truck\s+cargo\b|\bcargo\s+legal\s+liability\b/i },
  { type: "builders_risk", pattern: /\bbuilders?\s+risk\b/i },
  { type: "environmental", pattern: /\bpollution\s+liability\b|\benvironmental\s+liability\b/i },
  { type: "ocean_marine", pattern: /\bocean\s+marine\b/i },
  { type: "surety", pattern: /\bsurety\b/i },
  { type: "product_liability", pattern: /\bproduct\s+liability\b|\bproducts?\s+completed\s+operations\b/i },
  { type: "bop", pattern: /\bbusiness\s*owners?\s+policy\b|\bbop\b/i },
  { type: "homeowners_ho3", pattern: /\bhomeowners?\s*(?:ho[-\s]?3)?\b/i },
  { type: "homeowners_ho5", pattern: /\bho[-\s]?5\b/i },
  { type: "renters_ho4", pattern: /\brenters?\b|\bho[-\s]?4\b/i },
  { type: "condo_ho6", pattern: /\bcondo(?:minium)?\b|\bho[-\s]?6\b/i },
  { type: "dwelling_fire", pattern: /\bdwelling\s+fire\b/i },
  { type: "personal_auto", pattern: /\bpersonal\s+auto\b/i },
  { type: "personal_umbrella", pattern: /\bpersonal\s+umbrella\b/i },
  { type: "flood_private", pattern: /\bflood\b/i },
  { type: "earthquake", pattern: /\bearthquake\b/i },
  { type: "personal_inland_marine", pattern: /\bpersonal\s+(?:articles|inland\s+marine)\b/i },
  { type: "watercraft", pattern: /\bwatercraft\b|\bboat\s+insurance\b/i },
  { type: "recreational_vehicle", pattern: /\brecreational\s+vehicle\b|\brv\s+insurance\b/i },
  { type: "farm_ranch", pattern: /\bfarm\b|\branch\b/i },
  { type: "life", pattern: /\blife\s+insurance\b|\bterm\s+life\b|\bwhole\s+life\b|\buniversal\s+life\b/i },
  { type: "critical_illness", pattern: /\bcritical\s+illness\b/i },
  { type: "disability", pattern: /\bdisability\s+insurance\b|\btotal\s+disability\b/i },
  { type: "long_term_care", pattern: /\blong[-\s]?term\s+care\b/i },
  { type: "pet", pattern: /\bpet\s+insurance\b/i },
  { type: "travel", pattern: /\btravel\s+insurance\b/i },
  { type: "identity_theft", pattern: /\bidentity\s+theft\b/i },
  { type: "title", pattern: /\btitle\s+insurance\b/i },
];

export const POLICY_TYPES_FROM_COVERAGES_WARNING = "Policy types augmented from extracted coverage labels.";

export type PolicyTypeResolutionSource =
  | "profile"
  | "profile_augmented"
  | "existing"
  | "existing_augmented"
  | "inferred";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeOperationalPolicyTypes(values: unknown): string[] {
  const types = Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
  const controlled = types
    .map((type) => type.trim().toLowerCase().replace(/\s+/g, " "))
    .map((type) => POLICY_TYPE_ALIASES[type] ?? type.replace(/[\s-]+/g, "_"))
    .filter((type) => POLICY_TYPE_KEYS.has(type));
  const unique = [...new Set(controlled)].slice(0, 6);
  return unique.length ? unique : ["other"];
}

function hasSpecificPolicyType(types: string[]): boolean {
  return types.some((type) => type !== "other");
}

function policyTypesFromText(value: string | undefined): string[] {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return [];
  const aliasType = POLICY_TYPE_ALIASES[text.toLowerCase()];
  if (aliasType && POLICY_TYPE_KEYS.has(aliasType)) return [aliasType];
  return POLICY_TYPE_TEXT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ type }) => type)
    .filter((type) => POLICY_TYPE_KEYS.has(type));
}

export function inferPolicyTypesFromOperationalCoverages(coverages: OperationalCoverageLine[]): string[] {
  const inferred: string[] = [];
  for (const coverage of coverages) {
    const limits = coverage.limits ?? [];
    const text = [
      coverage.coverageCode,
      coverage.formNumber,
      coverage.name,
      ...limits.flatMap((term) => [term.appliesTo, term.label]),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    for (const value of text) {
      for (const type of policyTypesFromText(value)) {
        if (!inferred.includes(type)) inferred.push(type);
      }
    }
  }
  return inferred.slice(0, 6);
}

function mergePolicyTypes(base: string[], additions: string[]): string[] {
  const merged = [
    ...base.filter((type) => type !== "other"),
    ...additions.filter((type) => type !== "other"),
  ];
  const unique = [...new Set(merged)].slice(0, 6);
  return unique.length ? unique : base;
}

export function resolveOperationalProfilePolicyTypes(params: {
  profileTypes: unknown;
  existingTypes?: unknown;
  coverages?: OperationalCoverageLine[];
}): { policyTypes: string[]; source: PolicyTypeResolutionSource } {
  const inferred = inferPolicyTypesFromOperationalCoverages(params.coverages ?? []);
  const controlled = normalizeOperationalPolicyTypes(params.profileTypes);
  if (hasSpecificPolicyType(controlled)) {
    const policyTypes = mergePolicyTypes(controlled, inferred);
    return {
      policyTypes,
      source: policyTypes.length > controlled.filter((type) => type !== "other").length
        ? "profile_augmented"
        : "profile",
    };
  }
  const existingControlled = normalizeOperationalPolicyTypes(params.existingTypes);
  if (hasSpecificPolicyType(existingControlled)) {
    const policyTypes = mergePolicyTypes(existingControlled, inferred);
    return {
      policyTypes,
      source: policyTypes.length > existingControlled.filter((type) => type !== "other").length
        ? "existing_augmented"
        : "existing",
    };
  }
  if (inferred.length > 0) {
    return { policyTypes: inferred, source: "inferred" };
  }
  return { policyTypes: controlled, source: "profile" };
}
