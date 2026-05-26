import type { FormInventoryEntry, FormInventoryResult } from "../prompts/coordinator/form-inventory";
import type { PageAssignment } from "../prompts/coordinator/page-map";
import type { DocumentTemplate } from "../prompts/templates";
import type { ExtractionPlan } from "./plan";

export function normalizePageAssignments(
  pageAssignments: PageAssignment[],
  _formInventory?: FormInventoryResult,
): PageAssignment[] {
  return pageAssignments.map((assignment) => {
    const extractorNames: PageAssignment["extractorNames"] = [...new Set(
      assignment.extractorNames.filter(Boolean),
    )] as PageAssignment["extractorNames"];
    return {
      ...assignment,
      extractorNames,
    };
  });
}

export function buildTemplateHints(
  primaryType: string,
  documentType: "policy" | "quote",
  pageCount: number,
  template: DocumentTemplate,
): string {
  return [
    `Document type: ${primaryType} ${documentType}`,
    `Expected sections: ${template.expectedSections.join(", ")}`,
    `Page hints: ${Object.entries(template.pageHints).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
    `Total pages: ${pageCount}`,
  ].join("\n");
}

export function groupContiguousPages(pages: number[]): Array<{ startPage: number; endPage: number }> {
  if (pages.length === 0) return [];
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges: Array<{ startPage: number; endPage: number }> = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push({ startPage: start, endPage: previous });
    start = current;
    previous = current;
  }

  ranges.push({ startPage: start, endPage: previous });
  return ranges;
}

export function buildPlanFromPageAssignments(
  pageAssignments: PageAssignment[],
  pageCount: number,
  formInventory?: FormInventoryResult,
): ExtractionPlan {
  const extractorPages = new Map<string, number[]>();

  for (const assignment of pageAssignments) {
    const focusedExtractors = assignment.extractorNames.filter((name) => name !== "sections");
    const extractors = focusedExtractors.length > 0 ? focusedExtractors : assignment.extractorNames;
    for (const extractorName of extractors) {
      extractorPages.set(extractorName, [...(extractorPages.get(extractorName) ?? []), assignment.localPageNumber]);
    }
  }

  const contextualExtractors = new Set(["conditions", "covered_reasons", "definitions", "exclusions", "endorsements"]);
  const contextualForms = (formInventory?.forms ?? []).filter((form): form is FormInventoryEntry & { pageStart: number; pageEnd: number } =>
    form.pageStart != null && (form.pageEnd ?? form.pageStart) != null,
  );

  const expandPagesToFormRanges = (extractorName: string, pages: number[]): number[] => {
    if (!contextualExtractors.has(extractorName)) return pages;

    const expanded = new Set<number>(pages);
    for (const page of pages) {
      for (const form of contextualForms) {
        const pageStart = form.pageStart;
        const pageEnd = form.pageEnd ?? form.pageStart;
        const formType = form.formType;
        const supportsContextualExpansion = extractorName === "endorsements"
          ? formType === "endorsement"
          : formType === "coverage" || formType === "endorsement";

        if (!supportsContextualExpansion) continue;
        if (page < pageStart || page > pageEnd) continue;

        for (let current = pageStart; current <= pageEnd; current += 1) {
          expanded.add(current);
        }
      }
    }

    return [...expanded].sort((a, b) => a - b);
  };

  const tasks = [...extractorPages.entries()]
    .flatMap(([extractorName, pages]) =>
      groupContiguousPages(expandPagesToFormRanges(extractorName, pages)).map(({ startPage, endPage }) => ({
        extractorName,
        startPage,
        endPage,
        description: `Page-mapped ${extractorName} extraction for pages ${startPage}-${endPage}`,
      }))
    )
    .sort((a, b) => a.startPage - b.startPage || a.extractorName.localeCompare(b.extractorName));

  return {
    tasks,
    pageMap: [...extractorPages.entries()].map(([section, pages]) => ({
      section,
      pages: `pages ${[...new Set(pages)].sort((a, b) => a - b).join(", ")}`,
    })),
  };
}
