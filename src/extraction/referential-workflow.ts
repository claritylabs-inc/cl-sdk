import type { FormInventoryEntry } from "../prompts/coordinator/form-inventory";

export interface ReferentialSectionEntry {
  title?: string;
  type?: string;
  pageStart?: number;
  pageEnd?: number;
}

export type ReferentialTargetKind =
  | "declarations"
  | "schedule"
  | "item"
  | "premises"
  | "section"
  | "policy"
  | "unknown";

export type ReferentialResolutionAction =
  | { kind: "lookup_pages"; source: "local"; pageRange: { startPage: number; endPage: number } }
  | { kind: "lookup_pages"; source: "declarations_schedule"; pageRange: { startPage: number; endPage: number } }
  | { kind: "lookup_pages"; source: "sections"; pageRange: { startPage: number; endPage: number } }
  | { kind: "page_location" }
  | { kind: "skip"; reason: string };

export interface ParsedReferentialTarget {
  raw: string;
  normalized: string;
  kind: ReferentialTargetKind;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function containsTarget(value: unknown, target: string): boolean {
  const normalizedValue = normalizeText(value);
  return Boolean(normalizedValue && target && normalizedValue.includes(target));
}

function pageRangeFrom(startPage: unknown, endPage: unknown): { startPage: number; endPage: number } | undefined {
  if (typeof startPage !== "number" || !Number.isFinite(startPage) || startPage <= 0) {
    return undefined;
  }
  const normalizedEnd =
    typeof endPage === "number" && Number.isFinite(endPage) && endPage >= startPage
      ? endPage
      : startPage;
  return { startPage, endPage: normalizedEnd };
}

export function parseReferentialTarget(rawTarget: string | undefined): ParsedReferentialTarget {
  const raw = rawTarget?.trim() || "unknown";
  const normalized = raw.toLowerCase();

  if (normalized === "unknown") return { raw, normalized, kind: "unknown" };
  if (/declarations?|dec\b|decs\b/.test(normalized)) return { raw, normalized, kind: "declarations" };
  if (/schedule|scheduled/.test(normalized)) return { raw, normalized, kind: "schedule" };
  if (/\bitem\b/.test(normalized)) return { raw, normalized, kind: "item" };
  if (/premises?|location|building/.test(normalized)) return { raw, normalized, kind: "premises" };
  if (/\bsection\b/.test(normalized)) return { raw, normalized, kind: "section" };
  if (/policy|coverage\s+part|coverage\s+form/.test(normalized)) return { raw, normalized, kind: "policy" };

  return { raw, normalized, kind: "unknown" };
}

export function findLocalReferentialPages(params: {
  referenceTarget: string;
  sections: ReferentialSectionEntry[];
  formInventory: FormInventoryEntry[];
}): { startPage: number; endPage: number } | undefined {
  const targetLower = params.referenceTarget.toLowerCase();

  for (const section of params.sections) {
    if (containsTarget(section.title, targetLower)) {
      const range = pageRangeFrom(section.pageStart, section.pageEnd);
      if (range) return range;
    }
  }

  for (const form of params.formInventory) {
    const titleMatch = containsTarget(form.title, targetLower);
    const typeMatch = containsTarget(form.formType, targetLower);
    const numberMatch = containsTarget(form.formNumber, targetLower);

    if (titleMatch || typeMatch || numberMatch) {
      const range = pageRangeFrom(form.pageStart, form.pageEnd);
      if (range) return range;
    }
  }

  return undefined;
}

function findDeclarationsSchedulePages(
  parsedTarget: ParsedReferentialTarget,
  formInventory: FormInventoryEntry[],
): { startPage: number; endPage: number } | undefined {
  for (const form of formInventory) {
    const formType = normalizeText(form.formType);
    const title = normalizeText(form.title);
    const matchesDeclarations = formType === "declarations" || /declarations?|dec\b|decs\b/.test(title);
    const matchesSchedule = /schedule|scheduled|coverage/.test(title) || formType === "coverage";

    const shouldUse =
      parsedTarget.kind === "declarations"
        ? matchesDeclarations
        : parsedTarget.kind === "schedule" || parsedTarget.kind === "item" || parsedTarget.kind === "premises"
          ? matchesSchedule || matchesDeclarations
          : parsedTarget.kind === "policy"
            ? matchesDeclarations || matchesSchedule
            : false;

    if (shouldUse) {
      const range = pageRangeFrom(form.pageStart, form.pageEnd);
      if (range) return range;
    }
  }

  return undefined;
}

function findSectionPages(
  parsedTarget: ParsedReferentialTarget,
  sections: ReferentialSectionEntry[],
): { startPage: number; endPage: number } | undefined {
  for (const section of sections) {
    const title = normalizeText(section.title);
    const type = normalizeText(section.type);
    const matchesKind =
      (parsedTarget.kind === "declarations" && (type === "declarations" || /declarations?/.test(title))) ||
      (parsedTarget.kind === "schedule" && (type === "schedule" || /schedule|scheduled/.test(title))) ||
      (parsedTarget.kind === "premises" && /premises?|location|building/.test(title)) ||
      (parsedTarget.kind === "item" && /\bitem\b|schedule|scheduled/.test(title)) ||
      (parsedTarget.kind === "section" && containsTarget(title, parsedTarget.normalized));

    if (matchesKind) {
      const range = pageRangeFrom(section.pageStart, section.pageEnd);
      if (range) return range;
    }
  }

  return undefined;
}

export function decideReferentialResolutionAction(params: {
  referenceTarget: string | undefined;
  sections: ReferentialSectionEntry[];
  formInventory: FormInventoryEntry[];
  localPageRange?: { startPage: number; endPage: number };
}): ReferentialResolutionAction {
  if (params.localPageRange) {
    return { kind: "lookup_pages", source: "local", pageRange: params.localPageRange };
  }

  const parsedTarget = parseReferentialTarget(params.referenceTarget);

  const declarationsScheduleRange = findDeclarationsSchedulePages(parsedTarget, params.formInventory);
  if (declarationsScheduleRange) {
    return {
      kind: "lookup_pages",
      source: "declarations_schedule",
      pageRange: declarationsScheduleRange,
    };
  }

  const sectionRange = findSectionPages(parsedTarget, params.sections);
  if (sectionRange) {
    return { kind: "lookup_pages", source: "sections", pageRange: sectionRange };
  }

  if (parsedTarget.kind === "unknown") {
    return { kind: "skip", reason: "no concrete reference target" };
  }

  return { kind: "page_location" };
}
