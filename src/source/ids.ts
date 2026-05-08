import type { SourceSpanLocation } from "./schemas";

export interface SourceSpanIdInput {
  documentId: string;
  chunkId?: string;
  text?: string;
  location?: SourceSpanLocation;
  fieldPath?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x45d9f3b;
  for (let index = 0; index < input.length; index++) {
    const char = input.charCodeAt(index);
    hashA ^= char;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= char + index;
    hashB = Math.imul(hashB, 0x27d4eb2d);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

export function sourceSpanTextHash(text: string): string {
  return stableHash(normalizeText(text));
}

export function buildSourceSpanId(input: SourceSpanIdInput): string {
  const hash = stableHash({
    documentId: input.documentId,
    chunkId: input.chunkId,
    fieldPath: input.fieldPath,
    location: input.location,
    text: input.text ? normalizeText(input.text) : undefined,
  }).slice(0, 16);

  return [input.documentId, input.chunkId, input.fieldPath, hash]
    .filter((part): part is string => !!part)
    .map((part) => part.replace(/[^a-zA-Z0-9_.:-]/g, "_"))
    .join(":");
}
