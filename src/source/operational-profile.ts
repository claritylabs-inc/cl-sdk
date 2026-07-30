import type {
  OperationalCoverageLine,
  OperationalCoverageTerm,
  OperationalAddress,
  OperationalDeclarationFact,
  OperationalParty,
  PolicyOperationalProfile,
  SourceBackedValue,
} from "./schemas";
import { PolicyOperationalProfileSchema } from "./schemas";
import {
  type AcordLobCode,
  normalizeOperationalLinesOfBusiness,
} from "../schemas/lines-of-business";
import { resolveAcordCoverageCode } from "../schemas/coverage-codes";
import {
  annotateOperationalCoverageLinesOfBusiness,
  resolveOperationalProfileLinesOfBusiness,
} from "./policy-types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return normalizeWhitespace(value.replace(/^[\s:;#-]+|[\s;,.]+$/g, ""));
}

function cleanCoverageLineOfBusiness(value: unknown): AcordLobCode | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const [code] = normalizeOperationalLinesOfBusiness([value]);
  return code && code !== "UN" ? code : undefined;
}

function normalizedFactValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OPERATIONAL_ADDRESS_FIELDS = [
  "street1",
  "street2",
  "city",
  "state",
  "zip",
  "country",
  "formatted",
] as const satisfies readonly (keyof OperationalAddress)[];

function normalizeOperationalAddress(value: unknown): OperationalAddress | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const address = Object.fromEntries(
    OPERATIONAL_ADDRESS_FIELDS.flatMap((field) => {
      const cleaned = typeof record[field] === "string" ? cleanValue(record[field]) : undefined;
      return cleaned ? [[field, cleaned]] : [];
    }),
  ) as OperationalAddress;
  return Object.keys(address).length > 0 ? address : undefined;
}

