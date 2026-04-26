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

function normalizeKeyPart(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function keyFromParts(...parts: unknown[]): string {
  return parts.map(normalizeKeyPart).join("|");
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
  const coverageKey = (coverage: Record<string, unknown>) => keyFromParts(
    coverage.name,
    coverage.limitType,
    coverage.limit,
    coverage.deductible,
    coverage.formNumber,
  );

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

  merged.fields = mergeUniqueObjects(existingFields, incomingFields, (field) => keyFromParts(
    field.field,
    field.value,
    field.section,
  ));

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

function readArray(record: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
  }
  return [];
}

function mergeAliasedArrayPayload(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  outputKey: string,
  inputKeys: string[],
  keyFn: (item: Record<string, unknown>) => string,
): Record<string, unknown> {
  const merged = mergeShallowPreferPresent(existing, incoming);
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of [
    ...readArray(existing, outputKey, ...inputKeys),
    ...readArray(incoming, outputKey, ...inputKeys),
  ]) {
    const key = keyFn(item);
    const current = byKey.get(key);
    byKey.set(key, current ? mergeShallowPreferPresent(current, item) : item);
  }
  merged[outputKey] = [...byKey.values()];
  for (const key of inputKeys) {
    if (key !== outputKey) delete merged[key];
  }
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
    merged[arrayKey] = mergeUniqueObjects(existingItems, incomingItems, (item) => keyFromParts(
      item.name,
      item.phone,
      item.email,
      item.address,
      item.type,
    ));
  };

  mergeContactArray("regulatoryContacts");
  mergeContactArray("claimsContacts");
  mergeContactArray("thirdPartyAdministrators");

  const existingFacts = Array.isArray(existing.auxiliaryFacts) ? existing.auxiliaryFacts as Record<string, unknown>[] : [];
  const incomingFacts = Array.isArray(incoming.auxiliaryFacts) ? incoming.auxiliaryFacts as Record<string, unknown>[] : [];
  merged.auxiliaryFacts = mergeUniqueObjects(existingFacts, incomingFacts, (item) => keyFromParts(
    item.key,
    item.value,
    item.subject,
    item.context,
  ));

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
    case "definitions":
      return mergeArrayPayload(current, next, "definitions", (item) => keyFromParts(
        item.term ?? item.name ?? item.key,
        item.pageNumber ?? item.pageStart,
      ));
    case "covered_reasons":
      return mergeAliasedArrayPayload(current, next, "coveredReasons", ["covered_reasons"], (item) => keyFromParts(
        item.coverageName ?? item.coverage,
        item.reasonNumber ?? item.number,
        item.title ?? item.reason ?? item.name ?? item.cause,
        item.pageNumber ?? item.pageStart,
      ));
    case "endorsements":
      return mergeArrayPayload(current, next, "endorsements", (item) => keyFromParts(
        item.formNumber,
        item.title,
        item.pageStart,
      ));
    case "exclusions":
      return mergeArrayPayload(current, next, "exclusions", (item) => keyFromParts(
        item.name,
        item.formNumber,
        item.pageNumber,
      ));
    case "conditions":
      return mergeArrayPayload(current, next, "conditions", (item) => keyFromParts(
        item.name,
        item.conditionType,
        item.pageNumber,
      ));
    case "sections":
      return mergeArrayPayload(current, next, "sections", (item) => keyFromParts(
        item.title,
        item.type,
        item.pageStart,
        item.pageEnd,
      ));
    default:
      return mergeShallowPreferPresent(current, next);
  }
}
