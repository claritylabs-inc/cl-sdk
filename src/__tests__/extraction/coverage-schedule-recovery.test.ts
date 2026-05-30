import { describe, expect, it } from "vitest";
import { buildSourceSpan } from "../../source";
import { recoverCoverageScheduleRows } from "../../extraction/coverage-schedule-recovery";

function rowSpan(text: string, pageNumber: number, index: number) {
  return buildSourceSpan({
    documentId: "sls-policy",
    sourceKind: "policy_pdf",
    pageStart: pageNumber,
    pageEnd: pageNumber,
    text,
    sourceUnit: "table_row",
    sectionId: "SCHEDULE",
    formNumber: pageNumber === 5 ? "SLS-DEC 02 25" : "SLS-END 002 02 25",
    table: { tableId: `table-${pageNumber}`, tableSpanId: `table-${pageNumber}`, rowIndex: index },
    metadata: {
      sourceUnit: "table_row",
      tableId: `table-${pageNumber}`,
      tableSpanId: `table-${pageNumber}`,
      rowIndex: String(index),
      isHeader: "false",
    },
  }, pageNumber * 100 + index);
}

describe("coverage schedule recovery", () => {
  it("recovers explicit source-backed schedule coverage rows and ignores deductible-only rows", () => {
    const sourceSpans = [
      rowSpan("Coverage: Insurance Services Errors & Omissions | Limit (CAD): $5,000,000 Each Claim | Basis: Claims-Made | Retroactive Date: NONE - Full Prior Acts", 5, 1),
      rowSpan("Coverage: Insurance Services Errors & Omissions | Limit (CAD): $5,000,000 Aggregate | Basis: Claims-Made | Retroactive Date: NONE - Full Prior Acts", 5, 2),
      rowSpan("Coverage: Sub-Producer Vicarious Liability | Limit (CAD): Shared within Coverage A limits | Basis: Claims-Made | Retroactive Date: 01/01/2022", 5, 3),
      rowSpan("Premium Trust Fund Sub-Limit (Each Claim / Aggregate): CAD $250,000 / $250,000 (part of the Coverage A Aggregate) | Deductible: Enhanced Deductible - CAD $100,000 each Claim (Loss and Defence Costs)", 18, 1),
      rowSpan("Coverage: Enhanced Deductible | Limit (CAD): CAD $100,000 each Claim (Loss and Defence Costs)", 18, 2),
      rowSpan("Regulatory & Disciplinary Proceedings (Aggregate): CAD $100,000 Aggregate | Basis: Claims-Made | Retroactive Date: Full Prior Acts", 19, 1),
      rowSpan("Subpoena & Document Production Assistance (Aggregate): CAD $25,000 Aggregate | Basis: Claims-Made | Retroactive Date: Full Prior Acts", 19, 2),
    ];
    const memory = new Map<string, unknown>([
      ["coverage_limits", { coverages: [] }],
    ]);

    const result = recoverCoverageScheduleRows({
      memory,
      sourceSpans,
      pageAssignments: [
        { localPageNumber: 5, extractorNames: ["coverage_limits"], hasScheduleValues: true },
        { localPageNumber: 18, extractorNames: ["coverage_limits"], hasScheduleValues: true },
        { localPageNumber: 19, extractorNames: ["coverage_limits"], hasScheduleValues: true },
      ],
    });

    const coverages = (memory.get("coverage_limits") as { coverages: Array<Record<string, unknown>> }).coverages;
    expect(result.recovered).toHaveLength(6);
    expect(coverages.map((coverage) => coverage.name)).toEqual([
      "Insurance Services Errors & Omissions",
      "Insurance Services Errors & Omissions",
      "Sub-Producer Vicarious Liability",
      "Premium Trust Fund Sub-Limit (Each Claim / Aggregate)",
      "Regulatory & Disciplinary Proceedings (Aggregate)",
      "Subpoena & Document Production Assistance (Aggregate)",
    ]);
    expect(coverages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Premium Trust Fund Sub-Limit (Each Claim / Aggregate)",
        limit: "CAD $250,000 / $250,000 (part of the Coverage A Aggregate)",
        limitAmount: 250000,
        pageNumber: 18,
        sourceSpanIds: [sourceSpans[3].id],
      }),
      expect.objectContaining({
        name: "Sub-Producer Vicarious Liability",
        limit: "Shared within Coverage A limits",
        limitValueType: "referential",
        retroactiveDate: "01/01/2022",
      }),
      expect.objectContaining({
        name: "Regulatory & Disciplinary Proceedings (Aggregate)",
        limitAmount: 100000,
        limitType: "aggregate",
      }),
      expect.objectContaining({
        name: "Subpoena & Document Production Assistance (Aggregate)",
        limitAmount: 25000,
        limitType: "aggregate",
      }),
    ]));
    expect(coverages.some((coverage) => String(coverage.name).includes("Enhanced Deductible"))).toBe(false);
  });
});
