import { describe, expect, it } from "vitest";
import {
  buildDeterministicOperationalProfile,
  buildDocumentSourceTree,
  buildSourceSpan,
} from "../../source";

describe("source tree v3", () => {
  it("builds a nested hierarchy from page, table row, and table cell spans", () => {
    const page = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Declarations Schedule Cyber Liability Limit $1,000,000 Deductible $10,000",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "page",
    }, 0);
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Coverage: Cyber Liability | Limit: $1,000,000 | Deductible: $10,000",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "table_row",
      table: { tableId: "table-1", rowIndex: 1 },
    }, 1);
    const cell = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "$1,000,000",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "table_cell",
      parentSpanId: row.id,
      table: { tableId: "table-1", rowIndex: 1, columnIndex: 1, columnName: "Limit", rowSpanId: row.id },
    }, 2);

    const tree = buildDocumentSourceTree([cell, row, page], "policy-1");

    const document = tree.find((node) => node.kind === "document");
    const pageNode = tree.find((node) => node.kind === "page");
    const table = tree.find((node) => node.kind === "table");
    const rowNode = tree.find((node) => node.kind === "table_row");
    const cellNode = tree.find((node) => node.kind === "table_cell");

    expect(document).toBeTruthy();
    expect(pageNode?.parentId).toBe(document?.id);
    expect(table?.parentId).toBe(pageNode?.id);
    expect(rowNode?.parentId).toBe(table?.id);
    expect(cellNode?.parentId).toBe(rowNode?.id);
    expect(rowNode?.sourceSpanIds).toEqual([row.id]);
    expect(cellNode?.sourceSpanIds).toEqual([cell.id]);
    expect(tree.map((node) => node.path)).toEqual([...tree.map((node) => node.path)].sort());
  });

  it("builds source-backed operational coverage facts from table rows", () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Policy Number: SLS-EO-26-110482 Named Insured: Cios Technologies Inc. Coverage: Professional Liability | Limit: $1,000,000 | Deductible: $10,000 | Premium: $2,500",
      pageStart: 3,
      pageEnd: 3,
      sourceUnit: "table_row",
      table: { tableId: "limits", rowIndex: 1 },
    });
    const tree = buildDocumentSourceTree([row], "policy-1");
    const profile = buildDeterministicOperationalProfile({ sourceTree: tree, sourceSpans: [row] });

    expect(profile.policyNumber?.value).toBe("SLS-EO-26-110482");
    expect(profile.namedInsured?.value).toBe("Cios Technologies Inc");
    expect(profile.coverages[0]).toEqual(expect.objectContaining({
      name: "Professional Liability",
      limit: "$1,000,000",
      deductible: "$10,000",
      premium: "$2,500",
      sourceSpanIds: [row.id],
    }));
  });
});
