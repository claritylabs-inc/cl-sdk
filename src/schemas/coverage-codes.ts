import { z } from "zod";
import {
  ACORD_COVERAGE_CODES,
  ACORD_COVERAGE_DESCRIPTIONS,
  ACORD_COVERAGE_ENTRIES,
  ACORD_COVERAGE_SOURCE_HEADERS,
  ACORD_COVERAGE_SOURCE_ROWS,
  ACORD_TAXONOMY_METADATA,
} from "./acord-taxonomy.generated";

export {
  ACORD_COVERAGE_CODES,
  ACORD_COVERAGE_DESCRIPTIONS,
  ACORD_COVERAGE_ENTRIES,
  ACORD_COVERAGE_SOURCE_HEADERS,
  ACORD_COVERAGE_SOURCE_ROWS,
  ACORD_TAXONOMY_METADATA,
};

declare const acordCoverageCodeBrand: unique symbol;
export type AcordCoverageCode = string & {
  readonly [acordCoverageCodeBrand]: "AcordCoverageCode";
};

const COVERAGE_CODE_SET = new Set<string>(ACORD_COVERAGE_CODES);
const COVERAGE_DESCRIPTIONS: Readonly<Record<string, readonly string[]>> =
  ACORD_COVERAGE_DESCRIPTIONS;

function normalizedDescription(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COVERAGE_CODES_BY_DESCRIPTION = new Map<string, AcordCoverageCode[]>();
for (const code of ACORD_COVERAGE_CODES) {
  const coverageCode = code as AcordCoverageCode;
  for (const description of ACORD_COVERAGE_DESCRIPTIONS[code]) {
    const key = normalizedDescription(description);
    const codes = COVERAGE_CODES_BY_DESCRIPTION.get(key) ?? [];
    if (!codes.includes(coverageCode)) {
      codes.push(coverageCode);
      COVERAGE_CODES_BY_DESCRIPTION.set(key, codes);
    }
  }
}

export function isAcordCoverageCode(value: unknown): value is AcordCoverageCode {
  return typeof value === "string" && COVERAGE_CODE_SET.has(value);
}

export function normalizeAcordCoverageCode(value: unknown): AcordCoverageCode | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return isAcordCoverageCode(code) ? code : undefined;
}

export const AcordCoverageCodeSchema = z.string().transform(
  (value, context) => {
    const code = normalizeAcordCoverageCode(value);
    if (!code) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unknown ACORD CoverageCd",
      });
      return z.NEVER;
    }
    return code as AcordCoverageCode;
  },
);

export function coverageDescriptions(value: unknown): readonly string[] {
  const code = normalizeAcordCoverageCode(value);
  return code ? COVERAGE_DESCRIPTIONS[code] ?? [] : [];
}

export function coverageLabel(value: unknown): string | undefined {
  return coverageDescriptions(value)[0];
}

export function coverageCodesForDescription(value: unknown): readonly AcordCoverageCode[] {
  if (typeof value !== "string") return [];
  return COVERAGE_CODES_BY_DESCRIPTION.get(normalizedDescription(value)) ?? [];
}

export function resolveAcordCoverageCode(
  code: unknown,
  sourceDescription?: unknown,
): AcordCoverageCode | undefined {
  const explicit = normalizeAcordCoverageCode(code);
  if (explicit) return explicit;
  const candidates = coverageCodesForDescription(sourceDescription);
  return candidates.length === 1 ? candidates[0] : undefined;
}
