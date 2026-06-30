import { describe, expect, it } from "vitest";
import {
  buildDocumentSourceTree,
  buildSourceSpan,
  normalizeDocumentSourceTreePaths,
} from "../../source";
import { runSourceTreeExtraction } from "../../extraction/source-tree-extractor";

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
      table: {
        tableId: "table-1",
        rowIndex: 1,
        columnIndex: 1,
        columnName: "Limit",
        rowSpanId: row.id,
      },
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

  it("normalizes existing source tree paths without extracting policy facts", () => {
    const tree = normalizeDocumentSourceTreePaths([
      {
        id: "doc",
        documentId: "policy-1",
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "row-a",
        documentId: "policy-1",
        parentId: "doc",
        kind: "table_row",
        title: "Row 1",
        description: "Coverage Part: A. Technology Professional Liability | Limit of Liability: $2,000,000 Each Claim | Deductible: $10,000",
        textExcerpt: "Coverage Part: A. Technology Professional Liability | Limit of Liability: $2,000,000 Each Claim | Deductible: $10,000",
        sourceSpanIds: ["span-row-a"],
        pageStart: 5,
        pageEnd: 5,
        order: 1,
        path: "",
      },
    ]);

    expect(tree.map((node) => node.path)).toEqual(["1", "1.1"]);
    expect(tree[1]).toEqual(expect.objectContaining({
      id: "row-a",
      kind: "table_row",
      sourceSpanIds: ["span-row-a"],
    }));
  });

  it("persists model-generated operational facts instead of deterministic table guesses", async () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Coverage Part: A. Technology Professional Liability | Limit of Liability: $2,000,000 Each Claim | Deductible: $10,000 | Retroactive Date: 01/01/2024",
      pageStart: 5,
      pageEnd: 5,
      sourceUnit: "table_row",
      table: { tableId: "limits", rowIndex: 1 },
    });

    const extraction = await runSourceTreeExtraction({
      id: "policy-1",
      sourceSpans: [row],
      generateObject: async ({ taskKind }) => {
        if (taskKind === "extraction_operational_profile") {
          return {
            object: {
              documentType: "policy",
              policyTypes: ["cyber"],
              coverages: [{
                name: "A. Technology Professional Liability",
                limit: "$2,000,000 Each Claim",
                deductible: "$10,000",
                retroactiveDate: "01/01/2024",
                coverageOrigin: "core",
                sourceNodeIds: ["policy-1:source_node:table_row:limits:1"],
                sourceSpanIds: [row.id],
                limits: [
                  {
                    kind: "each_claim_limit",
                    label: "Each Claim Limit",
                    value: "$2,000,000 Each Claim",
                    sourceNodeIds: ["policy-1:source_node:table_row:limits:1"],
                    sourceSpanIds: [row.id],
                  },
                  {
                    kind: "deductible",
                    label: "Deductible",
                    value: "$10,000",
                    sourceNodeIds: ["policy-1:source_node:table_row:limits:1"],
                    sourceSpanIds: [row.id],
                  },
                ],
              }],
            },
          };
        }
        return { object: { labels: [], groups: [], coverageDecisions: [], warnings: [] } };
      },
      resolveBudget: (taskKind, hintTokens) => ({
        taskKind,
        hintTokens,
        maxTokens: 8192,
        outputTruncationRisk: "low",
        warnings: [],
      }),
      trackUsage: () => {},
    });

    expect(extraction.operationalProfile.coverages).toHaveLength(1);
    expect(extraction.operationalProfile.coverages[0]).toEqual(expect.objectContaining({
      name: "A. Technology Professional Liability",
      limit: "$2,000,000 Each Claim",
      deductible: "$10,000",
    }));
  });

  it("omits operational facts when the model returns none", async () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Coverage Part: A. Technology Professional Liability | Limit of Liability: $2,000,000 Each Claim | Deductible: $10,000",
      pageStart: 5,
      pageEnd: 5,
      sourceUnit: "table_row",
      table: { tableId: "limits", rowIndex: 1 },
    });

    const extraction = await runSourceTreeExtraction({
      id: "policy-1",
      sourceSpans: [row],
      generateObject: async () => ({ object: { labels: [], groups: [], coverageDecisions: [], warnings: [] } }),
      resolveBudget: (taskKind, hintTokens) => ({
        taskKind,
        hintTokens,
        maxTokens: 8192,
        outputTruncationRisk: "low",
        warnings: [],
      }),
      trackUsage: () => {},
    });

    expect(extraction.operationalProfile.coverages).toEqual([]);
    expect(extraction.operationalProfile.policyNumber).toBeUndefined();
    expect(extraction.operationalProfile.namedInsured).toBeUndefined();
  });
});
