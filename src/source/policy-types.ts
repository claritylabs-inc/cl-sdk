import {
  type AcordLobCode,
  isLobCode,
  normalizeOperationalLinesOfBusiness,
  toLobCodes,
} from "../schemas/lines-of-business";
import type { OperationalCoverageLine } from "./schemas";

const LOB_TEXT_PATTERNS: Array<{ codes: AcordLobCode[]; pattern: RegExp }> = [
  { codes: ["CGL"], pattern: /\b(?:commercial\s+)?general\s+liability\b|\bcgl\b/i },
  { codes: ["PROPC"], pattern: /\bcommercial\s+property\b|\bproperty\s+insurance\b/i },
  { codes: ["PROP"], pattern: /\bproperty\b/i },
  { codes: ["AUTOB"], pattern: /\bcommercial\s+auto(?:mobile)?\b|\bbusiness\s+auto(?:mobile)?\b|\bauto(?:mobile)?\s+physical\s+damage\b/i },
  { codes: ["AUTOB"], pattern: /\b(?:hired\s+(?:and\s+)?)?non[-\s]?owned\s+auto\b/i },
  { codes: ["WORK"], pattern: /\bworkers['’]?\s+comp(?:ensation)?\b/i },
  { codes: ["UMBRC"], pattern: /\bcommercial\s+umbrella\b|\bumbrella\s+liability\b/i },
  { codes: ["EXLIA"], pattern: /\bexcess\s+liability\b/i },
  { codes: ["EO"], pattern: /\bprofessional\s+liability\b|\berrors?\s*(?:and|&)\s*omissions?\b|\be&o\b/i },
  { codes: ["OLIB"], pattern: /\bcyber\b|\bnetwork\s+security\b|\bprivacy\s+liability\b/i },
  { codes: ["EPLI"], pattern: /\bemployment\s+practices?\s+liability\b|\bepli\b/i },
  { codes: ["DO"], pattern: /\bdirectors?\s*(?:and|&)\s*officers?\b|\bd&o\b/i },
  { codes: ["FIDUC"], pattern: /\bfiduciary\s+liability\b/i },
  { codes: ["CRIME"], pattern: /\bcrime\b|\bfidelity\b/i },
  { codes: ["INMRC"], pattern: /\binland\s+marine\b|\bmotor\s+truck\s+cargo\b|\bcargo\s+legal\s+liability\b/i },
  { codes: ["INMRC"], pattern: /\bbuilders?\s+risk\b/i },
  { codes: ["OLIB"], pattern: /\bpollution\s+liability\b|\benvironmental\s+liability\b/i },
  { codes: ["COMAR"], pattern: /\bocean\s+marine\b/i },
  { codes: ["SURE"], pattern: /\bsurety\b/i },
  { codes: ["OLIB"], pattern: /\bproduct\s+liability\b|\bproducts?\s+completed\s+operations\b/i },
  { codes: ["BOP"], pattern: /\bbusiness\s*owners?\s+policy\b|\bbop\b/i },
  { codes: ["DO", "EPLI", "FIDUC"], pattern: /\bmanagement\s+liability\b/i },
  { codes: ["HOME"], pattern: /\bhomeowners?\s*(?:ho[-\s]?[35])?\b|\bho[-\s]?[35]\b/i },
  { codes: ["HOME"], pattern: /\brenters?\b|\bho[-\s]?4\b/i },
  { codes: ["HOME"], pattern: /\bcondo(?:minium)?\b|\bho[-\s]?6\b/i },
  { codes: ["DFIRE"], pattern: /\bdwelling\s+fire\b/i },
  { codes: ["MHOME"], pattern: /\bmobile\s+home\b|\bmanufactured\s+home\b/i },
  { codes: ["AUTOP"], pattern: /\bpersonal\s+auto\b/i },
  { codes: ["UMBRP"], pattern: /\bpersonal\s+umbrella\b/i },
  { codes: ["FLOOD"], pattern: /\bflood\b/i },
  { codes: ["EQ"], pattern: /\bearthquake\b/i },
  { codes: ["INMRP"], pattern: /\bpersonal\s+(?:articles|inland\s+marine)\b/i },
  { codes: ["BOAT"], pattern: /\bwatercraft\b|\bboat\s+insurance\b/i },
  { codes: ["RECV"], pattern: /\brecreational\s+vehicle\b|\brv\s+insurance\b/i },
  { codes: ["CFRM"], pattern: /\bfarm\b|\branch\b/i },
  { codes: ["UN"], pattern: /\blife\s+insurance\b|\bterm\s+life\b|\bwhole\s+life\b|\buniversal\s+life\b/i },
  { codes: ["DISAB"], pattern: /\bcritical\s+illness\b|\bdisability\s+insurance\b|\btotal\s+disability\b/i },
  { codes: ["UN"], pattern: /\blong[-\s]?term\s+care\b|\bpet\s+insurance\b|\btravel\s+insurance\b|\bidentity\s+theft\b|\btitle\s+insurance\b/i },
];

export type LineOfBusinessResolutionSource =
  | "coverage"
  | "profile_hint"
  | "existing_hint"
  | "default";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasSpecificLineOfBusiness(codes: string[]): boolean {
  return codes.some((code) => code !== "UN");
}

function linesOfBusinessFromText(value: string | undefined): AcordLobCode[] {
  const text = normalizeWhitespace(value ?? "");
  if (!text) return [];
  const direct = toLobCodes([text]);
  if (direct.some((code) => code !== "UN") || isLobCode(text) || text.toUpperCase() === "UN") return direct;
  const inferred = LOB_TEXT_PATTERNS.flatMap(({ codes, pattern }) => (pattern.test(text) ? codes : []));
  return Array.from(new Set(inferred));
}

export function inferLinesOfBusinessFromOperationalCoverages(coverages: OperationalCoverageLine[]): AcordLobCode[] {
  const inferred: AcordLobCode[] = [];
  for (const coverage of coverages) {
    const limits = coverage.limits ?? [];
    const text = [
      coverage.coverageCode,
      coverage.formNumber,
      coverage.name,
      ...limits.flatMap((term) => [term.appliesTo, term.label]),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    for (const value of text) {
      for (const code of linesOfBusinessFromText(value)) {
        if (!inferred.includes(code)) inferred.push(code);
      }
    }
  }
  return inferred.slice(0, 6);
}

export function resolveOperationalProfileLinesOfBusiness(params: {
  profileLinesOfBusiness: unknown;
  existingLinesOfBusiness?: unknown;
  coverages?: OperationalCoverageLine[];
}): { linesOfBusiness: AcordLobCode[]; source: LineOfBusinessResolutionSource } {
  const inferred = inferLinesOfBusinessFromOperationalCoverages(params.coverages ?? []);
  if (inferred.some((code) => code !== "UN")) {
    return { linesOfBusiness: inferred, source: "coverage" };
  }

  const controlled = normalizeOperationalLinesOfBusiness(params.profileLinesOfBusiness);
  if (hasSpecificLineOfBusiness(controlled)) return { linesOfBusiness: controlled, source: "profile_hint" };

  const existingControlled = normalizeOperationalLinesOfBusiness(params.existingLinesOfBusiness);
  if (hasSpecificLineOfBusiness(existingControlled)) return { linesOfBusiness: existingControlled, source: "existing_hint" };

  return { linesOfBusiness: controlled, source: "default" };
}
