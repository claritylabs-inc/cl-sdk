import { describe, it, expect } from "vitest";
import { buildExtractionReviewReport } from "../../extraction/quality";
import { commercialPropertyReviewFixture } from "../fixtures/extraction/commercial-property-review.fixture";

describe("buildExtractionReviewReport", () => {
  it("uses dedicated form inventory artifact and emits unified review fields", () => {
    const memory = new Map<string, unknown>([
      ["form_inventory", commercialPropertyReviewFixture.formInventory],
      ["coverage_limits", commercialPropertyReviewFixture.coverageLimits],
      ["conditions", { conditions: [] }],
      ["endorsements", commercialPropertyReviewFixture.endorsements],
      ["exclusions", { exclusions: [] }],
      ["sections", { sections: [] }],
    ]);

    const report = buildExtractionReviewReport({
      memory,
      pageAssignments: [{ localPageNumber: 1, extractorNames: ["declarations"] }],
      reviewRounds: [{ round: 1, complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] }],
    });

    expect(report.formInventory.map((item) => item.formNumber)).toEqual(["PR068END", "PR5070CF"]);
    expect(report.artifacts.some((artifact) => artifact.kind === "form_inventory")).toBe(true);
    expect(report.issues.length).toBeGreaterThanOrEqual(0);
  });

  it("flags precedence conflicts and toc artifacts from fixture data", () => {
    const memory = new Map<string, unknown>([
      ["form_inventory", commercialPropertyReviewFixture.formInventory],
      ["coverage_limits", commercialPropertyReviewFixture.coverageLimits],
      ["conditions", commercialPropertyReviewFixture.conditions],
      ["endorsements", commercialPropertyReviewFixture.endorsements],
      ["exclusions", { exclusions: [] }],
      ["sections", { sections: [] }],
    ]);

    const report = buildExtractionReviewReport({
      memory,
      pageAssignments: [{ localPageNumber: 1, extractorNames: ["declarations"] }],
      reviewRounds: [{ round: 1, complete: false, missingFields: [], qualityIssues: ["generic values"], additionalTasks: [] }],
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues.some((issue) => issue.code === "coverage_precedence_conflict")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "condition_toc_artifact")).toBe(true);
  });

  it("reports definition and covered reason artifacts and deterministic issues", () => {
    const memory = new Map<string, unknown>([
      ["form_inventory", { forms: [] }],
      ["coverage_limits", { coverages: [] }],
      ["conditions", { conditions: [] }],
      ["endorsements", { endorsements: [] }],
      ["exclusions", { exclusions: [] }],
      ["definitions", { definitions: [{ term: "Specified Causes of Loss" }] }],
      ["covered_reasons", { coveredReasons: [{ name: "Named Perils", content: "Shown in the schedule" }] }],
      ["sections", { sections: [] }],
    ]);

    const report = buildExtractionReviewReport({
      memory,
      pageAssignments: [{ localPageNumber: 3, extractorNames: ["definitions", "covered_reasons"] }],
      reviewRounds: [{ round: 1, complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] }],
    });

    expect(report.artifacts.find((artifact) => artifact.kind === "definitions")?.itemCount).toBe(1);
    expect(report.artifacts.find((artifact) => artifact.kind === "covered_reasons")?.itemCount).toBe(1);
    expect(report.issues.some((issue) => issue.code === "definition_missing_content")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "covered_reason_missing_page_number")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "covered_reason_referential_value")).toBe(true);
  });
});
