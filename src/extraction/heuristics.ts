export function looksCoveredReasonSection(section: Record<string, unknown>): boolean {
  const title = String(section.title ?? "").toLowerCase();
  const type = String(section.type ?? "").toLowerCase();
  return type === "covered_reason"
    || title.includes("covered cause")
    || title.includes("covered reason")
    || title.includes("covered peril");
}
