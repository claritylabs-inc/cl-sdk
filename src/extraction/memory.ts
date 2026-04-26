export type ExtractionMemory = Map<string, unknown>;
export type MemoryRecord = Record<string, unknown>;

export function isMemoryRecord(value: unknown): value is MemoryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readMemoryRecord(memory: ExtractionMemory, key: string): MemoryRecord | undefined {
  const value = memory.get(key);
  return isMemoryRecord(value) ? value : undefined;
}

export function readRecordValue<T = unknown>(record: MemoryRecord | undefined, key: string): T | undefined {
  return record?.[key] as T | undefined;
}

export function readRecordArray<T = unknown>(record: MemoryRecord | undefined, key: string): T[] | undefined {
  const value = readRecordValue(record, key);
  return Array.isArray(value) ? (value as T[]) : undefined;
}

export function getCarrierInfo(memory: ExtractionMemory): MemoryRecord | undefined {
  return readMemoryRecord(memory, "carrier_info");
}

export function getNamedInsured(memory: ExtractionMemory): MemoryRecord | undefined {
  return readMemoryRecord(memory, "named_insured");
}

export function getCoverageLimits(memory: ExtractionMemory): MemoryRecord | undefined {
  return readMemoryRecord(memory, "coverage_limits");
}

export function getCoverageLimitCoverages<T = unknown>(memory: ExtractionMemory): T[] {
  return readRecordArray<T>(getCoverageLimits(memory), "coverages") ?? [];
}

export function getSectionsPayload(memory: ExtractionMemory): MemoryRecord | undefined {
  return readMemoryRecord(memory, "sections");
}

export function getSections<T = unknown>(memory: ExtractionMemory): T[] | undefined {
  return readRecordArray<T>(getSectionsPayload(memory), "sections");
}

export function getDefinitionsPayload(memory: ExtractionMemory): MemoryRecord | undefined {
  return readMemoryRecord(memory, "definitions");
}

export function getDefinitions<T = unknown>(memory: ExtractionMemory): T[] | undefined {
  return readRecordArray<T>(getDefinitionsPayload(memory), "definitions");
}

export function getCoveredReasonsPayload(memory: ExtractionMemory): MemoryRecord | undefined {
  return readMemoryRecord(memory, "covered_reasons");
}

export function getCoveredReasons<T = unknown>(memory: ExtractionMemory): T[] | undefined {
  const payload = getCoveredReasonsPayload(memory);
  return readRecordArray<T>(payload, "coveredReasons") ?? readRecordArray<T>(payload, "covered_reasons");
}
