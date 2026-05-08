import type { ApplicationField } from "../schemas/application";

function normalizePart(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "unknown";
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

export function buildApplicationFieldAnchorId(field: Pick<ApplicationField, "section" | "label" | "pageNumber" | "acroFormName">): string {
  const page = field.pageNumber ? `p${field.pageNumber}` : "pna";
  const section = normalizePart(field.section);
  const label = normalizePart(field.label);
  const acroFormName = normalizePart(field.acroFormName);
  const hash = hashText(`${page}|${section}|${label}|${acroFormName}`);
  return `app_field_anchor:${page}:${section}:${label}:${hash}`;
}

export function buildStableApplicationFieldId(field: Pick<ApplicationField, "section" | "label" | "fieldType" | "pageNumber" | "fieldAnchorId" | "acroFormName">): string {
  const page = field.pageNumber ? `p${field.pageNumber}` : "pna";
  const section = normalizePart(field.section);
  const label = normalizePart(field.label);
  const fieldType = normalizePart(field.fieldType);
  const anchor = field.fieldAnchorId ?? buildApplicationFieldAnchorId(field);
  const hash = hashText(`${page}|${section}|${label}|${fieldType}|${field.acroFormName ?? ""}|${anchor}`);
  return `app_field:${page}:${section}:${label}:${hash}`;
}

export function normalizeApplicationFields(fields: ApplicationField[]): ApplicationField[] {
  const seen = new Map<string, number>();

  return fields.map((field) => {
    const fieldAnchorId = field.fieldAnchorId ?? buildApplicationFieldAnchorId(field);
    const baseId = buildStableApplicationFieldId({ ...field, fieldAnchorId });
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);

    return {
      ...field,
      id: count === 0 ? baseId : `${baseId}:${count + 1}`,
      fieldAnchorId,
      validationStatus: field.validationStatus ?? (field.value ? "needs_review" : "missing"),
    };
  });
}
