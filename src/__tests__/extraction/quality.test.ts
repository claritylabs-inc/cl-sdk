import { describe, it, expect } from "vitest";
import { buildSourceSpan } from "../../source";
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
    expect(report.issues.some((issue) => issue.code === "covered_reason_referential_value")).toBe(false);
  });

  it("distinguishes source-grounding failures when source spans are available", () => {
    const report = buildExtractionReviewReport({
      memory: new Map<string, unknown>([
        ["coverage_limits", {
          coverages: [{
            name: "Building limit",
            limit: "$1,000,000",
            pageNumber: 3,
          }],
        }],
      ]),
      pageAssignments: [{ localPageNumber: 3, extractorNames: ["coverage_limits"] }],
      reviewRounds: [{ round: 1, complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] }],
      sourceSpansAvailable: true,
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "record_missing_source_span",
        extractorName: "coverage_limits",
        itemName: "Building limit",
      }),
    ]));
  });

  it("blocks deductible rows that were extracted as coverage limits", () => {
    const report = buildExtractionReviewReport({
      memory: new Map<string, unknown>([
        ["coverage_limits", {
          coverages: [{
            name: "Premium Trust Fund Conversion Sub-Limit - Enhanced Deductible (CAD$100,000 each Claim; Loss and Defence Costs)",
            limit: "100000",
            limitAmount: 100000,
            pageNumber: 18,
            sectionRef: "SCHEDULE",
            originalContent: "Enhanced Deductible - CAD$100,000 each Claim (Loss and Defence Costs)",
          }],
        }],
      ]),
      pageAssignments: [{ localPageNumber: 18, extractorNames: ["coverage_limits"] }],
      reviewRounds: [{ round: 1, complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] }],
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "deductible_row_as_coverage_limit",
        severity: "blocking",
        extractorName: "coverage_limits",
        pageNumber: 18,
      }),
    ]));
  });

  it("allows legitimate deductible coverage rows with limits", () => {
    const report = buildExtractionReviewReport({
      memory: new Map<string, unknown>([
        ["coverage_limits", {
          coverages: [{
            name: "Deductible Reimbursement Coverage",
            limit: "$25,000",
            limitAmount: 25000,
            pageNumber: 7,
            sectionRef: "SCHEDULE",
            originalContent: "Deductible Reimbursement Coverage limit $25,000",
          }],
        }],
      ]),
      pageAssignments: [{ localPageNumber: 7, extractorNames: ["coverage_limits"] }],
      reviewRounds: [{ round: 1, complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] }],
    });

    expect(report.issues.some((issue) => issue.code === "deductible_row_as_coverage_limit")).toBe(false);
  });

  it("blocks when explicit source schedule rows are missing from coverage extraction", () => {
    const sourceRow = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      pageStart: 18,
      pageEnd: 18,
      text: "Premium Trust Fund Sub-Limit (Each Claim / Aggregate): CAD $250,000 / $250,000",
      sourceUnit: "table_row",
      table: { tableId: "table-18", tableSpanId: "table-18", rowIndex: 1 },
      metadata: { sourceUnit: "table_row", tableId: "table-18", tableSpanId: "table-18", rowIndex: "1", isHeader: "false" },
    }, 1);

    const report = buildExtractionReviewReport({
      memory: new Map<string, unknown>([
        ["coverage_limits", { coverages: [] }],
      ]),
      pageAssignments: [{ localPageNumber: 18, extractorNames: ["coverage_limits"], hasScheduleValues: true }],
      reviewRounds: [{ round: 1, complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] }],
      sourceSpansAvailable: true,
      sourceSpans: [sourceRow],
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "coverage_schedule_row_missing",
        severity: "blocking",
        extractorName: "coverage_limits",
        pageNumber: 18,
      }),
    ]));
  });
});
