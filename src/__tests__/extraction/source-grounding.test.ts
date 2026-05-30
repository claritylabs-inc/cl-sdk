import { describe, expect, it } from "vitest";
import { buildPageSourceSpans, buildSourceSpan } from "../../source";
import { findSourceSpansForRecord, groundExtractionMemoryWithSourceSpans } from "../../extraction/source-grounding";

describe("extraction source grounding", () => {
  it("matches records to source spans by page and content", () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 3,
        text: "Building coverage limit is $1,000,000 with deductible $5,000.",
      },
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 4,
        text: "Water exclusion applies.",
      },
    ]);

    const matches = findSourceSpansForRecord({
      name: "Building",
      limit: "$1,000,000",
      pageNumber: 3,
    }, sourceSpans);

    expect(matches.map((span) => span.id)).toEqual([sourceSpans[0].id]);
  });

  it("adds source span IDs and text hashes to repeated extraction records", () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 5,
        formNumber: "CP 00 10",
        text: "Water exclusion applies to flood and sewer backup.",
      },
    ]);
    const memory = new Map<string, unknown>([
      ["exclusions", {
        exclusions: [{
          name: "Water",
          formNumber: "CP 00 10",
          content: "Water exclusion applies to flood and sewer backup.",
          pageNumber: 5,
        }],
      }],
    ]);

    groundExtractionMemoryWithSourceSpans(memory, sourceSpans);

    expect(memory.get("exclusions")).toEqual({
      exclusions: [
        expect.objectContaining({
          sourceSpanIds: [sourceSpans[0].id],
          sourceTextHash: sourceSpans[0].textHash,
        }),
      ],
    });
  });

  it("grounds table-cell matches to their parent row span", () => {
    const tableSpan = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      pageStart: 18,
      pageEnd: 18,
      text: "| Coverage | Limit |\n| --- | --- |\n| Premium Trust Fund Sub-Limit | CAD $250,000 / $250,000 |",
      sourceUnit: "table",
      table: { tableId: "table-1" },
      metadata: { sourceUnit: "table", tableId: "table-1" },
    }, 0);
    const rowSpan = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      pageStart: 18,
      pageEnd: 18,
      text: "Coverage: Premium Trust Fund Sub-Limit | Limit: CAD $250,000 / $250,000",
      sourceUnit: "table_row",
      parentSpanId: tableSpan.id,
      table: { tableId: "table-1", tableSpanId: tableSpan.id, rowIndex: 1 },
      metadata: { sourceUnit: "table_row", tableId: "table-1", tableSpanId: tableSpan.id, rowIndex: "1" },
    }, 1);
    const cellSpan = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      pageStart: 18,
      pageEnd: 18,
      text: "CAD $250,000 / $250,000",
      sourceUnit: "table_cell",
      parentSpanId: rowSpan.id,
      table: { tableId: "table-1", tableSpanId: tableSpan.id, rowSpanId: rowSpan.id, rowIndex: 1, columnIndex: 1, columnName: "Limit" },
      metadata: { sourceUnit: "table_cell", tableId: "table-1", tableSpanId: tableSpan.id, rowSpanId: rowSpan.id, rowIndex: "1", columnIndex: "1", columnName: "Limit" },
    }, 2);

    const matches = findSourceSpansForRecord({
      name: "Premium Trust Fund Sub-Limit",
      limit: "CAD $250,000 / $250,000",
      pageNumber: 18,
    }, [tableSpan, cellSpan, rowSpan]);

    expect(matches[0].id).toBe(rowSpan.id);
  });
});
