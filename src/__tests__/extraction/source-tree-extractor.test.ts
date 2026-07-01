import { describe, expect, it, vi } from "vitest";
import type { GenerateObject } from "../../core/types";
import type { ModelTaskKind } from "../../core/model-budget";
import type { DocumentSourceNode, PolicyOperationalProfile } from "../../source";
import { buildPageSourceSpans, buildSourceSpan } from "../../source";
import { buildOperationalProfileCleanupPrompt } from "../../extraction/operational-profile-cleanup";
import { runSourceTreeExtraction } from "../../extraction/source-tree-extractor";
import { InsurerInfoSchema, ProducerInfoSchema } from "../../schemas/parties";

const resolveBudget = (taskKind: ModelTaskKind, hintTokens: number) => ({
  taskKind,
  hintTokens,
  maxTokens: 8192,
  outputTruncationRisk: "low" as const,
  warnings: [],
});

function modelStub(): GenerateObject {
  return vi.fn(async (params) => {
    if (params.prompt.includes("Review and clean a source-backed operational profile projection")) {
      return {
        object: {
          coverageDecisions: [],
          warnings: [],
        },
      };
    }
    if (params.taskKind === "extraction_operational_profile") {
      return {
        object: {
          documentType: "policy",
          policyTypes: ["cyber"],
          coverageTypes: ["cyber"],
        },
      };
    }
    return { object: { labels: [], groups: [] } };
  }) as GenerateObject;
}

