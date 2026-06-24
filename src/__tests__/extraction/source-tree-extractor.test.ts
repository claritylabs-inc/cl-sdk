import { describe, expect, it, vi } from "vitest";
import type { GenerateObject } from "../../core/types";
import { buildPageSourceSpans, buildSourceSpan } from "../../source";
import { runSourceTreeExtraction } from "../../extraction/source-tree-extractor";

const resolveBudget = (taskKind: "extraction_source_tree" | "extraction_operational_profile", hintTokens: number) => ({
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
              sourceSpanIds: ["not-a-real-span"],
              termDecisions: [
                {
                  termIndex: 0,
                  action: "update",
                  reason: "The value is a deductible, not a generic column value.",
                  kind: "deductible",
                  label: "Deductible",
                  value: "$25,000",
                  sourceSpanIds: ["also-not-real"],
                },
                {
                  termIndex: 1,
                  action: "drop",
                  reason: "The item reference is not a source-backed amount.",
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
  });
});
