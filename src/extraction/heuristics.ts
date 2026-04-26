export function looksReferential(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return normalized.includes("shown in the declarations")
    || normalized.includes("shown in declarations")
    || normalized.includes("shown in the schedule")
    || normalized.includes("as stated")
    || normalized.includes("if applicable");
}

export function looksCoveredReasonSection(section: Record<string, unknown>): boolean {
  const title = String(section.title ?? "").toLowerCase();
  const type = String(section.type ?? "").toLowerCase();
  return type === "covered_reason"
    || title.includes("covered cause")
    || title.includes("covered reason")
    || title.includes("covered peril");
}
