function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function mergeUniqueObjects(
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
  keyFn: (item: Record<string, unknown>) => string,
): Record<string, unknown>[] {
  return dedupeByKey([...existing, ...incoming], keyFn);
}

function mergeShallowPreferPresent(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    const current = merged[key];

    if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = [...current, ...value];
      continue;
    }

    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      merged[key] = mergeShallowPreferPresent(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      continue;
    }

    if (!isPresent(current) && isPresent(value)) {
      merged[key] = value;
    }
  }

  return merged;
}

function mergeCoverageLimits(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = mergeShallowPreferPresent(existing, incoming);
  const existingCoverages = Array.isArray(existing.coverages) ? existing.coverages as Record<string, unknown>[] : [];
  const incomingCoverages = Array.isArray(incoming.coverages) ? incoming.coverages as Record<string, unknown>[] : [];
  const coverageKey = (coverage: Record<string, unknown>) => [
    String(coverage.name ?? "").toLowerCase(),
    String(coverage.limitType ?? "").toLowerCase(),
    String(coverage.limit ?? "").toLowerCase(),
    String(coverage.deductible ?? "").toLowerCase(),
    String(coverage.formNumber ?? "").toLowerCase(),
  ].join("|");

  const byKey = new Map<string, Record<string, unknown>>();
  for (const coverage of [...existingCoverages, ...incomingCoverages]) {
    const key = coverageKey(coverage);
    const current = byKey.get(key);
    byKey.set(key, current ? mergeShallowPreferPresent(current, coverage) : coverage);
  }

  merged.coverages = [...byKey.values()];

  return merged;
}

function mergeDeclarations(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = mergeShallowPreferPresent(existing, incoming);
  const existingFields = Array.isArray(existing.fields) ? existing.fields as Record<string, unknown>[] : [];
  const incomingFields = Array.isArray(incoming.fields) ? incoming.fields as Record<string, unknown>[] : [];

  merged.fields = mergeUniqueObjects(existingFields, incomingFields, (field) => [
    String(field.field ?? "").toLowerCase(),
    String(field.value ?? "").toLowerCase(),
    String(field.section ?? "").toLowerCase(),
  ].join("|"));

  return merged;
}

function mergeArrayPayload(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  arrayKey: string,
  keyFn: (item: Record<string, unknown>) => string,
): Record<string, unknown> {
  const merged = mergeShallowPreferPresent(existing, incoming);
  const existingItems = Array.isArray(existing[arrayKey]) ? existing[arrayKey] as Record<string, unknown>[] : [];
  const incomingItems = Array.isArray(incoming[arrayKey]) ? incoming[arrayKey] as Record<string, unknown>[] : [];
  merged[arrayKey] = mergeUniqueObjects(existingItems, incomingItems, keyFn);
  return merged;
}

function mergeSupplementary(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = mergeShallowPreferPresent(existing, incoming);
  const mergeContactArray = (arrayKey: string) => {
    const existingItems = Array.isArray(existing[arrayKey]) ? existing[arrayKey] as Record<string, unknown>[] : [];
    const incomingItems = Array.isArray(incoming[arrayKey]) ? incoming[arrayKey] as Record<string, unknown>[] : [];
    merged[arrayKey] = mergeUniqueObjects(existingItems, incomingItems, (item) => [
      String(item.name ?? "").toLowerCase(),
      String(item.phone ?? "").toLowerCase(),
      String(item.email ?? "").toLowerCase(),
      String(item.address ?? "").toLowerCase(),
      String(item.type ?? "").toLowerCase(),
    ].join("|"));
  };

  mergeContactArray("regulatoryContacts");
  mergeContactArray("claimsContacts");
  mergeContactArray("thirdPartyAdministrators");

  const existingFacts = Array.isArray(existing.auxiliaryFacts) ? existing.auxiliaryFacts as Record<string, unknown>[] : [];
  const incomingFacts = Array.isArray(incoming.auxiliaryFacts) ? incoming.auxiliaryFacts as Record<string, unknown>[] : [];
  merged.auxiliaryFacts = mergeUniqueObjects(existingFacts, incomingFacts, (item) => [
    String(item.key ?? "").toLowerCase(),
    String(item.value ?? "").toLowerCase(),
    String(item.subject ?? "").toLowerCase(),
    String(item.context ?? "").toLowerCase(),
  ].join("|"));

  return merged;
}

export function mergeExtractorResult(
  extractorName: string,
  existing: unknown,
  incoming: unknown,
): unknown {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (typeof existing !== "object" || typeof incoming !== "object") return incoming;

  const current = existing as Record<string, unknown>;
  const next = incoming as Record<string, unknown>;

  switch (extractorName) {
    case "carrier_info":
    case "named_insured":
    case "loss_history":
    case "premium_breakdown":
      return mergeShallowPreferPresent(current, next);
    case "supplementary":
      return mergeSupplementary(current, next);
    case "coverage_limits":
      return mergeCoverageLimits(current, next);
    case "declarations":
      return mergeDeclarations(current, next);
    case "endorsements":
      return mergeArrayPayload(current, next, "endorsements", (item) => [
        String(item.formNumber ?? "").toLowerCase(),
        String(item.title ?? "").toLowerCase(),
        String(item.pageStart ?? ""),
      ].join("|"));
    case "exclusions":
      return mergeArrayPayload(current, next, "exclusions", (item) => [
        String(item.name ?? "").toLowerCase(),
        String(item.formNumber ?? "").toLowerCase(),
        String(item.pageNumber ?? ""),
      ].join("|"));
    case "conditions":
      return mergeArrayPayload(current, next, "conditions", (item) => [
        String(item.name ?? "").toLowerCase(),
        String(item.conditionType ?? "").toLowerCase(),
        String(item.pageNumber ?? ""),
      ].join("|"));
    case "sections":
      return mergeArrayPayload(current, next, "sections", (item) => [
        String(item.title ?? "").toLowerCase(),
        String(item.type ?? "").toLowerCase(),
        String(item.pageStart ?? ""),
        String(item.pageEnd ?? ""),
      ].join("|"));
    default:
      return mergeShallowPreferPresent(current, next);
  }
}
