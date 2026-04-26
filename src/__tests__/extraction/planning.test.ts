import { describe, expect, it } from "vitest";
import {
  buildPlanFromPageAssignments,
  buildTemplateHints,
  groupContiguousPages,
  normalizePageAssignments,
} from "../../extraction/planning";
import type { FormInventoryResult } from "../../prompts/coordinator/form-inventory";
import type { PageAssignment } from "../../prompts/coordinator/page-map";
import type { DocumentTemplate } from "../../prompts/templates";

describe("planning helpers", () => {
  it("groups unique contiguous pages into sorted ranges", () => {
    expect(groupContiguousPages([5, 2, 3, 3, 1, 8])).toEqual([
      { startPage: 1, endPage: 3 },
      { startPage: 5, endPage: 5 },
      { startPage: 8, endPage: 8 },
    ]);
  });

  it("normalizes page assignments using form inventory constraints", () => {
    const assignments: PageAssignment[] = [
      {
        localPageNumber: 2,
        extractorNames: ["coverage_limits", "sections"],
        confidence: 0.9,
      },
      {
        localPageNumber: 3,
        extractorNames: ["coverage_limits"],
        pageRole: "endorsement_form",
        hasScheduleValues: true,
      },
      {
        localPageNumber: 4,
        extractorNames: [],
      },
    ];
    const formInventory: FormInventoryResult = {
      forms: [
        { formNumber: "E-1", formType: "endorsement", pageStart: 2, pageEnd: 3 },
      ],
    };

    expect(normalizePageAssignments(assignments, formInventory).map((assignment) => assignment.extractorNames)).toEqual([
      ["sections", "endorsements"],
      ["coverage_limits", "endorsements"],
      ["sections"],
    ]);
  });

  it("builds deterministic tasks and expands contextual extractors to form ranges", () => {
    const assignments: PageAssignment[] = [
      { localPageNumber: 1, extractorNames: ["declarations"] },
      { localPageNumber: 3, extractorNames: ["conditions"] },
      { localPageNumber: 5, extractorNames: ["endorsements"] },
    ];
    const formInventory: FormInventoryResult = {
      forms: [
        { formNumber: "COV-1", formType: "coverage", pageStart: 2, pageEnd: 4 },
        { formNumber: "END-1", formType: "endorsement", pageStart: 5, pageEnd: 6 },
      ],
    };

    expect(buildPlanFromPageAssignments(assignments, 6, formInventory).tasks).toEqual([
      {
        extractorName: "declarations",
        startPage: 1,
        endPage: 1,
        description: "Page-mapped declarations extraction for pages 1-1",
      },
      {
        extractorName: "conditions",
        startPage: 2,
        endPage: 4,
        description: "Page-mapped conditions extraction for pages 2-4",
      },
      {
        extractorName: "sections",
        startPage: 2,
        endPage: 2,
        description: "Page-mapped sections extraction for pages 2-2",
      },
      {
        extractorName: "sections",
        startPage: 4,
        endPage: 4,
        description: "Page-mapped sections extraction for pages 4-4",
      },
      {
        extractorName: "endorsements",
        startPage: 5,
        endPage: 6,
        description: "Page-mapped endorsements extraction for pages 5-6",
      },
      {
        extractorName: "sections",
        startPage: 6,
        endPage: 6,
        description: "Page-mapped sections extraction for pages 6-6",
      },
    ]);
  });

  it("builds template hints from template metadata", () => {
    const template: DocumentTemplate = {
      type: "general_liability",
      expectedSections: ["declarations", "conditions"],
      pageHints: { declarations: "front pages", conditions: "later pages" },
      required: [],
      optional: [],
    };

    expect(buildTemplateHints("general_liability", "policy", 12, template)).toBe([
      "Document type: general_liability policy",
      "Expected sections: declarations, conditions",
      "Page hints: declarations: front pages; conditions: later pages",
      "Total pages: 12",
    ].join("\n"));
  });
});
