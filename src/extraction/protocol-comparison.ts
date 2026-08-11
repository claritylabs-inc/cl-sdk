import type { PolicyOperationalProfile } from "../source/schemas";

export type ExtractionProtocolFixture = {
  id: string;
  v1: Partial<PolicyOperationalProfile>;
  v2: Partial<PolicyOperationalProfile>;
};

export type ExtractionProtocolFixtureComparison = {
  id: string;
  criticalFactRegressions: string[];
  coverageRecallRegressions: string[];
  passed: boolean;
};

export type ExtractionProtocolCorpusComparison = {
  fixtureCount: number;
  passedFixtureCount: number;
  failedFixtureCount: number;
  criticalFactRegressionCount: number;
  coverageRecallRegressionCount: number;
  passed: boolean;
  fixtures: ExtractionProtocolFixtureComparison[];
};

const CRITICAL_FACTS = [
  "policyNumber",
  "namedInsured",
  "insurer",
  "effectiveDate",
  "expirationDate",
] as const;

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-z0-9]/gi, "").toLowerCase()
    : "";
}

function sourceBackedValue(value: unknown): { value: string; cited: boolean } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.value !== "string" || !record.value.trim()) return undefined;
  return {
    value: record.value,
    cited: [record.sourceSpanIds, record.sourceNodeIds].some((ids) =>
      Array.isArray(ids) && ids.some((id) => typeof id === "string" && id.length > 0)),
  };
}

type Coverage = NonNullable<PolicyOperationalProfile["coverages"]>[number];

function coverageMatches(baseline: Coverage, candidate: Coverage): boolean {
  if (candidate.sourceSpanIds.length === 0 && candidate.sourceNodeIds.length === 0) {
    return false;
  }
  const baselineSpans = new Set(baseline.sourceSpanIds);
  if (candidate.sourceSpanIds.some((id) => baselineSpans.has(id))) return true;
  const baselineNodes = new Set(baseline.sourceNodeIds);
  if (candidate.sourceNodeIds.some((id) => baselineNodes.has(id))) return true;
  const baselineCode = normalize(baseline.coverageCode);
  const candidateCode = normalize(candidate.coverageCode);
  if (baselineCode && baselineCode === candidateCode) return true;
  return Boolean(normalize(baseline.name) && normalize(baseline.name) === normalize(candidate.name));
}

export function compareExtractionProtocolFixture(
  fixture: ExtractionProtocolFixture,
): ExtractionProtocolFixtureComparison {
  const criticalFactRegressions: string[] = [];
  for (const field of CRITICAL_FACTS) {
    const baseline = sourceBackedValue(fixture.v1[field]);
    if (!baseline?.cited) continue;
    const candidate = sourceBackedValue(fixture.v2[field]);
    if (!candidate?.cited) {
      criticalFactRegressions.push(`${field}: missing cited value`);
    } else if (normalize(candidate.value) !== normalize(baseline.value)) {
      criticalFactRegressions.push(`${field}: value changed`);
    }
  }

  const candidateCoverages = fixture.v2.coverages ?? [];
  const coverageRecallRegressions = (fixture.v1.coverages ?? [])
    .filter((coverage) =>
      (coverage.sourceSpanIds.length > 0 || coverage.sourceNodeIds.length > 0) &&
      !candidateCoverages.some((candidate) => coverageMatches(coverage, candidate)))
    .map((coverage) =>
      `${coverage.coverageCode ?? coverage.name}: cited coverage missing`);

  return {
    id: fixture.id,
    criticalFactRegressions,
    coverageRecallRegressions,
    passed: criticalFactRegressions.length === 0 && coverageRecallRegressions.length === 0,
  };
}

export function compareExtractionProtocolCorpus(
  fixtures: readonly ExtractionProtocolFixture[],
): ExtractionProtocolCorpusComparison {
  const comparisons = fixtures.map(compareExtractionProtocolFixture);
  const passedFixtureCount = comparisons.filter((comparison) => comparison.passed).length;
  const criticalFactRegressionCount = comparisons.reduce(
    (total, comparison) => total + comparison.criticalFactRegressions.length,
    0,
  );
  const coverageRecallRegressionCount = comparisons.reduce(
    (total, comparison) => total + comparison.coverageRecallRegressions.length,
    0,
  );
  return {
    fixtureCount: comparisons.length,
    passedFixtureCount,
    failedFixtureCount: comparisons.length - passedFixtureCount,
    criticalFactRegressionCount,
    coverageRecallRegressionCount,
    passed: comparisons.length > 0 && passedFixtureCount === comparisons.length,
    fixtures: comparisons,
  };
}
