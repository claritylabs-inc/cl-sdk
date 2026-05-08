function normalizeKeyPart(value: unknown): string {
  if (value === undefined || value === null) return "na";
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "na";
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

function evidencePart(record: Record<string, unknown>): string {
  const spans = Array.isArray(record.sourceSpanIds) ? record.sourceSpanIds.join(",") : "";
  return [
    spans,
    record.sourceTextHash,
    record.formNumber,
    record.pageNumber ?? record.pageStart,
    record.sectionRef,
    record.originalContent ?? record.content,
  ]
    .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
    .map(normalizeKeyPart)
    .join("|");
}

export function buildExtractionRecordId(
  documentId: string,
  recordKind: string,
  record: Record<string, unknown>,
  labelParts: unknown[],
): string {
  const label = labelParts.map(normalizeKeyPart).join(":");
  const evidence = evidencePart(record);
  const hash = hashText(`${documentId}|${recordKind}|${label}|${evidence}`);
  return `${recordKind}:${normalizeKeyPart(documentId)}:${label}:${hash}`;
}

export function alignExtractionRecords<T extends Record<string, unknown>>(
  documentId: string,
  recordKind: string,
  records: T[] | undefined,
  labelParts: (record: T) => unknown[],
): Array<T & { recordId: string }> {
  if (!records?.length) return [];

  return records
    .map((record) => {
      const recordId = typeof record.recordId === "string" && record.recordId.trim().length > 0
        ? record.recordId
        : buildExtractionRecordId(documentId, recordKind, record, labelParts(record));
      return { ...record, recordId };
    })
    .sort((left, right) => String(left.recordId).localeCompare(String(right.recordId)));
}
