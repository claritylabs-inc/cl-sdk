import { describe, expect, it } from "vitest";
import {
  buildDeterministicOperationalProfile,
  buildDocumentSourceTree,
  buildSourceSpan,
  mergeOperationalProfile,
  normalizeDocumentSourceTreePaths,
  normalizeSourceSpans,
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

  it("recovers declaration item limits and preserves endorsement schedule values", () => {
    const documentId = "policy-1";
    const sourceTree = normalizeDocumentSourceTreePaths([
      {
        id: documentId,
        documentId,
        kind: "document",
        title: "Professional Liability Insurance Policy",
        description: "Professional Liability Insurance Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "declarations",
        documentId,
        parentId: documentId,
        kind: "section",
        title: "Professional Liability Insurance Policy Declarations",
        description: "Professional Liability Insurance Policy Declarations",
        textExcerpt: "Professional Liability Insurance Policy Declarations",
        sourceSpanIds: ["s-declarations"],
        pageStart: 3,
        pageEnd: 3,
        order: 1,
        path: "",
      },
      {
        id: "decl-table",
        documentId,
        parentId: "declarations",
        kind: "table",
        title: "Declarations",
        description: "Declarations",
        sourceSpanIds: ["s-decl-table"],
        pageStart: 3,
        pageEnd: 3,
        order: 2,
        path: "",
      },
      {
        id: "decl-row-7",
        documentId,
        parentId: "decl-table",
        kind: "table_row",
        title: "Item 7. Limits of Liability",
        description: "Item 7. Limits of Liability | $5,000,000 Each Claim | $5,000,000 Policy Aggregate",
        textExcerpt: "Item 7. Limits of Liability | $5,000,000 Each Claim | $5,000,000 Policy Aggregate",
        sourceSpanIds: ["s-decl-row-7"],
        pageStart: 3,
        pageEnd: 3,
        order: 3,
        path: "",
      },
      {
        id: "decl-cell-label",
        documentId,
        parentId: "decl-row-7",
        kind: "table_cell",
        title: "Column 1",
        description: "Item 7. Limits of Liability",
        textExcerpt: "Item 7. Limits of Liability",
        sourceSpanIds: ["s-decl-cell-label"],
        pageStart: 3,
        pageEnd: 3,
        order: 4,
        path: "",
      },
      {
        id: "decl-cell-each",
        documentId,
        parentId: "decl-row-7",
        kind: "table_cell",
        title: "Column 2",
        description: "$5,000,000 Each Claim",
        textExcerpt: "$5,000,000 Each Claim",
        sourceSpanIds: ["s-decl-cell-each"],
        pageStart: 3,
        pageEnd: 3,
        order: 5,
        path: "",
      },
      {
        id: "decl-cell-agg",
        documentId,
        parentId: "decl-row-7",
        kind: "table_cell",
        title: "Column 3",
        description: "$5,000,000 Policy Aggregate",
        textExcerpt: "$5,000,000 Policy Aggregate",
        sourceSpanIds: ["s-decl-cell-agg"],
        pageStart: 3,
        pageEnd: 3,
        order: 6,
        path: "",
      },
      {
        id: "endorsement-1",
        documentId,
        parentId: documentId,
        kind: "endorsement",
        title: "Endorsement No. 1 - Professional Services Sublimit",
        description: "Endorsement",
        textExcerpt: "ENDORSEMENT NO. 1 - PROFESSIONAL SERVICES SUBLIMIT",
        sourceSpanIds: ["s-endorsement-1"],
        pageStart: 14,
        pageEnd: 14,
        order: 7,
        path: "",
      },
      {
        id: "endorsement-table",
        documentId,
        parentId: "endorsement-1",
        kind: "table",
        title: "Schedule",
        description: "Schedule",
        sourceSpanIds: ["s-endorsement-table"],
        pageStart: 14,
        pageEnd: 14,
        order: 8,
        path: "",
      },
      {
        id: "endorsement-row-sublimit",
        documentId,
        parentId: "endorsement-table",
        kind: "table_row",
        title: "Sub-Limit (Each Claim / Aggregate)",
        description: "Sub-Limit (Each Claim / Aggregate) | $1,000,000 / $1,000,000 (part of, and not in addition to, the Limit shown in Item 7)",
        textExcerpt: "Sub-Limit (Each Claim / Aggregate) | $1,000,000 / $1,000,000 (part of, and not in addition to, the Limit shown in Item 7)",
        sourceSpanIds: ["s-endorsement-row-sublimit"],
        pageStart: 14,
        pageEnd: 14,
        order: 9,
        path: "",
      },
      {
        id: "endorsement-cell-sublimit-label",
        documentId,
        parentId: "endorsement-row-sublimit",
        kind: "table_cell",
        title: "Column 1",
        description: "Sub-Limit (Each Claim / Aggregate)",
        textExcerpt: "Sub-Limit (Each Claim / Aggregate)",
        sourceSpanIds: ["s-endorsement-cell-sublimit-label"],
        pageStart: 14,
        pageEnd: 14,
        order: 10,
        path: "",
      },
      {
        id: "endorsement-cell-sublimit-value",
        documentId,
        parentId: "endorsement-row-sublimit",
        kind: "table_cell",
        title: "Column 2",
        description: "$1,000,000 / $1,000,000 (part of, and not in addition to, the Limit shown in Item 7)",
        textExcerpt: "$1,000,000 / $1,000,000 (part of, and not in addition to, the Limit shown in Item 7)",
        sourceSpanIds: ["s-endorsement-cell-sublimit-value"],
        pageStart: 14,
        pageEnd: 14,
        order: 11,
        path: "",
      },
      {
        id: "endorsement-row-retention",
        documentId,
        parentId: "endorsement-table",
        kind: "table_row",
        title: "Retention (Each Claim)",
        description: "Retention (Each Claim) | $25,000 each Claim",
        textExcerpt: "Retention (Each Claim) | $25,000 each Claim",
        sourceSpanIds: ["s-endorsement-row-retention"],
        pageStart: 14,
        pageEnd: 14,
        order: 12,
        path: "",
      },
      {
        id: "endorsement-cell-retention-label",
        documentId,
        parentId: "endorsement-row-retention",
        kind: "table_cell",
        title: "Column 1",
        description: "Retention (Each Claim)",
        textExcerpt: "Retention (Each Claim)",
        sourceSpanIds: ["s-endorsement-cell-retention-label"],
        pageStart: 14,
        pageEnd: 14,
        order: 13,
        path: "",
      },
      {
        id: "endorsement-cell-retention-value",
        documentId,
        parentId: "endorsement-row-retention",
        kind: "table_cell",
        title: "Column 2",
        description: "$25,000 each Claim",
        textExcerpt: "$25,000 each Claim",
        sourceSpanIds: ["s-endorsement-cell-retention-value"],
        pageStart: 14,
        pageEnd: 14,
        order: 14,
        path: "",
      },
      {
        id: "endorsement-row-reference",
        documentId,
        parentId: "endorsement-table",
        kind: "table_row",
        title: "Limit Reference",
        description: "Limit Reference | shown in Item 7)",
        textExcerpt: "Limit Reference | shown in Item 7)",
        sourceSpanIds: ["s-endorsement-row-reference"],
        pageStart: 14,
        pageEnd: 14,
        order: 15,
        path: "",
      },
      {
        id: "endorsement-cell-reference-label",
        documentId,
        parentId: "endorsement-row-reference",
        kind: "table_cell",
        title: "Column 1",
        description: "Limit Reference",
        textExcerpt: "Limit Reference",
        sourceSpanIds: ["s-endorsement-cell-reference-label"],
        pageStart: 14,
        pageEnd: 14,
        order: 16,
        path: "",
      },
      {
        id: "endorsement-cell-reference-value",
        documentId,
        parentId: "endorsement-row-reference",
        kind: "table_cell",
        title: "Column 2",
        description: "shown in Item 7)",
        textExcerpt: "shown in Item 7)",
        sourceSpanIds: ["s-endorsement-cell-reference-value"],
        pageStart: 14,
        pageEnd: 14,
        order: 17,
        path: "",
      },
    ]);

    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [] });
    const coreCoverage = profile.coverages.find((coverage) => coverage.coverageOrigin === "core");
    const endorsementCoverage = profile.coverages.find((coverage) => coverage.coverageOrigin === "endorsement");

    expect(coreCoverage).toEqual(expect.objectContaining({
      name: expect.stringMatching(/Limits of Liability|Policy Limits/),
      coverageOrigin: "core",
      limits: expect.arrayContaining([
        expect.objectContaining({ kind: "each_claim_limit", value: "$5,000,000 Each Claim" }),
        expect.objectContaining({ kind: "aggregate_limit", value: "$5,000,000 Policy Aggregate" }),
      ]),
    }));
    expect(endorsementCoverage).toEqual(expect.objectContaining({
      name: "Endorsement No. 1 - Professional Services Sublimit",
      coverageOrigin: "endorsement",
      limits: expect.arrayContaining([
        expect.objectContaining({
          kind: "sublimit",
          label: "Sub-Limit (Each Claim / Aggregate)",
          value: "$1,000,000 / $1,000,000 (part of, and not in addition to, the Limit shown in Item 7)",
        }),
        expect.objectContaining({
          kind: "retention",
          label: "Retention (Each Claim)",
          value: "$25,000 each Claim",
        }),
      ]),
    }));
    expect(endorsementCoverage?.limits.some((term) => term.value === "shown in Item 7)")).toBe(false);
    for (const term of endorsementCoverage?.limits.filter((limitTerm) => limitTerm.value.includes("Item 7")) ?? []) {
      expect(term).not.toEqual(expect.objectContaining({ amount: 7 }));
    }
    expect(endorsementCoverage?.limits).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "retention", value: "Retention (Each Claim)" }),
    ]));
  });

  it("keeps no-retention endorsement rows as value terms", () => {
    const documentId = "policy-1";
    const sourceTree = normalizeDocumentSourceTreePaths([
      {
        id: documentId,
        documentId,
        kind: "document",
        title: "Directors and Officers Liability Policy",
        description: "Directors and Officers Liability Policy",
        sourceSpanIds: [],
        order: 0,
        path: "",
      },
      {
        id: "endorsement-2",
        documentId,
        parentId: documentId,
        kind: "endorsement",
        title: "Endorsement No. 2 - D&O Liability Coverage",
        description: "Endorsement",
        textExcerpt: "ENDORSEMENT NO. 2 - D&O LIABILITY COVERAGE",
        sourceSpanIds: ["s-endorsement-2"],
        pageStart: 18,
        pageEnd: 18,
        order: 1,
        path: "",
      },
      {
        id: "endorsement-table-2",
        documentId,
        parentId: "endorsement-2",
        kind: "table",
        title: "Schedule",
        description: "Schedule",
        sourceSpanIds: ["s-endorsement-table-2"],
        pageStart: 18,
        pageEnd: 18,
        order: 2,
        path: "",
      },
      {
        id: "endorsement-row-no-retention",
        documentId,
        parentId: "endorsement-table-2",
        kind: "table_row",
        title: "Retention (Each Proceeding / Aggregate)",
        description: "Retention (Each Proceeding / Aggregate) | $0 - no Retention applies",
        textExcerpt: "Retention (Each Proceeding / Aggregate) | $0 - no Retention applies",
        sourceSpanIds: ["s-endorsement-row-no-retention"],
        pageStart: 18,
        pageEnd: 18,
        order: 3,
        path: "",
      },
      {
        id: "endorsement-cell-no-retention-label",
        documentId,
        parentId: "endorsement-row-no-retention",
        kind: "table_cell",
        title: "Column 1",
        description: "Retention (Each Proceeding / Aggregate)",
        textExcerpt: "Retention (Each Proceeding / Aggregate)",
        sourceSpanIds: ["s-endorsement-cell-no-retention-label"],
        pageStart: 18,
        pageEnd: 18,
        order: 4,
        path: "",
      },
      {
        id: "endorsement-cell-no-retention-value",
        documentId,
        parentId: "endorsement-row-no-retention",
        kind: "table_cell",
        title: "Column 2",
        description: "$0 - no Retention applies",
        textExcerpt: "$0 - no Retention applies",
        sourceSpanIds: ["s-endorsement-cell-no-retention-value"],
        pageStart: 18,
        pageEnd: 18,
        order: 5,
        path: "",
      },
    ]);

    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [] });

    expect(profile.coverages).toHaveLength(1);
    expect(profile.coverages[0].limits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "retention",
        label: "Retention (Each Proceeding / Aggregate)",
        value: "$0 - no Retention applies",
        amount: 0,
      }),
    ]));
    expect(profile.coverages[0].limits).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "Retention (Each Proceeding / Aggregate)" }),
    ]));
  });

  it("preserves comma-delimited life policy numbers and infers personal policy types", () => {
    const spans = [
      buildSourceSpan({
        documentId: "life-policy",
        sourceKind: "policy_pdf",
        text: "Sun Permanent Life Policy number: LI-1234,567-8 Owner: Jim Doe",
        pageStart: 1,
        pageEnd: 1,
        sourceUnit: "text",
      }, 0),
      buildSourceSpan({
        documentId: "life-policy",
        sourceKind: "policy_pdf",
        text: "Sun Permanent Life Basic insurance coverage Insurance amount: $X,XXX,XXX",
        pageStart: 4,
        pageEnd: 4,
        sourceUnit: "table_row",
        table: { tableId: "policy-summary", rowIndex: 1 },
      }, 1),
    ];
    const tree = buildDocumentSourceTree(spans, "life-policy");
    const profile = buildDeterministicOperationalProfile({ sourceTree: tree, sourceSpans: spans });

    expect(profile.policyNumber?.value).toBe("LI-1234,567-8");
    expect(profile.policyTypes).toContain("life");
  });

  it("prefers policy summary policy numbers over jacket cover numbers", () => {
    const spans = [
      buildSourceSpan({
        documentId: "term-policy",
        sourceKind: "policy_pdf",
        text: "Policy number: LI-1234,567-8",
        pageStart: 1,
        pageEnd: 1,
        sourceUnit: "text",
      }, 0),
      buildSourceSpan({
        documentId: "term-policy",
        sourceKind: "policy_pdf",
        text: "Policy summary Plan: Sun Critical Illness Insurance - Term 75 Policy number: LI-1234,567-9 Policy date: October 2, 2017 Insured person: John Doe",
        pageStart: 4,
        pageEnd: 4,
        sourceUnit: "text",
      }, 1),
    ];
    const tree = buildDocumentSourceTree(spans, "term-policy");
    const profile = buildDeterministicOperationalProfile({ sourceTree: tree, sourceSpans: spans });

    expect(profile.policyNumber?.value).toBe("LI-1234,567-9");
  });

  it("ignores jacket prose when building deterministic identity facts", () => {
    const spans = [
      buildSourceSpan({
        documentId: "term-policy",
        sourceKind: "policy_pdf",
        text: "Sun Critical Illness Insurance - Term 75 Page 1 (insured person: age nearest 18 to 65)",
        pageStart: 1,
        pageEnd: 1,
        sourceUnit: "text",
      }, 0),
      buildSourceSpan({
        documentId: "term-policy",
        sourceKind: "policy_pdf",
        text: "Policy summary Plan: Sun Critical Illness Insurance - Term 75 Policy number: LI-1234,567-9 Insured person: John Doe born on March 1, 1975",
        pageStart: 4,
        pageEnd: 4,
        sourceUnit: "text",
      }, 1),
      buildSourceSpan({
        documentId: "term-policy",
        sourceKind: "policy_pdf",
        text: "Your policy is issued and underwritten by Sun Life Assurance Company of Canada.",
        pageStart: 4,
        pageEnd: 4,
        sourceUnit: "text",
      }, 2),
    ];
    const tree = buildDocumentSourceTree(spans, "term-policy");
    const profile = buildDeterministicOperationalProfile({ sourceTree: tree, sourceSpans: spans });

    expect(profile.namedInsured?.value).toBe("John Doe");
    expect(profile.insurer?.value).toBe("Sun Life Assurance Company of Canada");
  });

  it("does not treat adjacent labels or wording as insured names or premiums", () => {
    const spans = [
      buildSourceSpan({
        documentId: "life-policy",
        sourceKind: "policy_pdf",
        text: "Joint last-to-die basic insurance coverage Insured persons: Insurance amount: John Doe Mary Doe $X,XXX,XXX",
        pageStart: 4,
        pageEnd: 4,
        sourceUnit: "table_row",
      }, 0),
      buildSourceSpan({
        documentId: "life-policy",
        sourceKind: "policy_pdf",
        text: "If the insured person dies during the grace period, we reduce the death benefit by the amount of the missed premium 2.",
        pageStart: 2,
        pageEnd: 2,
        sourceUnit: "text",
      }, 1),
    ];
    const tree = buildDocumentSourceTree(spans, "life-policy");
    const profile = buildDeterministicOperationalProfile({ sourceTree: tree, sourceSpans: spans });

    expect(profile.namedInsured).toBeUndefined();
    expect(profile.premium).toBeUndefined();
  });

  it("reads named insured identities from adjacent declaration table cells", () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Item 1. Named Insured and Address | NextGen Venture Partners, LLC 44 Montgomery Street Suite 4000 San Francisco, CA 94104",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "table_row",
      table: { tableId: "declarations", rowIndex: 1 },
    }, 0);
    const label = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Item 1. Named Insured and Address",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "table_cell",
      parentSpanId: row.id,
      table: { tableId: "declarations", rowIndex: 1, columnIndex: 0, rowSpanId: row.id },
    }, 1);
    const value = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "NextGen Venture Partners, LLC 44 Montgomery Street Suite 4000 San Francisco, CA 94104",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "table_cell",
      parentSpanId: row.id,
      table: { tableId: "declarations", rowIndex: 1, columnIndex: 1, rowSpanId: row.id },
    }, 2);
    const sourceTree = buildDocumentSourceTree([row, label, value], "policy-1");
    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [row, label, value] });
    const rowNode = sourceTree.find((node) => node.kind === "table_row");
    const valueCellNode = sourceTree.find((node) => node.kind === "table_cell" && node.sourceSpanIds.includes(value.id));

    expect(profile.namedInsured?.value).not.toBe("and Address");
    expect(profile.namedInsured?.value).toBe("NextGen Venture Partners, LLC");
    expect(profile.namedInsured?.normalizedValue).toBe("NextGen Venture Partners, LLC");
    expect(profile.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "named_insured", name: "NextGen Venture Partners, LLC" }),
    ]));
    expect(profile.namedInsured?.sourceNodeIds).toEqual(expect.arrayContaining([
      rowNode?.id,
      valueCellNode?.id,
    ]));
  });

  it("extracts jacket prose insurer identities before the insurer label", () => {
    const span = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: 'Beacon Hill Assurance Company (the "Insurer") agrees with the Named Insured that this policy applies.',
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "text",
    });
    const sourceTree = buildDocumentSourceTree([span], "policy-1");
    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [span] });

    expect(profile.insurer?.value).toBe("Beacon Hill Assurance Company");
  });

  it("uses normalized source-backed identities when materializing compatibility document fields", async () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Named Insured: NextGen Venture Partners, LLC 44 Montgomery Street San Francisco, CA 94104",
      pageStart: 2,
      pageEnd: 2,
      sourceUnit: "table_row",
      table: { tableId: "declarations", rowIndex: 1 },
    });
    const extraction = await runSourceTreeExtraction({
      id: "policy-1",
      sourceSpans: [row],
      generateObject: async ({ taskKind }) => ({
        object: taskKind === "extraction_operational_profile"
          ? {
              namedInsured: {
                value: "NextGen Venture Partners, LLC 44 Montgomery Street San Francisco, CA 94104",
                normalizedValue: "NextGen Venture Partners, LLC",
                confidence: "high",
                sourceNodeIds: ["policy-1:source_node:row:declarations:1"],
                sourceSpanIds: [row.id],
              },
            }
          : { labels: [], groups: [] },
      }),
      resolveBudget: (taskKind, hintTokens) => ({
        taskKind,
        hintTokens,
        maxTokens: 1000,
        outputTruncationRisk: "low",
        warnings: [],
      }),
      trackUsage: () => {},
    });

    expect(extraction.operationalProfile.namedInsured?.value).toContain("44 Montgomery");
    expect(extraction.operationalProfile.namedInsured?.normalizedValue).toBe("NextGen Venture Partners, LLC");
    expect(extraction.document.insuredName).toBe("NextGen Venture Partners, LLC");
  });

  it("infers critical illness, disability, and long term care policy types", () => {
    const row = buildSourceSpan({
      documentId: "term-policy",
      sourceKind: "policy_pdf",
      text: "Critical illness insurance benefit | Total disability waiver | Long term care conversion option",
      pageStart: 5,
      pageEnd: 5,
      sourceUnit: "table_row",
      table: { tableId: "benefits", rowIndex: 1 },
    });
    const tree = buildDocumentSourceTree([row], "term-policy");
    const profile = buildDeterministicOperationalProfile({ sourceTree: tree, sourceSpans: [row] });

    expect(profile.policyTypes).toEqual(expect.arrayContaining([
      "critical_illness",
      "disability",
      "long_term_care",
    ]));
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

  it("keeps model-generated coverage rows with nullable optional fields", () => {
    const row = buildSourceSpan({
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      text: "Basic insurance coverage | Insurance amount: $X,XXX,XXX | Premium payment period: Payable to age 100",
      pageStart: 4,
      pageEnd: 4,
      sourceUnit: "table_row",
      table: { tableId: "benefits", rowIndex: 1 },
    });
    const sourceTree = buildDocumentSourceTree([row], "policy-1");
    const base = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [row] });
    const rowNode = sourceTree.find((node) => node.kind === "table_row");

    const merged = mergeOperationalProfile(
      { ...base, coverages: [] },
      {
        coverages: [{
          name: "Sun Permanent Life - Basic insurance coverage",
          coverageCode: null,
          limit: "$X,XXX,XXX",
          deductible: null,
          premium: null,
          retroactiveDate: null,
          formNumber: null,
          coverageOrigin: "core",
          endorsementNumber: null,
          limits: [{
            kind: null,
            label: "Insurance amount",
            value: "$X,XXX,XXX",
            amount: null,
            appliesTo: null,
            sourceNodeIds: [rowNode?.id],
            sourceSpanIds: [row.id],
          }],
          sourceNodeIds: [rowNode?.id],
          sourceSpanIds: [row.id],
        }],
      } as unknown as Parameters<typeof mergeOperationalProfile>[1],
      new Set(sourceTree.map((node) => node.id)),
      new Set([row.id]),
    );

    expect(merged.coverages).toHaveLength(1);
    expect(merged.coverages[0]).toEqual(expect.objectContaining({
      name: "Sun Permanent Life - Basic insurance coverage",
      limit: "$X,XXX,XXX",
      coverageOrigin: "core",
    }));
    expect(merged.coverages[0].deductible).toBeUndefined();
    expect(merged.coverages[0].limits).toEqual([
      expect.objectContaining({
        kind: "other",
        label: "Insurance amount",
        value: "$X,XXX,XXX",
      }),
    ]);
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

  it("uses table header context for declaration sublimit rows", () => {
    const documentId = "policy-1";
    const node = (
      id: string,
      kind: "document" | "table" | "table_row" | "table_cell",
      title: string,
      text: string,
      order: number,
      parentId?: string,
      metadata?: Record<string, unknown>,
    ) => ({
      id,
      documentId,
      ...(parentId ? { parentId } : {}),
      kind,
      title,
      description: text,
      textExcerpt: kind === "document" || kind === "table" ? undefined : text,
      sourceSpanIds: [`span-${id}`],
      pageStart: 5,
      pageEnd: 5,
      order,
      path: "",
      metadata,
    });
    const sourceTree = normalizeDocumentSourceTreePaths([
      node("doc", "document", "Policy", "Policy", 0),
      node("table", "table", "Declarations schedule", "Declarations schedule", 1, "doc"),
      node("header-1", "table_row", "Header row", "Coverage Part | Limit of Liability | Deductible | Retroactive Date", 2, "table", { isHeader: true }),
      node("header-1-a", "table_cell", "Column 1", "Coverage Part", 3, "header-1"),
      node("header-1-b", "table_cell", "Column 2", "Limit of Liability", 4, "header-1"),
      node("header-1-c", "table_cell", "Column 3", "Deductible", 5, "header-1"),
      node("header-1-d", "table_cell", "Column 4", "Retroactive Date", 6, "header-1"),
      node("row-a", "table_row", "Row 1", "Coverage Part: A. Technology Professional Liability | Limit of Liability: $2,000,000 Each Claim | Deductible: $10,000 | Retroactive Date: 01/01/2024", 7, "table"),
      node("row-a-name", "table_cell", "Coverage Part", "A. Technology Professional Liability", 8, "row-a"),
      node("row-a-limit", "table_cell", "Limit of Liability", "$2,000,000 Each Claim", 9, "row-a"),
      node("row-a-ded", "table_cell", "Deductible", "$10,000", 10, "row-a"),
      node("row-a-retro", "table_cell", "Retroactive Date", "01/01/2024", 11, "row-a"),
      node("row-b", "table_row", "Row 2", "Coverage Part: B. Network Security and Privacy Liability | Limit of Liability: $1,000,000 Each Claim / | Deductible: $5,000 Each | Retroactive Date: 05/01/2025", 12, "table"),
      node("row-b-name", "table_cell", "Coverage Part", "B. Network Security and Privacy Liability", 13, "row-b"),
      node("row-b-limit", "table_cell", "Limit of Liability", "$1,000,000 Each Claim /", 14, "row-b"),
      node("row-b-ded", "table_cell", "Deductible", "$5,000 Each", 15, "row-b"),
      node("row-b-retro", "table_cell", "Retroactive Date", "05/01/2025", 16, "row-b"),
      node("header-2", "table_row", "Header row", "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit) | Claim", 17, "table", { isHeader: true }),
      node("header-2-a", "table_cell", "Column 1", "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit)", 18, "header-2"),
      node("header-2-b", "table_cell", "Column 2", "Claim", 19, "header-2"),
      node("row-c", "table_row", "Row 3", "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit): C. Regulatory Proceedings Sub-Limit | Claim: $100,000 Each Proceeding / | Column 3: $5,000 Each | Column 4: 05/01/2025", 20, "table"),
      node("row-c-name", "table_cell", "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit)", "C. Regulatory Proceedings Sub-Limit", 21, "row-c"),
      node("row-c-limit", "table_cell", "Claim", "$100,000 Each Proceeding /", 22, "row-c"),
      node("row-c-ded", "table_cell", "Column 3", "$5,000 Each", 23, "row-c"),
      node("row-c-retro", "table_cell", "Column 4", "05/01/2025", 24, "row-c"),
      node("header-3", "table_row", "Header row", "Aggregate (sub-limit, part of | Proceeding", 25, "table", { isHeader: true }),
      node("header-3-a", "table_cell", "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit)", "Aggregate (sub-limit, part of", 26, "header-3"),
      node("header-3-b", "table_cell", "Claim", "Proceeding", 27, "header-3"),
      node("row-d", "table_row", "Row 4", "Aggregate (sub-limit, part of: D. Social Engineering Fraud | Proceeding: $250,000 Each Loss / | Column 3: $5,000 Each | Column 4: 05/01/2026", 28, "table"),
      node("row-d-name", "table_cell", "Aggregate (sub-limit, part of", "D. Social Engineering Fraud", 29, "row-d"),
      node("row-d-limit", "table_cell", "Proceeding", "$250,000 Each Loss /", 30, "row-d"),
      node("row-d-ded", "table_cell", "Column 3", "$5,000 Each", 31, "row-d"),
      node("row-d-retro", "table_cell", "Column 4", "05/01/2026", 32, "row-d"),
    ]);

    const profile = buildDeterministicOperationalProfile({ sourceTree, sourceSpans: [] });

    expect(profile.coverages.map((coverage) => coverage.name)).toEqual([
      "A. Technology Professional Liability",
      "B. Network Security and Privacy Liability",
      "C. Regulatory Proceedings Sub-Limit",
      "D. Social Engineering Fraud",
    ]);
    expect(profile.coverages.flatMap((coverage) => coverage.limits).map((term) => term.label)).not.toContain("Column 3");
    expect(profile.coverages.flatMap((coverage) => coverage.limits).map((term) => term.label)).not.toContain("Column 4");
    expect(profile.coverages[1].limit).toBe("$1,000,000 Each Claim");
    expect(profile.coverages[2].limits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "sublimit", label: "Claim", value: "$100,000 Each Proceeding" }),
      expect.objectContaining({ kind: "deductible", label: "Deductible", value: "$5,000 Each" }),
      expect.objectContaining({ kind: "retroactive_date", label: "Retroactive Date", value: "05/01/2025" }),
    ]));
    expect(profile.coverages[3].limits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "each_loss_limit", label: "Proceeding", value: "$250,000 Each Loss" }),
      expect.objectContaining({ kind: "deductible", label: "Deductible", value: "$5,000 Each" }),
      expect.objectContaining({ kind: "retroactive_date", label: "Retroactive Date", value: "05/01/2026" }),
    ]));
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
