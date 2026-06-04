import { describe, expect, it } from "vitest";
import {
  buildDeterministicOperationalProfile,
  buildDocumentSourceTree,
  buildSourceSpan,
  mergeOperationalProfile,
  normalizeDocumentSourceTreePaths,
  normalizeSourceSpans,
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
      limits: expect.arrayContaining([
        expect.objectContaining({ label: "Limit", value: "$1,000,000" }),
        expect.objectContaining({ label: "Deductible", value: "$10,000" }),
      ]),
      premium: "$2,500",
      sourceSpanIds: [row.id],
    }));
  });

  it("keeps multi-limit endorsement schedules as one coverage unit", () => {
    const documentId = "policy-1";
    const sourceTree = normalizeDocumentSourceTreePaths([
      {
        id: documentId,
        documentId,
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "endorsement-1",
        documentId,
        parentId: documentId,
        kind: "endorsement",
        title: "Endorsement No. 1 - Network Security and Privacy Liability Coverage",
        description: "Endorsement",
        sourceSpanIds: ["s-endorsement"],
        pageStart: 21,
        pageEnd: 22,
        order: 1,
        path: "",
      },
      {
        id: "table-1",
        documentId,
        parentId: "endorsement-1",
        kind: "table",
        title: "Schedule",
        description: "Schedule",
        sourceSpanIds: ["s-table"],
        pageStart: 21,
        pageEnd: 21,
        order: 2,
        path: "",
      },
      {
        id: "row-1",
        documentId,
        parentId: "table-1",
        kind: "table_row",
        title: "Row 1",
        description: "Each Claim Limit | $3,000,000",
        textExcerpt: "Each Claim Limit | $3,000,000",
        sourceSpanIds: ["s-row-1"],
        pageStart: 21,
        pageEnd: 21,
        order: 3,
        path: "",
      },
      {
        id: "cell-1a",
        documentId,
        parentId: "row-1",
        kind: "table_cell",
        title: "Each Claim Limit",
        description: "$3,000,000",
        textExcerpt: "$3,000,000",
        sourceSpanIds: ["s-cell-1a"],
        pageStart: 21,
        pageEnd: 21,
        order: 4,
        path: "",
      },
      {
        id: "row-2",
        documentId,
        parentId: "table-1",
        kind: "table_row",
        title: "Row 2",
        description: "Aggregate Limit | $3,000,000",
        textExcerpt: "Aggregate Limit | $3,000,000",
        sourceSpanIds: ["s-row-2"],
        pageStart: 21,
        pageEnd: 21,
        order: 5,
        path: "",
      },
      {
        id: "cell-2a",
        documentId,
        parentId: "row-2",
        kind: "table_cell",
        title: "Aggregate Limit",
        description: "$3,000,000",
        textExcerpt: "$3,000,000",
        sourceSpanIds: ["s-cell-2a"],
        pageStart: 21,
        pageEnd: 21,
        order: 6,
        path: "",
      },
      {
        id: "row-3",
        documentId,
        parentId: "table-1",
        kind: "table_row",
        title: "Row 3",
        description: "Retroactive Date | 06/15/2023",
        textExcerpt: "Retroactive Date | 06/15/2023",
        sourceSpanIds: ["s-row-3"],
        pageStart: 21,
        pageEnd: 21,
        order: 7,
        path: "",
      },
      {
        id: "cell-3a",
        documentId,
        parentId: "row-3",
        kind: "table_cell",
        title: "Retroactive Date",
        description: "06/15/2023",
        textExcerpt: "06/15/2023",
        sourceSpanIds: ["s-cell-3a"],
        pageStart: 21,
        pageEnd: 21,
        order: 8,
        path: "",
      },
    ]);

    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [] });

    expect(profile.coverages).toHaveLength(1);
    expect(profile.coverages[0]).toEqual(expect.objectContaining({
      name: "Endorsement No. 1 - Network Security and Privacy Liability Coverage",
      coverageOrigin: "endorsement",
      endorsementNumber: "1",
      limit: "$3,000,000",
      retroactiveDate: "06/15/2023",
      limits: expect.arrayContaining([
        expect.objectContaining({ kind: "each_claim_limit", label: "Each Claim Limit", value: "$3,000,000" }),
        expect.objectContaining({ kind: "aggregate_limit", label: "Aggregate Limit", value: "$3,000,000" }),
        expect.objectContaining({ kind: "retroactive_date", label: "Retroactive Date", value: "06/15/2023" }),
      ]),
    }));
  });

  it("extracts endorsement coverage from the leaf schedule instead of duplicate ancestor groups", () => {
    const documentId = "policy-1";
    const sourceTree = normalizeDocumentSourceTreePaths([
      {
        id: documentId,
        documentId,
        kind: "document",
        title: "Policy",
        description: "Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "endorsement-group",
        documentId,
        parentId: documentId,
        kind: "endorsement",
        title: "Endorsement No. 1",
        description: "Endorsement group",
        textExcerpt: "ENDORSEMENT NO. 1 — NETWORK SECURITY AND PRIVACY LIABILITY",
        sourceSpanIds: ["s-group"],
        pageStart: 21,
        pageEnd: 33,
        order: 1,
        path: "",
      },
      {
        id: "endorsement-page-1",
        documentId,
        parentId: "endorsement-group",
        kind: "endorsement",
        title: "Endorsement No. 1",
        description: "Endorsement page",
        textExcerpt: "ENDORSEMENT NO. 1 — NETWORK SECURITY AND PRIVACY LIABILITY",
        sourceSpanIds: ["s-page"],
        pageStart: 21,
        pageEnd: 21,
        order: 2,
        path: "",
      },
      {
        id: "endorsement-title-1",
        documentId,
        parentId: "endorsement-page-1",
        kind: "endorsement",
        title: "Endorsement No. 1",
        description: "Endorsement title",
        textExcerpt: "ENDORSEMENT NO. 1 — NETWORK SECURITY AND PRIVACY LIABILITY This endorsement modifies insurance provided under the Technology Errors & Omissions and Cyber Liability Insurance Policy.",
        sourceSpanIds: ["s-title"],
        pageStart: 21,
        pageEnd: 21,
        order: 3,
        path: "",
      },
      {
        id: "table-1",
        documentId,
        parentId: "endorsement-title-1",
        kind: "table",
        title: "Schedule",
        description: "Schedule",
        sourceSpanIds: ["s-table"],
        pageStart: 21,
        pageEnd: 21,
        order: 4,
        path: "",
      },
      {
        id: "row-1",
        documentId,
        parentId: "table-1",
        kind: "table_row",
        title: "Row 1",
        description: "Column 1: Each Claim Limit | Column 2: $3,000,000",
        textExcerpt: "Column 1: Each Claim Limit | Column 2: $3,000,000",
        sourceSpanIds: ["s-row-1"],
        pageStart: 21,
        pageEnd: 21,
        order: 5,
        path: "",
      },
      {
        id: "cell-1a",
        documentId,
        parentId: "row-1",
        kind: "table_cell",
        title: "Column 1",
        description: "Each Claim Limit",
        textExcerpt: "Each Claim Limit",
        sourceSpanIds: ["s-cell-1a"],
        pageStart: 21,
        pageEnd: 21,
        order: 6,
        path: "",
      },
      {
        id: "cell-1b",
        documentId,
        parentId: "row-1",
        kind: "table_cell",
        title: "Column 2",
        description: "$3,000,000",
        textExcerpt: "$3,000,000",
        sourceSpanIds: ["s-cell-1b"],
        pageStart: 21,
        pageEnd: 21,
        order: 7,
        path: "",
      },
      {
        id: "row-2",
        documentId,
        parentId: "table-1",
        kind: "table_row",
        title: "Row 2",
        description: "Column 1: SIR Each Claim | Column 2: $25,000",
        textExcerpt: "Column 1: SIR Each Claim | Column 2: $25,000",
        sourceSpanIds: ["s-row-2"],
        pageStart: 21,
        pageEnd: 21,
        order: 8,
        path: "",
      },
      {
        id: "cell-2a",
        documentId,
        parentId: "row-2",
        kind: "table_cell",
        title: "Column 1",
        description: "SIR Each Claim",
        textExcerpt: "SIR Each Claim",
        sourceSpanIds: ["s-cell-2a"],
        pageStart: 21,
        pageEnd: 21,
        order: 9,
        path: "",
      },
      {
        id: "cell-2b",
        documentId,
        parentId: "row-2",
        kind: "table_cell",
        title: "Column 2",
        description: "$25,000",
        textExcerpt: "$25,000",
        sourceSpanIds: ["s-cell-2b"],
        pageStart: 21,
        pageEnd: 21,
        order: 10,
        path: "",
      },
    ]);

    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [] });

    expect(profile.coverages).toHaveLength(1);
    expect(profile.coverages[0]).toEqual(expect.objectContaining({
      name: "Endorsement No. 1 - NETWORK SECURITY AND PRIVACY LIABILITY",
      coverageOrigin: "endorsement",
      endorsementNumber: "1",
      limit: "$3,000,000",
      deductible: "$25,000",
      limits: expect.arrayContaining([
        expect.objectContaining({ kind: "each_claim_limit", label: "Each Claim Limit", value: "$3,000,000" }),
        expect.objectContaining({ kind: "retention", label: "SIR Each Claim", value: "$25,000" }),
      ]),
    }));
  });

  it("does not let model-generated coverages replace deterministic schedule coverages", () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Coverage: Cyber Liability | Each Claim Limit: $3,000,000 | Aggregate Limit: $3,000,000",
      pageStart: 7,
      pageEnd: 7,
      sourceUnit: "table_row",
      table: { tableId: "limits", rowIndex: 1 },
    });
    const sourceTree = buildDocumentSourceTree([row], "policy-1");
    const base = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [row] });
    const merged = mergeOperationalProfile(
      base,
      {
        coverages: [{
          name: "Each Claim Limit",
          limit: "$3,000,000",
          coverageOrigin: "endorsement",
          sourceNodeIds: base.coverages[0].sourceNodeIds,
          sourceSpanIds: base.coverages[0].sourceSpanIds,
          limits: [{
            kind: "other",
            label: "Column 2",
            value: "$3,000,000",
            sourceNodeIds: base.coverages[0].sourceNodeIds,
            sourceSpanIds: base.coverages[0].sourceSpanIds,
          }],
        }],
      },
      new Set(sourceTree.map((node) => node.id)),
      new Set([row.id]),
    );

    expect(merged.coverages).toHaveLength(base.coverages.length);
    expect(merged.coverages[0].name).toBe("Cyber Liability");
    expect(merged.coverages[0].limits).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Each Claim Limit", value: "$3,000,000" }),
      expect.objectContaining({ label: "Aggregate Limit", value: "$3,000,000" }),
    ]));
  });

  it("does not treat form inventory, premium, or ERP option rows as coverage lines", () => {
    const rows = [
      "Column 1: NWC-END 001 04 25 | Column 2: Endt. No. 1 — Network Security and Privacy Liability Coverage",
      "Column 1: Annual Policy Premium | Column 2: $48,200",
      "Option: ERP Option A | Length: 12 Months | Additional Premium (% of expiring annual premium): 85%",
      "Column 1: Item 8. Defense Expenses | Column 2: OUTSIDE THE LIMITS OF LIABILITY (Supplementary) Subject to a separate Supplementary Defense Annual Cap of $5,000,000 in the aggregate for all Coverage Parts combined. Defense Expenses incurred in excess of the Supplementary Defense Annual Cap shall erode the applicable Aggregate Limit of the implicated Coverage Part(s)",
      "Coverage Part: A. Technology Errors & Omissions Liability | Each Claim Limit: $5,000,000 | Aggregate Limit: $10,000,000 | Retroactive Date: 06/15/2023",
    ].map((text, index) => buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text,
      pageStart: 7,
      pageEnd: 7,
      sourceUnit: "table_row",
      table: { tableId: "limits", rowIndex: index },
    }, index));
    const sourceTree = buildDocumentSourceTree(rows, "policy-1");
    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: rows });

    expect(profile.coverages.map((coverage) => coverage.name)).toEqual([
      "Coverage Part A. Technology Errors & Omissions Liability",
    ]);
  });

  it("uses visual title spans to split page content", () => {
    const title = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "DEFENSE AND FINES SUB-COVERAGES",
      pageStart: 23,
      pageEnd: 23,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 0);
    const paragraph = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "The Company will reimburse the Named Insured for covered defense expenses.",
      pageStart: 23,
      pageEnd: 23,
      sourceUnit: "text",
    }, 1);
    const emptyTitle = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "NORTHWOODS CONTINENTAL INSURANCE COMPANY",
      pageStart: 23,
      pageEnd: 23,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 2);

    const tree = buildDocumentSourceTree([title, paragraph, emptyTitle], "policy-1");
    const titleNode = tree.find((node) => node.metadata?.organizer === "title_block" && node.sourceSpanIds.includes(title.id));
    const paragraphNode = tree.find((node) => node.kind === "text" && node.sourceSpanIds.length === 1 && node.sourceSpanIds.includes(paragraph.id));
    const emptyTitleNode = tree.find((node) => node.kind === "text" && node.sourceSpanIds.length === 1 && node.sourceSpanIds.includes(emptyTitle.id));

    expect(titleNode).toEqual(expect.objectContaining({
      kind: "text",
      title: "DEFENSE AND FINES SUB-COVERAGES",
    }));
    expect(paragraphNode?.parentId).toBe(titleNode?.id);
    expect(emptyTitleNode).toEqual(expect.objectContaining({ kind: "text" }));
  });

  it("does not turn sentence-like title elements into section containers", () => {
    const proseTitle = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "PLEASE READ THIS ENTIRE POLICY CAREFULLY. WORDS AND PHRASES IN BOLD HAVE SPECIAL MEANING.",
      pageStart: 15,
      pageEnd: 15,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 0);
    const paragraph = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "The Company has no obligation to pay covered Loss unless the retention is satisfied.",
      pageStart: 15,
      pageEnd: 15,
      sourceUnit: "text",
    }, 1);
    const sentenceSection = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Section V.D below with respect to the Supplementary Defense Annual Cap.",
      pageStart: 15,
      pageEnd: 15,
      sourceUnit: "text",
      metadata: { sourceUnit: "title", elementType: "title" },
    }, 2);

    const tree = buildDocumentSourceTree([proseTitle, paragraph, sentenceSection], "policy-1");
    const proseNode = tree.find((node) => node.sourceSpanIds.length === 1 && node.sourceSpanIds.includes(proseTitle.id));
    const paragraphNode = tree.find((node) => node.sourceSpanIds.length === 1 && node.sourceSpanIds.includes(paragraph.id));
    const sentenceSectionNode = tree.find((node) => node.sourceSpanIds.length === 1 && node.sourceSpanIds.includes(sentenceSection.id));

    expect(proseNode).toEqual(expect.objectContaining({
      kind: "text",
      title: "Text",
    }));
    expect(proseNode?.metadata?.organizer).toBeUndefined();
    expect(paragraphNode?.parentId).not.toBe(proseNode?.id);
    expect(sentenceSectionNode?.metadata?.organizer).toBeUndefined();
  });

  it("normalizes boilerplate source spans and merges torn sentence rows", () => {
    const warning = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "SPECIMEN POLICY — FOR TESTING ONLY",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "text",
    }, 0);
    const formFooter = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Column 1: NWC-TES 09 17 | Column 2: Page 35 of 35",
      pageStart: 35,
      pageEnd: 35,
      sourceUnit: "table_row",
    }, 1);
    const firstLine = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "This Policy is a CLAIMS-MADE AND REPORTED policy. As a condition of",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "text",
    }, 2);
    const secondLine = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "coverage, you must report any Claim.",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "text",
    }, 3);

    const normalized = normalizeSourceSpans([warning, formFooter, firstLine, secondLine]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].text).toBe("This Policy is a CLAIMS-MADE AND REPORTED policy. As a condition of coverage, you must report any Claim.");
    expect(normalized[0].metadata?.mergedSourceSpanIds).toContain(firstLine.id);
    expect(normalized[0].metadata?.mergedSourceSpanIds).toContain(secondLine.id);
  });

  it("normalizes cyclic source-node parent references without recursive blow-up", () => {
    const nodes = [
      {
        id: "a",
        documentId: "policy-1",
        parentId: "b",
        kind: "page" as const,
        title: "Page A",
        description: "Cycle A",
        sourceSpanIds: [],
        order: 1,
        path: "",
      },
      {
        id: "b",
        documentId: "policy-1",
        parentId: "a",
        kind: "page" as const,
        title: "Page B",
        description: "Cycle B",
        sourceSpanIds: [],
        order: 2,
        path: "",
      },
    ];

    const normalized = normalizeDocumentSourceTreePaths(nodes);

    expect(normalized).toHaveLength(2);
    expect(new Set(normalized.map((node) => node.id))).toEqual(new Set(["a", "b"]));
    expect(normalized[0].parentId).toBeUndefined();
    expect(normalized.map((node) => node.path)).toEqual(["1", "1.1"]);
  });
});
