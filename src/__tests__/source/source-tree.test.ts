import { describe, expect, it } from "vitest";
import {
  buildDeterministicOperationalProfile,
  buildDocumentSourceTree,
  buildSourceSpan,
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
      premium: "$2,500",
      sourceSpanIds: [row.id],
    }));
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