describe("source-tree extraction", () => {
  it("uses form inventory page ranges as the source-tree skeleton", async () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 1,
        text: "SPECIMEN POLICY - FOR TESTING ONLY",
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        text: "DECLARATIONS PAGE Named Insured Cove Technologies Inc.",
      },
      {
        documentId: "doc-1",
        pageNumber: 3,
        text: "Coverage Parts, Limits, Sub-Limits, and Retroactive Dates",
      },
      {
        documentId: "doc-1",
        pageNumber: 4,
        text: "TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY PLEASE READ THIS ENTIRE POLICY CAREFULLY.",
      },
      {
        documentId: "doc-1",
        pageNumber: 5,
        text: "SECTION I INSURING AGREEMENTS",
      },
      {
        documentId: "doc-1",
        pageNumber: 6,
        text: "ENDORSEMENT NO. 1 THIS ENDORSEMENT CHANGES THE POLICY.",
      },
      {
        documentId: "doc-1",
        pageNumber: 7,
        text: "All other terms and conditions remain unchanged under Endorsement No. 1.",
      },
    ]);

    const result = await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans,
      formInventory: {
        forms: [
          {
            formNumber: "NWC-DEC 04 25",
            editionDate: "04/25",
            title: "DECLARATIONS PAGE",
            formType: "declarations",
            pageStart: 2,
            pageEnd: 3,
          },
          {
            formNumber: "NWC-TEC 04 25",
            editionDate: "04/25",
            title: "TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY",
            formType: "coverage",
            pageStart: 4,
            pageEnd: 5,
          },
          {
            formNumber: "NWC-END 001 04 25",
            editionDate: "04/25",
            title: "ENDORSEMENT NO. 1 - NETWORK SECURITY AND PRIVACY LIABILITY COVERAGE",
            formType: "endorsement",
            pageStart: 6,
            pageEnd: 7,
          },
        ],
      },
      generateObject: modelStub(),
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const root = result.sourceTree.find((node) => node.kind === "document");
    const topLevel = result.sourceTree
      .filter((node) => node.parentId === root?.id)
      .map((node) => ({ title: node.title, kind: node.kind, pageStart: node.pageStart, pageEnd: node.pageEnd }));

    expect(topLevel).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Declarations", kind: "page_group", pageStart: 2, pageEnd: 3 }),
      expect.objectContaining({ title: "Policy Form", kind: "form", pageStart: 4, pageEnd: 5 }),
      expect.objectContaining({ title: "Endorsements", kind: "page_group", pageStart: 6, pageEnd: 7 }),
    ]));
    const endorsements = result.sourceTree.find((node) => node.title === "Endorsements" && node.kind === "page_group");
    expect(result.sourceTree.find((node) => node.parentId === endorsements?.id)).toEqual(expect.objectContaining({
      kind: "endorsement",
      title: "Endorsement No. 1",
      pageStart: 6,
      pageEnd: 7,
    }));
  });

  it("runs operational coverage cleanup as one source-backed pass", async () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 5,
        text: "Coverage Part A Technology Professional Liability Each Claim Limit $2,000,000.",
      },
      {
        documentId: "doc-1",
        pageNumber: 19,
        text: "Endorsement No. 1 Network Security and Privacy Liability Each Claim Limit $1,000,000.",
      },
    ]);
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") {
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
            coverageTypes: ["cyber"],
            coverages: [
              {
                name: "Technology Professional Liability",
                coverageOrigin: "core",
                sourceNodeIds: [],
                sourceSpanIds: [sourceSpans[0].id],
                limits: [],
              },
              {
                name: "Network Security and Privacy Liability",
                coverageOrigin: "endorsement",
                endorsementNumber: "Endorsement No. 1",
                sourceNodeIds: [],
                sourceSpanIds: [sourceSpans[1].id],
                limits: [],
              },
            ],
            parties: [],
            endorsementSupport: [],
            warnings: [],
            sourceNodeIds: [],
            sourceSpanIds: sourceSpans.map((span) => span.id),
          },
        };
      }
      if (params.taskKind === "extraction_coverage_cleanup") {
        return {
          object: {
            coverageDecisions: [],
            warnings: [],
          },
        };
      }
      return { object: { labels: [], groups: [] } };
    }) as GenerateObject & ReturnType<typeof vi.fn>;

    const result = await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans,
      formInventory: { forms: [] },
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const cleanupCalls = generateObject.mock.calls
      .map(([params]) => params)
      .filter((params) => params.taskKind === "extraction_coverage_cleanup");
    expect(cleanupCalls).toHaveLength(2);
    expect(cleanupCalls[0]?.trace).toEqual(expect.objectContaining({
      label: "Coverage schedule cleanup: policy schedules",
      itemCount: 1,
      coverageGroup: "policy",
      batchIndex: 1,
      batchCount: 2,
      sourceBacked: true,
    }));
    expect(cleanupCalls[0]?.prompt).toContain('"coverageIndex": 0');
    expect(cleanupCalls[0]?.prompt).not.toContain('"coverageIndex": 1');
    expect(cleanupCalls[1]?.trace).toEqual(expect.objectContaining({
      label: "Coverage schedule cleanup: endorsement schedules",
      itemCount: 1,
      coverageGroup: "endorsements",
      batchIndex: 2,
      batchCount: 2,
      sourceBacked: true,
    }));
    expect(cleanupCalls[1]?.prompt).not.toContain('"coverageIndex": 0');
    expect(cleanupCalls[1]?.prompt).toContain('"coverageIndex": 1');

    const profileCalls = generateObject.mock.calls
      .map(([params]) => params)
      .filter((params) => params.taskKind === "extraction_operational_profile");
    expect(profileCalls[0]?.prompt).toContain("Do not merge declaration facts and endorsement schedule facts");
    expect(result.operationalProfile.coverages.map((coverage) => ({
      name: coverage.name,
      origin: coverage.coverageOrigin,
      endorsementNumber: coverage.endorsementNumber,
    }))).toEqual([
      {
        name: "Technology Professional Liability",
        origin: "core",
        endorsementNumber: undefined,
      },
      {
        name: "Network Security and Privacy Liability",
        origin: "endorsement",
        endorsementNumber: "Endorsement No. 1",
      },
    ]);
  });

  it("collapses duplicate nested endorsement wrappers while preserving child rows", async () => {
    const page = buildPageSourceSpans([{
      documentId: "doc-1",
      pageNumber: 21,
      text: "ENDORSEMENT NO. 2 SOCIAL ENGINEERING FRAUD COVERAGE SPS-END 002 03 25",
    }])[0]!;
    const formNumber = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "SPS-END 002 03 25",
      pageStart: 21,
      pageEnd: 21,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 1);
    const title = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "ENDORSEMENT NO. 2 — SOCIAL ENGINEERING FRAUD COVERAGE",
      pageStart: 21,
      pageEnd: 21,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 2);
    const scheduleRow = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "Coverage: Each Loss Limit | Limit: $250,000",
      pageStart: 21,
      pageEnd: 21,
      sourceUnit: "table_row",
      table: { tableId: "endorsement-2-schedule", rowIndex: 1 },
    }, 3);

    const result = await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans: [page, formNumber, title, scheduleRow],
      formInventory: {
        forms: [{
          formNumber: "SPS-END 002 03 25",
          title: "ENDORSEMENT NO. 2 — SOCIAL ENGINEERING FRAUD COVERAGE",
          formType: "endorsement",
          pageStart: 21,
          pageEnd: 21,
        }],
      },
      generateObject: modelStub(),
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const byId = new Map(result.sourceTree.map((node) => [node.id, node]));
    const duplicateNestedEndorsement = result.sourceTree.find((node) => {
      if (node.kind !== "endorsement" || node.title !== "Endorsement No. 2") return false;
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      return parent?.kind === "endorsement" && parent.title === node.title;
    });
    expect(duplicateNestedEndorsement).toBeUndefined();

    const rowNode = result.sourceTree.find((node) =>
      node.kind === "table_row" && node.sourceSpanIds.includes(scheduleRow.id)
    );
    expect(rowNode).toBeDefined();
    let parentId = rowNode?.parentId;
    let hasEndorsementAncestor = false;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.kind === "endorsement" && parent.title === "Endorsement No. 2") {
        hasEndorsementAncestor = true;
        break;
      }
      parentId = parent.parentId;
    }
    expect(hasEndorsementAncestor).toBe(true);
  });

  it("promotes title elements into cross-page sections inside form groups", async () => {
    const pageSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 10,
        text: "SECTION I - INSURING AGREEMENTS The Company will pay Loss.",
      },
      {
        documentId: "doc-1",
        pageNumber: 11,
        text: "continued covered loss text. SECTION II - EXCLUSIONS The Company will not pay excluded loss.",
      },
    ]);
    const titleOne = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "SECTION I - INSURING AGREEMENTS",
      pageStart: 10,
      pageEnd: 10,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 2);
    const paragraphOne = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "The Company will pay covered Loss under the Insuring Agreements.",
      pageStart: 10,
      pageEnd: 10,
      sourceUnit: "text",
    }, 3);
    const continuation = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "This continuation belongs to Section I even though it starts on the next page.",
      pageStart: 11,
      pageEnd: 11,
      sourceUnit: "text",
    }, 4);
    const titleTwo = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "SECTION II - EXCLUSIONS",
      pageStart: 11,
      pageEnd: 11,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 5);
    const paragraphTwo = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "The Company will not pay excluded Loss.",
      pageStart: 11,
      pageEnd: 11,
      sourceUnit: "text",
    }, 6);

    const result = await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans: [...pageSpans, titleOne, paragraphOne, continuation, titleTwo, paragraphTwo],
      formInventory: {
        forms: [{
          formNumber: "NWC-TEC 04 25",
          title: "TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY",
          formType: "coverage",
          pageStart: 10,
          pageEnd: 11,
        }],
      },
      generateObject: modelStub(),
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const sectionOne = result.sourceTree.find((node) => node.kind === "section" && node.title === "SECTION I - INSURING AGREEMENTS");
    const continuationNode = result.sourceTree.find((node) =>
      node.kind === "text" &&
      node.sourceSpanIds.length === 1 &&
      node.sourceSpanIds.includes(continuation.id)
    );
    const sectionTwo = result.sourceTree.find((node) => node.kind === "section" && node.title === "SECTION II - EXCLUSIONS");

    expect(sectionOne).toEqual(expect.objectContaining({
      pageStart: 10,
      pageEnd: 11,
    }));
    expect(continuationNode?.parentId).toBe(sectionOne?.id);
    expect(sectionTwo).toEqual(expect.objectContaining({
      pageStart: 11,
      pageEnd: 11,
    }));
  });

  it("repairs visually wrapped source-table rows by ID before materializing the source tree", async () => {
    const documentId = "doc-1";
    const tableId = "limits";
    let spanIndex = 0;
    const withBbox = <T extends ReturnType<typeof buildSourceSpan>>(span: T, x: number, y: number, width: number, height: number): T => ({
      ...span,
      bbox: [{ page: 5, x, y, width, height }],
    });
    const rowSpan = (text: string, rowIndex: number, isHeader = false, y = 100) =>
      withBbox(buildSourceSpan({
        documentId,
        sourceKind: "policy_pdf",
        text,
        pageStart: 5,
        pageEnd: 5,
        sourceUnit: "table_row",
        table: { tableId, rowIndex, isHeader },
      }, spanIndex++), 40, y, 500, 18);
    const cellSpan = (
      row: ReturnType<typeof buildSourceSpan>,
      text: string,
      rowIndex: number,
      columnIndex: number,
      columnName: string,
      x: number,
      y: number,
      width = 110,
      metadataColumnName = columnName,
    ) =>
      withBbox(buildSourceSpan({
        documentId,
        sourceKind: "policy_pdf",
        text,
        pageStart: 5,
        pageEnd: 5,
        sourceUnit: "table_cell",
        parentSpanId: row.id,
        table: {
          tableId,
          rowIndex,
          columnIndex,
          columnName,
          rowSpanId: row.id,
          isHeader: row.table?.isHeader,
        },
        metadata: {
          columnName: metadataColumnName,
        },
      }, spanIndex++), x, y, width, 14);

    const page = buildPageSourceSpans([{
      documentId,
      pageNumber: 5,
      text: "SOURCE SCHEDULE Schedule Item Description Amount Effective Date",
    }])[0]!;
    const preHeader = rowSpan("Item 1. Named Insured | Example Labs Inc.", 0, false, 95);
    const header = rowSpan("Schedule Item | Description | Amount | Effective Date", 1, true, 120);
    const rowA = rowSpan("A. Primary Coverage | $2,000,000 Each Claim | $10,000 Each | 01/01/2024", 2, false, 140);
    const rowAPolicyLimit = rowSpan("Column 1: $2,000,000 Policy | Column 2: Claim", 3, false, 154);
    const rowAAggregate = rowSpan("Column 1: Aggregate", 4, false, 168);
    const rowB = rowSpan("B. Secondary Location | Equipment breakdown reimbursement / | $5,000 | 05/01/2025", 5, false, 190);
    const wrapped = rowSpan("including temporary relocation expense | extension", 6, true, 208);
    const rowC = rowSpan("including temporary relocation expense: C. Warehouse Location | extension: Inventory cleanup reimbursement / | Column 3: $3,000 | Column 4: 05/01/2025", 7, false, 235);
    const implicitHeader = rowSpan("aggregate sub-limit, part of | Coverage Part B", 8, true, 255);
    const implicitTail = rowSpan("including scheduled equipment", 9, false, 272);
    const rowD = rowSpan("D. Social Engineering Fraud | $250,000 Each Loss / | $5,000 Each | 05/01/2026", 10, false, 300);

    const sourceSpans = [
      page,
      preHeader,
      cellSpan(preHeader, "Item 1. Named Insured", 0, 0, "Schedule Item", 40, 95, 130, "Column 1"),
      cellSpan(preHeader, "Example Labs Inc. |", 0, 1, "Description", 180, 95, 130, "Column 2"),
      header,
      cellSpan(header, "Schedule Item", 1, 0, "Schedule Item", 40, 120),
      cellSpan(header, "Description", 1, 1, "Description", 180, 120),
      cellSpan(header, "Amount", 1, 2, "Amount", 320, 120),
      cellSpan(header, "Effective Date", 1, 3, "Effective Date", 430, 120),
      rowA,
      cellSpan(rowA, "A. Primary Coverage", 2, 0, "Schedule Item", 40, 140, 130),
      cellSpan(rowA, "$2,000,000 Each Claim", 2, 1, "Description", 180, 140, 130),
      cellSpan(rowA, "$10,000 Each", 2, 2, "Amount", 320, 140),
      cellSpan(rowA, "01/01/2024", 2, 3, "Effective Date", 430, 140),
      rowAPolicyLimit,
      cellSpan(rowAPolicyLimit, "$2,000,000 Policy", 3, 0, "Column 1", 180, 154, 130),
      cellSpan(rowAPolicyLimit, "Claim", 3, 1, "Column 2", 320, 154, 80),
      rowAAggregate,
      cellSpan(rowAAggregate, "Aggregate", 4, 0, "Column 1", 180, 168, 90),
      rowB,
      cellSpan(rowB, "B. Secondary Location", 5, 0, "Schedule Item", 40, 190, 130),
      cellSpan(rowB, "Equipment breakdown reimbursement /", 5, 1, "Description", 180, 190, 130),
      cellSpan(rowB, "$5,000", 5, 2, "Amount", 320, 190),
      cellSpan(rowB, "05/01/2025", 5, 3, "Effective Date", 430, 190),
      wrapped,
      cellSpan(wrapped, "including temporary relocation expense", 6, 0, "Column 1", 180, 208, 240),
      cellSpan(wrapped, "extension", 6, 1, "Column 2", 260, 208, 80),
      rowC,
      cellSpan(rowC, "C. Warehouse Location", 7, 0, "Schedule Item", 40, 235, 130),
      cellSpan(rowC, "Inventory cleanup reimbursement /", 7, 1, "Description", 180, 235, 130),
      cellSpan(rowC, "$5,000 Each", 7, 2, "Amount", 320, 235),
      cellSpan(rowC, "05/01/2025", 7, 3, "Effective Date", 430, 235),
      implicitHeader,
      cellSpan(implicitHeader, "aggregate sub-limit, part of", 8, 0, "aggregate sub-limit, part of", 180, 255, 170),
      cellSpan(implicitHeader, "Coverage Part B", 8, 1, "Coverage Part B", 250, 255, 60),
      implicitTail,
      cellSpan(implicitTail, "including scheduled equipment", 9, 0, "Column 1", 180, 272, 210),
      rowD,
      cellSpan(rowD, "D. Social Engineering Fraud", 10, 0, "Schedule Item", 40, 300, 130),
      cellSpan(rowD, "$250,000 Each Loss /", 10, 1, "Description", 180, 300, 130),
      cellSpan(rowD, "$5,000 Each", 10, 2, "Amount", 320, 300),
      cellSpan(rowD, "05/01/2026", 10, 3, "Effective Date", 430, 300),
    ];

    const generateObjectMock = vi.fn(async (params) => {
      if (params.prompt.includes("Compare a parsed insurance source table")) {
        const payloadText = params.prompt
          .split("Parsed table with visual coordinates:\n")[1]
          ?.split("\n\nReturn JSON")[0] ?? "{}";
        const table = JSON.parse(payloadText) as {
          tableNodeId: string;
          rows: Array<{ rowNodeId: string; text: string }>;
        };
        const wrappedRow = table.rows.find((row) => row.text.includes("temporary relocation"))!;
        const targetRow = table.rows.find((row) => row.text.includes("Secondary Location"))!;
        return {
          object: {
            tables: [{
              tableNodeId: table.tableNodeId,
              columnLabels: [
                { columnIndex: 0, label: "Schedule Item" },
                { columnIndex: 1, label: "Description" },
                { columnIndex: 2, label: "Amount" },
                { columnIndex: 3, label: "Effective Date" },
              ],
              continuationRows: [{
                sourceRowNodeId: wrappedRow.rowNodeId,
                targetRowNodeId: targetRow.rowNodeId,
                targetColumnIndex: 1,
                targetColumnLabel: "Description",
                reason: "The row is visually wrapped inside the prior description cell.",
              }],
            }],
            warnings: [],
          },
        };
      }
      if (params.taskKind === "extraction_operational_profile") {
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
            coverageTypes: ["cyber"],
          },
        };
      }
      return { object: { labels: [], groups: [] } };
    });
    const generateObject = generateObjectMock as GenerateObject;

    const result = await runSourceTreeExtraction({
      id: documentId,
      sourceSpans,
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const visualCall = generateObjectMock.mock.calls
      .map(([params]) => params)
      .find((params) => params.prompt.includes("Compare a parsed insurance source table"));
    expect(visualCall).toEqual(expect.objectContaining({
      taskKind: "extraction_visual_table_repair",
      trace: expect.objectContaining({ startPage: 5, endPage: 5 }),
    }));
    expect(visualCall).not.toHaveProperty("providerOptions");

    const preHeaderRow = result.sourceTree.find((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(preHeader.id)
    );
    const preHeaderTitles = result.sourceTree
      .filter((node) => node.kind === "table_cell" && node.parentId === preHeaderRow?.id)
      .map((node) => node.title);
    expect(preHeaderTitles).toEqual(["Column 1", "Column 2"]);
    const preHeaderMetadata = result.sourceTree
      .filter((node) => node.kind === "table_cell" && node.parentId === preHeaderRow?.id)
      .map((node) => node.metadata?.columnName);
    expect(preHeaderMetadata).toEqual(["Column 1", "Column 2"]);
    expect(preHeaderRow?.textExcerpt).toContain("Column 2: Example Labs Inc.");
    expect(preHeaderRow?.textExcerpt).not.toContain("Example Labs Inc. | |");

    const rowANode = result.sourceTree.find((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(rowA.id)
    );
    const rowACells = result.sourceTree
      .filter((node) => node.kind === "table_cell" && node.parentId === rowANode?.id);
    const rowALimit = rowACells.find((node) => node.title === "Description");
    const rowAAmount = rowACells.find((node) => node.title === "Amount");
    expect(rowALimit?.textExcerpt).toContain("$2,000,000 Each Claim / $2,000,000 Policy Aggregate");
    expect(rowAAmount?.textExcerpt).toBe("$10,000 Each Claim");
    expect(rowANode?.textExcerpt).toContain("Description: $2,000,000 Each Claim / $2,000,000 Policy Aggregate");
    expect(rowANode?.textExcerpt).toContain("Amount: $10,000 Each Claim");
    expect(rowANode?.textExcerpt).not.toContain("Description: $2,000,000 Each Claim / $2,000,000 Policy / Claim");
    expect(result.sourceTree.some((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(rowAPolicyLimit.id) &&
      !node.sourceSpanIds.includes(rowA.id)
    )).toBe(false);
    expect(result.sourceTree.some((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(rowAAggregate.id) &&
      !node.sourceSpanIds.includes(rowA.id)
    )).toBe(false);

    expect(result.sourceTree.some((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(wrapped.id) &&
      !node.sourceSpanIds.includes(rowB.id)
    )).toBe(false);

    const repairedRow = result.sourceTree.find((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(rowB.id)
    );
    expect(repairedRow?.sourceSpanIds).toContain(wrapped.id);
    const repairedLimitCell = result.sourceTree.find((node) =>
      node.kind === "table_cell" &&
      node.parentId === repairedRow?.id &&
      node.title === "Description"
    );
    expect(repairedLimitCell?.textExcerpt).toContain("temporary relocation");
    expect(repairedLimitCell?.sourceSpanIds).toContain(wrapped.id);
    expect(repairedLimitCell?.metadata?.columnName).toBe("Description");
    expect(repairedRow?.textExcerpt).toContain("Description: Equipment breakdown reimbursement");
    expect(repairedRow?.textExcerpt).not.toContain("Column 1:");

    const rowCNode = result.sourceTree.find((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(rowC.id)
    );
    const rowCCells = result.sourceTree
      .filter((node) => node.kind === "table_cell" && node.parentId === rowCNode?.id);
    const rowCTitles = rowCCells.map((node) => node.title);
    expect(rowCTitles).toEqual([
      "Schedule Item",
      "Description",
      "Amount",
      "Effective Date",
    ]);
    expect(rowCCells.map((node) => node.metadata?.columnName)).toEqual([
      "Schedule Item",
      "Description",
      "Amount",
      "Effective Date",
    ]);
    expect(rowCNode?.textExcerpt).toContain("Schedule Item: C. Warehouse Location");
    expect(rowCNode?.textExcerpt).toContain("aggregate sub-limit, part of Coverage Part B");
    expect(rowCNode?.textExcerpt).toContain("including scheduled equipment");
    expect(rowCNode?.textExcerpt).not.toContain("part of / Coverage Part B");
    expect(rowCNode?.textExcerpt).not.toContain("including temporary relocation expense:");
    expect(result.sourceTree.some((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(implicitHeader.id) &&
      !node.sourceSpanIds.includes(rowC.id)
    )).toBe(false);
    expect(result.sourceTree.some((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(implicitTail.id) &&
      !node.sourceSpanIds.includes(rowC.id)
    )).toBe(false);

    const rowDNode = result.sourceTree.find((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(rowD.id)
    );
    const rowDLimit = result.sourceTree.find((node) =>
      node.kind === "table_cell" &&
      node.parentId === rowDNode?.id &&
      node.title === "Description"
    );
    expect(rowDLimit?.textExcerpt).toBe("$250,000 Each Loss");
    expect(rowDNode?.textExcerpt).toContain("Description: $250,000 Each Loss");
    expect(rowDNode?.textExcerpt).not.toContain("$250,000 Each Loss / |");
  });

  it("does not merge policy prose into visual schedule date cells", async () => {
    const documentId = "doc-1";
    const tableId = "endorsement-schedule";
    let spanIndex = 0;
    const withBbox = <T extends ReturnType<typeof buildSourceSpan>>(span: T, x: number, y: number, width: number, height: number): T => ({
      ...span,
      bbox: [{ page: 21, x, y, width, height }],
    });
    const rowSpan = (text: string, rowIndex: number, isHeader = false, y = 100) =>
      withBbox(buildSourceSpan({
        documentId,
        sourceKind: "policy_pdf",
        text,
        pageStart: 21,
        pageEnd: 21,
        sourceUnit: "table_row",
        table: { tableId, rowIndex, isHeader },
      }, spanIndex++), 40, y, 500, 18);
    const cellSpan = (
      row: ReturnType<typeof buildSourceSpan>,
      text: string,
      rowIndex: number,
      columnIndex: number,
      columnName: string,
      x: number,
      y: number,
      width = 160,
    ) =>
      withBbox(buildSourceSpan({
        documentId,
        sourceKind: "policy_pdf",
        text,
        pageStart: 21,
        pageEnd: 21,
        sourceUnit: "table_cell",
        parentSpanId: row.id,
        table: {
          tableId,
          rowIndex,
          columnIndex,
          columnName,
          rowSpanId: row.id,
          isHeader: row.table?.isHeader,
        },
        metadata: { columnName },
      }, spanIndex++), x, y, width, 14);

    const page = buildPageSourceSpans([{
      documentId,
      pageNumber: 21,
      text: "ENDORSEMENT NO. 2 SOCIAL ENGINEERING FRAUD COVERAGE",
    }])[0]!;
    const header = rowSpan("Coverage | Limit", 0, true, 100);
    const retro = rowSpan("Retroactive Date | 05/01/2026", 1, false, 120);
    const prose = rowSpan("CLAIM EXPENSES, AS WELL AS DAMAGES AND DIRECT FINANCIAL LOSS, ARE INCLUDED WITHIN AND WILL REDUCE THE LIMITS SHOWN ABOVE.", 2, false, 140);
    const sourceSpans = [
      page,
      header,
      cellSpan(header, "Coverage", 0, 0, "Coverage", 40, 100),
      cellSpan(header, "Limit", 0, 1, "Limit", 260, 100),
      retro,
      cellSpan(retro, "Retroactive Date", 1, 0, "Coverage", 40, 120),
      cellSpan(retro, "05/01/2026", 1, 1, "Limit", 260, 120),
      prose,
      cellSpan(prose, "CLAIM EXPENSES, AS WELL AS DAMAGES AND DIRECT FINANCIAL LOSS, ARE INCLUDED WITHIN AND WILL REDUCE THE LIMITS SHOWN ABOVE.", 2, 0, "Column 1", 40, 140, 460),
    ];
    const generateObject = vi.fn(async (params) => {
      if (params.prompt.includes("Compare a parsed insurance source table")) {
        const payloadText = params.prompt
          .split("Parsed table with visual coordinates:\n")[1]
          ?.split("\n\nReturn JSON")[0] ?? "{}";
        const table = JSON.parse(payloadText) as {
          tableNodeId: string;
          rows: Array<{ rowNodeId: string; text: string }>;
        };
        const proseRow = table.rows.find((row) => row.text.includes("CLAIM EXPENSES"))!;
        const retroRow = table.rows.find((row) => row.text.includes("Retroactive Date"))!;
        return {
          object: {
            tables: [{
              tableNodeId: table.tableNodeId,
              columnLabels: [
                { columnIndex: 0, label: "Coverage" },
                { columnIndex: 1, label: "Retroactive Date" },
              ],
              continuationRows: [{
                sourceRowNodeId: proseRow.rowNodeId,
                targetRowNodeId: retroRow.rowNodeId,
                targetColumnIndex: 1,
                targetColumnLabel: "Retroactive Date",
                reason: "The model incorrectly thinks this paragraph continues the date cell.",
              }],
            }],
            warnings: [],
          },
        };
      }
      if (params.taskKind === "extraction_operational_profile") {
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
            coverageTypes: ["cyber"],
          },
        };
      }
      return { object: { labels: [], groups: [] } };
    }) as GenerateObject;

    const result = await runSourceTreeExtraction({
      id: documentId,
      sourceSpans,
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const retroRow = result.sourceTree.find((node) =>
      node.kind === "table_row" && node.sourceSpanIds.includes(retro.id)
    );
    const retroDateCell = result.sourceTree.find((node) =>
      node.kind === "table_cell" &&
      node.parentId === retroRow?.id &&
      node.title === "Retroactive Date"
    );
    const proseRow = result.sourceTree.find((node) =>
      node.kind === "table_row" &&
      node.sourceSpanIds.includes(prose.id) &&
      !node.sourceSpanIds.includes(retro.id)
    );

    expect(retroDateCell?.textExcerpt).toBe("05/01/2026");
    expect(retroRow?.textExcerpt).not.toContain("CLAIM EXPENSES");
    expect(proseRow).toBeDefined();
  });

  it("runs a model cleanup pass over malformed operational profile projections", async () => {
    const evidence = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "Evidence packet row A $25,000 shown in Item 7.",
      pageStart: 3,
      pageEnd: 3,
      sourceUnit: "text",
    });
    let cleanupPromptSeen = false;
    const generateObject = vi.fn(async (params) => {
      if (params.prompt.includes("Review and clean a source-backed operational profile projection")) {
        cleanupPromptSeen = true;
        return {
          object: {
            coverageDecisions: [{
              coverageIndex: 0,
              action: "update",
              reason: "The schedule heading is not the coverage name and the item reference is not an amount.",
              name: "Cyber Liability",
              limit: null,
              deductible: null,
              premium: null,
              retroactiveDate: null,
              coverageOrigin: null,
              sourceNodeIds: [],
              sourceSpanIds: ["not-a-real-span"],
              termDecisions: [
                {
                  termIndex: 0,
                  action: "update",
                  reason: "The value is a deductible, not a generic column value.",
                  kind: "deductible",
                  label: "Deductible",
                  value: "$25,000",
                  amount: 25000,
                  appliesTo: null,
                  sourceNodeIds: [],
                  sourceSpanIds: ["also-not-real"],
                },
                {
                  termIndex: 1,
                  action: "drop",
                  reason: "The item reference is not a source-backed amount.",
                  kind: null,
                  label: null,
                  value: null,
                  amount: null,
                  appliesTo: null,
                  sourceNodeIds: [],
                  sourceSpanIds: [],
                },
              ],
            }],
            warnings: ["cleaned malformed coverage projection"],
          },
        };
      }
      if (params.taskKind === "extraction_operational_profile") {
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
            coverageTypes: ["Limits of Liability"],
            insurer: {
              value: "Northwoods Continental Insurance Company",
              sourceNodeIds: [],
              sourceSpanIds: [evidence.id],
            },
            broker: {
              value: "Halverson Risk Advisors, LLC",
              sourceNodeIds: [],
              sourceSpanIds: [evidence.id],
            },
            coverages: [{
              name: "Limits of Liability",
              limit: "$25,000 /",
              coverageOrigin: "core",
              limits: [
                {
                  kind: "other",
                  label: "Column 3",
                  value: "$25,000 /",
                  amount: 25000,
                  sourceNodeIds: [],
                  sourceSpanIds: [evidence.id],
                },
                {
                  kind: "other",
                  label: "Limit Reference",
                  value: "shown in Item 7)",
                  amount: 7,
                  sourceNodeIds: [],
                  sourceSpanIds: [evidence.id],
                },
              ],
              sourceNodeIds: [],
              sourceSpanIds: [evidence.id],
            }],
          },
        };
      }
      return { object: { labels: [], groups: [] } };
    }) as GenerateObject;

    const result = await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans: [evidence],
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    expect(cleanupPromptSeen).toBe(true);
    expect(result.operationalProfile.coverages).toHaveLength(1);
    expect(result.operationalProfile.coverages[0]).toEqual(expect.objectContaining({
      name: "Cyber Liability",
      deductible: "$25,000",
    }));
    expect(result.operationalProfile.coverages[0].limit).toBeUndefined();
    expect(result.operationalProfile.coverages[0].limits).toEqual([
      expect.objectContaining({
        kind: "deductible",
        label: "Deductible",
        value: "$25,000",
        amount: 25000,
        sourceSpanIds: [evidence.id],
      }),
    ]);
    expect(result.operationalProfile.sourceSpanIds).toEqual([evidence.id]);
    expect(result.operationalProfile.warnings).toContain("Operational profile cleanup warning: cleaned malformed coverage projection");
    expect(InsurerInfoSchema.parse(result.document.insurer)).toEqual({
      legalName: "Northwoods Continental Insurance Company",
      sourceSpanIds: [evidence.id],
    });
    expect(ProducerInfoSchema.parse(result.document.producer)).toEqual({
      agencyName: "Halverson Risk Advisors, LLC",
      sourceSpanIds: [evidence.id],
    });
  });

  it("bounds operational profile cleanup evidence around coverage-backed source nodes", () => {
    const sourceTree: DocumentSourceNode[] = Array.from({ length: 340 }, (_, index) => ({
      id: `front-${index}`,
      documentId: "doc-1",
      kind: "text",
      title: "Front matter",
      description: `Generic notice text ${index}`,
      textExcerpt: `Generic notice text ${index}`,
      sourceSpanIds: [`front-span-${index}`],
      pageStart: 1,
      pageEnd: 1,
      order: index,
      path: `1.${index}`,
    }));
    sourceTree.push(
      {
        id: "coverage-table",
        documentId: "doc-1",
        kind: "table",
        title: "Coverage Parts, Limits of Liability, Deductibles, and Retroactive Dates",
        description: "",
        textExcerpt: "",
        sourceSpanIds: ["table-span"],
        pageStart: 5,
        pageEnd: 5,
        order: 340,
        path: "5.1",
      },
      {
        id: "coverage-row-a",
        documentId: "doc-1",
        parentId: "coverage-table",
        kind: "table_row",
        title: "A. Technology Professional Liability",
        description: "",
        textExcerpt: "A. Technology Professional Liability $2,000,000 Each Claim / $2,000,000 Policy Aggregate $10,000 Each Claim 01/01/2024",
        sourceSpanIds: ["coverage-span-a"],
        pageStart: 5,
        pageEnd: 5,
        order: 341,
        path: "5.1.1",
      },
      {
        id: "endorsement-row-1",
        documentId: "doc-1",
        kind: "table_row",
        title: "Endorsement No. 1 — Network Security and Privacy Liability",
        description: "",
        textExcerpt: "Network Security and Privacy Liability Each Claim Limit $1,000,000 Aggregate Sub-Limit $1,000,000 Deductible Each Claim $5,000 Retroactive Date 05/01/2025",
        sourceSpanIds: ["endorsement-span-1"],
        pageStart: 19,
        pageEnd: 19,
        order: 500,
        path: "19.1",
      },
    );

    const profile: PolicyOperationalProfile = {
      documentType: "policy",
      policyTypes: ["cyber"],
      coverageTypes: ["Technology Professional Liability"],
      coverages: [{
        name: "Technology Professional Liability",
        coverageCode: "A",
        limit: "$2,000,000 Each Claim / $2,000,000 Policy Aggregate",
        deductible: "$10,000 Each Claim",
        retroactiveDate: "01/01/2024",
        sourceNodeIds: ["coverage-row-a"],
        sourceSpanIds: ["coverage-span-a"],
        limits: [{
          kind: "each_claim_limit",
          label: "Each Claim Limit",
          value: "$2,000,000",
          amount: 2000000,
          appliesTo: "Technology Professional Liability",
          sourceNodeIds: ["coverage-row-a"],
          sourceSpanIds: ["coverage-span-a"],
        }],
      }, {
        name: "Network Security and Privacy Liability",
        coverageCode: "B",
        limit: "$1,000,000 Each Claim",
        deductible: "$5,000 Each Claim",
        retroactiveDate: "05/01/2025",
        coverageOrigin: "endorsement",
        endorsementNumber: "Endorsement No. 1",
        sourceNodeIds: ["endorsement-row-1"],
        sourceSpanIds: ["endorsement-span-1"],
        limits: [{
          kind: "each_claim_limit",
          label: "Each Claim Limit",
          value: "$1,000,000",
          amount: 1000000,
          appliesTo: "Network Security and Privacy Liability",
          sourceNodeIds: ["endorsement-row-1"],
          sourceSpanIds: ["endorsement-span-1"],
        }],
      }],
      parties: [],
      endorsementSupport: [],
      warnings: [],
      sourceNodeIds: ["coverage-row-a"],
      sourceSpanIds: ["coverage-span-a"],
    };
    const prompt = buildOperationalProfileCleanupPrompt(sourceTree, profile);

    expect(prompt).toContain("coverage-row-a");
    expect(prompt).toContain("Technology Professional Liability");
    expect(prompt).not.toContain("front-250");
    expect(prompt.length).toBeLessThan(25000);

    const endorsementPrompt = buildOperationalProfileCleanupPrompt(sourceTree, profile, {
      coverageIndexes: [1],
      label: "Coverage schedule cleanup: endorsement schedules",
    });
    expect(endorsementPrompt).toContain("Coverage schedule cleanup: endorsement schedules");
    expect(endorsementPrompt).toContain('"coverageIndex": 1');
    expect(endorsementPrompt).toContain("Network Security and Privacy Liability");
    expect(endorsementPrompt).not.toContain('"coverageIndex": 0');
    expect(endorsementPrompt).not.toContain("coverage-row-a");
  });
});
