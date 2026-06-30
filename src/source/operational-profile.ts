import type {
  OperationalCoverageLine,
  OperationalCoverageTerm,
  OperationalParty,
  PolicyOperationalProfile,
  SourceBackedValue,
} from "./schemas";
import { PolicyOperationalProfileSchema } from "./schemas";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return normalizeWhitespace(value.replace(/^[\s:;#-]+|[\s;,.]+$/g, ""));
}

const OPERATIONAL_COVERAGE_TERM_KINDS = new Set<OperationalCoverageTerm["kind"]>([
  "each_claim_limit",
  "each_occurrence_limit",
  "each_loss_limit",
  "aggregate_limit",
  "sublimit",
  "retention",
  "deductible",
  "retroactive_date",
  "premium",
  "other",
]);

function normalizeTermKind(value: unknown): OperationalCoverageTerm["kind"] {
  return typeof value === "string" && OPERATIONAL_COVERAGE_TERM_KINDS.has(value as OperationalCoverageTerm["kind"])
    ? value as OperationalCoverageTerm["kind"]
    : "other";
}

export function mergeOperationalProfile(
  base: PolicyOperationalProfile,
  candidate: Partial<PolicyOperationalProfile>,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): PolicyOperationalProfile {
  const keepIds = (ids: unknown, valid: Set<string>) =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && valid.has(id)) : [];
  const mergeValue = (fallback: SourceBackedValue | undefined, next: unknown): SourceBackedValue | undefined => {
    if (!next || typeof next !== "object" || Array.isArray(next)) return fallback;
    const record = next as Record<string, unknown>;
    const value = typeof record.value === "string" ? cleanValue(record.value) : undefined;
    if (!value) return fallback;
    const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
    const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
    if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0) return fallback;
    return {
      value,
      normalizedValue: typeof record.normalizedValue === "string" ? record.normalizedValue : fallback?.normalizedValue,
      confidence: record.confidence === "high" || record.confidence === "low" || record.confidence === "medium"
        ? record.confidence
        : "medium",
      sourceNodeIds,
      sourceSpanIds,
    };
  };

  const policyNumber = mergeValue(base.policyNumber, candidate.policyNumber);
  const namedInsured = mergeValue(base.namedInsured, candidate.namedInsured);
  const insurer = mergeValue(base.insurer, candidate.insurer);
  const broker = mergeValue(base.broker, candidate.broker);
  const effectiveDate = mergeValue(base.effectiveDate, candidate.effectiveDate);
  const expirationDate = mergeValue(base.expirationDate, candidate.expirationDate);
  const retroactiveDate = mergeValue(base.retroactiveDate, candidate.retroactiveDate);
  const premium = mergeValue(base.premium, candidate.premium);
  const sourceValues = [
    policyNumber,
    namedInsured,
    insurer,
    broker,
    effectiveDate,
    expirationDate,
    retroactiveDate,
    premium,
  ].filter((value): value is SourceBackedValue => Boolean(value));

  const coverages = base.coverages.length > 0
    ? base.coverages
    : Array.isArray(candidate.coverages)
    ? candidate.coverages
        .map((coverage) => {
          const record = coverage as Record<string, unknown>;
          const name = typeof record.name === "string" ? cleanValue(record.name) : undefined;
          const limits: OperationalCoverageTerm[] = Array.isArray(record.limits)
            ? record.limits
                .filter((term): term is Record<string, unknown> =>
                  Boolean(term) && typeof term === "object" && !Array.isArray(term),
                )
                .flatMap((term) => {
                  const label = typeof term.label === "string" ? cleanValue(term.label) : undefined;
                  const value = typeof term.value === "string" ? cleanValue(term.value) : undefined;
                  const sourceNodeIds = keepIds(term.sourceNodeIds, validNodeIds);
                  const sourceSpanIds = keepIds(term.sourceSpanIds, validSpanIds);
                  if (!label || !value || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return [];
                  return [{
                    kind: normalizeTermKind(term.kind),
                    label,
                    value,
                    amount: typeof term.amount === "number" && Number.isFinite(term.amount) ? term.amount : undefined,
                    appliesTo: typeof term.appliesTo === "string" ? term.appliesTo : undefined,
                    sourceNodeIds,
                    sourceSpanIds,
                  }];
                })
            : [];
          const sourceNodeIds = [...new Set([
            ...keepIds(record.sourceNodeIds, validNodeIds),
            ...limits.flatMap((term) => term.sourceNodeIds),
          ])];
          const sourceSpanIds = [...new Set([
            ...keepIds(record.sourceSpanIds, validSpanIds),
            ...limits.flatMap((term) => term.sourceSpanIds),
          ])];
          return {
            name,
            coverageCode: typeof record.coverageCode === "string" ? cleanValue(record.coverageCode) : undefined,
            limit: typeof record.limit === "string" ? cleanValue(record.limit) : undefined,
            deductible: typeof record.deductible === "string" ? cleanValue(record.deductible) : undefined,
            premium: typeof record.premium === "string" ? cleanValue(record.premium) : undefined,
            retroactiveDate: typeof record.retroactiveDate === "string" ? cleanValue(record.retroactiveDate) : undefined,
            formNumber: typeof record.formNumber === "string" ? cleanValue(record.formNumber) : undefined,
            sectionRef: typeof record.sectionRef === "string" ? cleanValue(record.sectionRef) : undefined,
            coverageOrigin: record.coverageOrigin === "core" || record.coverageOrigin === "endorsement"
              ? record.coverageOrigin
              : undefined,
            endorsementNumber: typeof record.endorsementNumber === "string" ? cleanValue(record.endorsementNumber) : undefined,
            limits,
            sourceNodeIds,
            sourceSpanIds,
          };
        })
        .filter((coverage) => coverage.name && (coverage.sourceNodeIds.length > 0 || coverage.sourceSpanIds.length > 0))
    : base.coverages;

  const sourceBackedParty = (
    role: OperationalParty["role"],
    value: SourceBackedValue | undefined,
  ): OperationalParty | undefined => value
    ? {
      role,
      name: value.normalizedValue ?? value.value,
      sourceNodeIds: value.sourceNodeIds,
      sourceSpanIds: value.sourceSpanIds,
    }
    : undefined;
  const candidateParties = Array.isArray(candidate.parties)
    ? candidate.parties.flatMap((party) => {
      if (!party || typeof party !== "object" || Array.isArray(party)) return [];
      const record = party as Record<string, unknown>;
      const role = typeof record.role === "string" ? cleanValue(record.role) : undefined;
      const name = typeof record.name === "string" ? cleanValue(record.name) : undefined;
      const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
      const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
      if (!role || !name || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return [];
      return [{ role, name, sourceNodeIds, sourceSpanIds }];
    })
    : [];
  const parties = [
    ...base.parties,
    ...candidateParties,
    sourceBackedParty("named_insured", namedInsured),
    sourceBackedParty("insurer", insurer),
    sourceBackedParty("broker", broker),
  ].filter((party): party is OperationalParty => Boolean(party))
    .filter((party, index, rows) =>
      rows.findIndex((other) =>
        other.role === party.role &&
        other.name === party.name &&
        other.sourceNodeIds.join(",") === party.sourceNodeIds.join(",") &&
        other.sourceSpanIds.join(",") === party.sourceSpanIds.join(",")
      ) === index
    );

  const endorsementSupport = [
    ...base.endorsementSupport,
    ...(Array.isArray(candidate.endorsementSupport)
      ? candidate.endorsementSupport.flatMap((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return [];
        const record = row as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? cleanValue(record.kind) : undefined;
        const summary = typeof record.summary === "string" ? cleanValue(record.summary) : undefined;
        const status = record.status === "supported" || record.status === "excluded" || record.status === "requires_review"
          ? record.status
          : undefined;
        const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
        const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
        if (!kind || !summary || !status || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return [];
        return [{ kind, status, summary, sourceNodeIds, sourceSpanIds }];
      })
      : []),
  ].filter((row, index, rows) =>
    rows.findIndex((other) =>
      other.kind === row.kind &&
      other.status === row.status &&
      other.summary === row.summary &&
      other.sourceNodeIds.join(",") === row.sourceNodeIds.join(",") &&
      other.sourceSpanIds.join(",") === row.sourceSpanIds.join(",")
    ) === index
  );

  const sourceNodeIds = [...new Set([
    ...base.sourceNodeIds,
    ...keepIds(candidate.sourceNodeIds, validNodeIds),
    ...sourceValues.flatMap((value) => value.sourceNodeIds),
    ...coverages.flatMap((coverage) => coverage.sourceNodeIds),
    ...coverages.flatMap((coverage) => coverage.limits.flatMap((term) => term.sourceNodeIds)),
    ...parties.flatMap((party) => party.sourceNodeIds),
    ...endorsementSupport.flatMap((row) => row.sourceNodeIds),
  ])];
  const sourceSpanIds = [...new Set([
    ...base.sourceSpanIds,
    ...keepIds(candidate.sourceSpanIds, validSpanIds),
    ...sourceValues.flatMap((value) => value.sourceSpanIds),
    ...coverages.flatMap((coverage) => coverage.sourceSpanIds),
    ...coverages.flatMap((coverage) => coverage.limits.flatMap((term) => term.sourceSpanIds)),
    ...parties.flatMap((party) => party.sourceSpanIds),
    ...endorsementSupport.flatMap((row) => row.sourceSpanIds),
  ])];
  const warnings = [
    ...base.warnings,
    ...(Array.isArray(candidate.warnings)
      ? candidate.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
      : []),
  ];

  return PolicyOperationalProfileSchema.parse({
    ...base,
    documentType: candidate.documentType === "quote" ? "quote" : candidate.documentType === "policy" ? "policy" : base.documentType,
    policyTypes: Array.isArray(candidate.policyTypes) && candidate.policyTypes.length > 0 ? candidate.policyTypes : base.policyTypes,
    policyNumber,
    namedInsured,
    insurer,
    broker,
    effectiveDate,
    expirationDate,
    retroactiveDate,
    premium,
    coverageTypes: Array.isArray(candidate.coverageTypes) && candidate.coverageTypes.length > 0
      ? candidate.coverageTypes
      : base.coverageTypes,
    coverages,
    parties,
    endorsementSupport,
    sourceNodeIds,
    sourceSpanIds,
    warnings: [...new Set(warnings)],
  });
}