function normalizeOperationalPartyRole(value: string): string {
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "namedinsured" || normalized === "insured") return "named_insured";
  if (normalized === "managing_general_agent") return "mga";
  if (normalized === "managing_general_underwriter") return "mga";
  if (normalized === "third_party_administrator") return "administrator";
  return normalized;
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
  base: PolicyOperationalProfile & { policyTypes?: unknown },
  candidate: Partial<PolicyOperationalProfile> & { policyTypes?: unknown },
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
  const mergeDeclarationFact = (fact: unknown): OperationalDeclarationFact | undefined => {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) return undefined;
    const record = fact as Record<string, unknown>;
    const field = typeof record.field === "string" ? cleanValue(record.field) : undefined;
    const value = typeof record.value === "string" ? cleanValue(record.value) : undefined;
    const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
    const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
    if (!field || !value || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return undefined;
    const address = record.address && typeof record.address === "object" && !Array.isArray(record.address)
      ? Object.fromEntries(
          Object.entries(record.address as Record<string, unknown>)
            .flatMap(([key, item]) => {
              const text = typeof item === "string" ? cleanValue(item) : undefined;
              return text ? [[key, text]] : [];
            }),
        )
      : undefined;
    return {
      field: [
        "namedInsured",
        "mailingAddress",
        "dba",
        "entityType",
        "taxId",
        "additionalNamedInsured",
        "policyNumber",
        "insurer",
        "broker",
        "effectiveDate",
        "expirationDate",
        "premium",
        "other",
      ].includes(field) ? field as OperationalDeclarationFact["field"] : "other",
      label: typeof record.label === "string" ? cleanValue(record.label) : undefined,
      value,
      normalizedValue: typeof record.normalizedValue === "string"
        ? cleanValue(record.normalizedValue)
        : normalizedFactValue(value),
      valueKind: [
        "string",
        "number",
        "date",
        "money",
        "address",
        "list",
        "unknown",
      ].includes(String(record.valueKind)) ? record.valueKind as OperationalDeclarationFact["valueKind"] : "string",
      address,
      confidence: record.confidence === "high" || record.confidence === "low" || record.confidence === "medium"
        ? record.confidence
        : "medium",
      sourceNodeIds,
      sourceSpanIds,
    };
  };

  const sourceBackedDeclarationFact = (
    field: OperationalDeclarationFact["field"],
    value: SourceBackedValue | undefined,
    valueKind: OperationalDeclarationFact["valueKind"] = "string",
  ): OperationalDeclarationFact | undefined => value
    ? {
        field,
        value: value.value,
        normalizedValue: value.normalizedValue ?? normalizedFactValue(value.value),
        valueKind,
        confidence: value.confidence,
        sourceNodeIds: value.sourceNodeIds,
        sourceSpanIds: value.sourceSpanIds,
      }
    : undefined;

  const policyNumber = mergeValue(base.policyNumber, candidate.policyNumber);
  const namedInsured = mergeValue(base.namedInsured, candidate.namedInsured);
  const insurer = mergeValue(base.insurer, candidate.insurer);
  const broker = mergeValue(base.broker, candidate.broker);
  const effectiveDate = mergeValue(base.effectiveDate, candidate.effectiveDate);
  const expirationDate = mergeValue(base.expirationDate, candidate.expirationDate);
  const retroactiveDate = mergeValue(base.retroactiveDate, candidate.retroactiveDate);
  const premium = mergeValue(base.premium, candidate.premium);
  const operationsDescription = mergeValue(base.operationsDescription, candidate.operationsDescription);
  const productName = mergeValue(base.productIdentity?.name, candidate.productIdentity?.name);
  const companyProductCode = mergeValue(
    base.productIdentity?.companyProductCode,
    candidate.productIdentity?.companyProductCode,
  );
  const companyProductSubCode = mergeValue(
    base.productIdentity?.companyProductSubCode,
    candidate.productIdentity?.companyProductSubCode,
  );
  const productIdentity = productName || companyProductCode || companyProductSubCode
    ? {
        name: productName,
        companyProductCode,
        companyProductSubCode,
      }
    : undefined;
  const candidateDeclarationFacts = Array.isArray(candidate.declarationFacts)
    ? candidate.declarationFacts.map(mergeDeclarationFact).filter((fact): fact is OperationalDeclarationFact => Boolean(fact))
    : [];
  const declarationFacts = [
    ...base.declarationFacts,
    sourceBackedDeclarationFact("policyNumber", policyNumber),
    sourceBackedDeclarationFact("namedInsured", namedInsured),
    sourceBackedDeclarationFact("insurer", insurer),
    sourceBackedDeclarationFact("broker", broker),
    sourceBackedDeclarationFact("effectiveDate", effectiveDate, "date"),
    sourceBackedDeclarationFact("expirationDate", expirationDate, "date"),
    sourceBackedDeclarationFact("premium", premium, "money"),
    ...candidateDeclarationFacts,
  ].filter((fact): fact is OperationalDeclarationFact => Boolean(fact))
    .filter((fact, index, rows) =>
      rows.findIndex((other) =>
        other.field === fact.field &&
        other.normalizedValue === fact.normalizedValue &&
        other.sourceNodeIds.join(",") === fact.sourceNodeIds.join(",") &&
        other.sourceSpanIds.join(",") === fact.sourceSpanIds.join(",")
      ) === index
    );
  const sourceValues = [
    policyNumber,
    namedInsured,
    insurer,
    broker,
    effectiveDate,
    expirationDate,
    retroactiveDate,
    premium,
    operationsDescription,
    ...(productIdentity
      ? [
          productIdentity.name,
          productIdentity.companyProductCode,
          productIdentity.companyProductSubCode,
        ]
      : []),
  ].filter((value): value is SourceBackedValue => Boolean(value));

  const coverages: OperationalCoverageLine[] = base.coverages.length > 0
    ? base.coverages
    : Array.isArray(candidate.coverages)
    ? candidate.coverages
        .map((coverage): OperationalCoverageLine | undefined => {
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
          if (!name || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return undefined;
          return {
            name,
            lineOfBusiness: cleanCoverageLineOfBusiness(record.lineOfBusiness),
            coverageCode: resolveAcordCoverageCode(record.coverageCode, name),
            limit: typeof record.limit === "string" ? cleanValue(record.limit) : undefined,
            deductible: typeof record.deductible === "string" ? cleanValue(record.deductible) : undefined,
            premium: typeof record.premium === "string" ? cleanValue(record.premium) : undefined,
            retroactiveDate: typeof record.retroactiveDate === "string" ? cleanValue(record.retroactiveDate) : undefined,
            formNumber: typeof record.formNumber === "string" ? cleanValue(record.formNumber) : undefined,
            sectionRef: typeof record.sectionRef === "string" ? cleanValue(record.sectionRef) : undefined,
            endorsementNumber: typeof record.endorsementNumber === "string" ? cleanValue(record.endorsementNumber) : undefined,
            limits,
            sourceNodeIds,
            sourceSpanIds,
          };
        })
        .filter((coverage): coverage is OperationalCoverageLine => Boolean(coverage))
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
      const address = normalizeOperationalAddress(record.address);
      const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
      const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
      if (!role || !name || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return [];
      return [{
        role: normalizeOperationalPartyRole(role),
        name,
        address,
        sourceNodeIds,
        sourceSpanIds,
      }];
    })
    : [];
  const parties = [
    ...candidateParties,
    ...base.parties,
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
    ...declarationFacts.flatMap((fact) => fact.sourceNodeIds),
    ...coverages.flatMap((coverage) => coverage.sourceNodeIds),
    ...coverages.flatMap((coverage) => coverage.limits.flatMap((term) => term.sourceNodeIds)),
    ...parties.flatMap((party) => party.sourceNodeIds),
    ...endorsementSupport.flatMap((row) => row.sourceNodeIds),
  ])];
  const sourceSpanIds = [...new Set([
    ...base.sourceSpanIds,
    ...keepIds(candidate.sourceSpanIds, validSpanIds),
    ...sourceValues.flatMap((value) => value.sourceSpanIds),
    ...declarationFacts.flatMap((fact) => fact.sourceSpanIds),
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
  const candidateLinesOfBusiness = candidate.linesOfBusiness ?? candidate.policyTypes;
  const baseLinesOfBusiness = base.linesOfBusiness ?? base.policyTypes;
  const resolvedLinesOfBusiness = resolveOperationalProfileLinesOfBusiness({
    profileLinesOfBusiness: candidateLinesOfBusiness,
    existingLinesOfBusiness: baseLinesOfBusiness,
    coverages,
  });
  const annotatedCoverages = annotateOperationalCoverageLinesOfBusiness(
    coverages,
    resolvedLinesOfBusiness.linesOfBusiness,
  );

  return PolicyOperationalProfileSchema.parse({
    ...base,
    documentType: candidate.documentType === "policy" ? "policy" : base.documentType,
    linesOfBusiness: resolvedLinesOfBusiness.linesOfBusiness,
    policyNumber,
    namedInsured,
    insurer,
    broker,
    effectiveDate,
    expirationDate,
    retroactiveDate,
    premium,
    operationsDescription,
    productIdentity,
    declarationFacts,
    coverages: annotatedCoverages,
    parties,
    endorsementSupport,
    sourceNodeIds,
    sourceSpanIds,
    warnings: [...new Set(warnings)],
  });
}
