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
        },
      };
    }
    return { object: { labels: [], groups: [] } };
  }) as GenerateObject;
}

describe("source-tree extraction", () => {
  it("groups source pages into the source-tree skeleton", async () => {
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
            coverages: [
              {
                name: "Technology Professional Liability",
                sourceNodeIds: [],
                sourceSpanIds: [sourceSpans[0].id],
                limits: [],
              },
              {
                name: "Network Security and Privacy Liability",
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
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const cleanupCalls = generateObject.mock.calls
      .map(([params]) => params)
      .filter((params) => params.taskKind === "extraction_coverage_cleanup");
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]?.trace).toEqual(expect.objectContaining({
      label: "Coverage schedule cleanup",
      itemCount: 2,
      coverageGroup: "all",
      sourceBacked: true,
    }));
    expect(cleanupCalls[0]?.prompt).toContain('"coverageIndex": 0');
    expect(cleanupCalls[0]?.prompt).toContain('"coverageIndex": 1');
    expect(cleanupCalls[0]?.prompt).toContain("Premium-only, tax-only, fee-only");

    const profileCalls = generateObject.mock.calls
      .map(([params]) => params)
      .filter((params) => params.taskKind === "extraction_operational_profile");
    expect(profileCalls[0]?.prompt).toContain("Do not merge declaration facts and endorsement schedule facts");
    expect(profileCalls[0]?.prompt).toContain("Premium, tax, fee, payment-plan, rating, exposure, and reporting-value schedules are billing evidence");
    expect(result.operationalProfile.coverages.map((coverage) => ({
      name: coverage.name,
      endorsementNumber: coverage.endorsementNumber,
    }))).toEqual([
      {
        name: "Technology Professional Liability",
        endorsementNumber: undefined,
      },
      {
        name: "Network Security and Privacy Liability",
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

  it("keeps declaration continuation pages with form schedules out of administrative notices", async () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 5,
        text: "DECLARATIONS Item 1. Named Insured Clarity Labs Inc. Item 6. Coverage Parts, Limits of Liability, Deductibles, and Retroactive Dates",
      },
      {
        documentId: "doc-1",
        pageNumber: 6,
        text: "Item 7. Premium Annual Premium (all Coverage Parts) $14,475 Item 8. Extended Reporting Period Options Item 9. Producer Bayshore Insurance Brokers Item 10. Forms and Endorsements Attached at Inception SPS-PJ 01 24 Policy Jacket",
      },
      {
        documentId: "doc-1",
        pageNumber: 7,
        text: "SPS-TPC 03 25 Technology Professional and Cyber Liability Policy SPS-END 001 03 25 Endorsement No. 1 Network Security and Privacy Liability Coverage SPS-END 002 03 25 Endorsement No. 2 Social Engineering Fraud Coverage These Declarations, together with the application(s), the policy form, and any endorsement(s) issued, shall constitute the entire contract. Countersigned April 22, 2026 By Authorized Representative.",
      },
    ]);

    const result = await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans,
      generateObject: modelStub(),
      resolveBudget,
      trackUsage: vi.fn(),
    });

    const declarations = result.sourceTree.find((node) => node.title === "Declarations" && node.kind === "page_group");
    const pageSeven = result.sourceTree.find((node) => node.kind === "page" && node.pageStart === 7);
    const notices = result.sourceTree.find((node) => node.title === "Notices and Jacket" && node.kind === "page_group");

    expect(declarations).toEqual(expect.objectContaining({ pageStart: 5, pageEnd: 7 }));
    expect(pageSeven?.parentId).toBe(declarations?.id);
    expect(pageSeven?.parentId).not.toBe(notices?.id);
  });

  it("guides producer extraction to use the agency name instead of the license role", async () => {
    const evidence = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: [
        "Item 9. Producer",
        "Bayshore Insurance Brokers, LLC",
        "Surplus Lines Broker - CA License No. 0H81-44529",
        "1130 Embarcadero Street, Suite 400, Oakland, CA 94607",
      ].join("\n"),
      pageStart: 6,
      pageEnd: 6,
    }, 900);
    let operationalPrompt = "";
    const generateObject = vi.fn(async (params) => {
      if (params.prompt.includes("Review and clean a source-backed operational profile projection")) {
        return { object: { coverageDecisions: [], warnings: [] } };
      }
      if (params.taskKind === "extraction_operational_profile") {
        operationalPrompt = params.prompt;
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
            broker: {
              value: "Bayshore Insurance Brokers, LLC",
              sourceNodeIds: [],
              sourceSpanIds: [evidence.id],
            },
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

    expect(operationalPrompt).toContain("broker.value must be \"Bayshore Insurance Brokers, LLC\"");
    expect(operationalPrompt).toContain("Surplus Lines Broker");
    expect(ProducerInfoSchema.parse(result.document.producer)).toEqual({
      agencyName: "Bayshore Insurance Brokers, LLC",
      sourceSpanIds: [evidence.id],
    });
  });

  it("does not run model source-tree organizer calls for realistic policies", async () => {
    const pageSpans = buildPageSourceSpans(Array.from({ length: 33 }, (_, index) => ({
      documentId: "doc-1",
      pageNumber: index + 1,
      text: index === 4
        ? "DECLARATIONS Item 1. Named Insured Example Corp."
        : index === 10
          ? "TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY PLEASE READ THIS ENTIRE POLICY CAREFULLY."
          : index === 18
            ? "ENDORSEMENT NO. 1 THIS ENDORSEMENT CHANGES THE POLICY."
            : `Page ${index + 1} policy text`,
    })));
    const extraSpans = Array.from({ length: 410 }, (_, index) => buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: `Supplemental source span ${index}`,
      pageStart: (index % 33) + 1,
      pageEnd: (index % 33) + 1,
      sourceUnit: "text",
    }, 1000 + index));
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") {
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
          },
        };
      }
      return { object: { labels: [], groups: [] } };
    }) as GenerateObject & ReturnType<typeof vi.fn>;

    await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans: [...pageSpans, ...extraSpans],
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    expect(generateObject.mock.calls.some(([params]) =>
      params.taskKind === "extraction_source_tree"
    )).toBe(false);
    const operationalCall = generateObject.mock.calls.find(([params]) =>
      params.taskKind === "extraction_operational_profile"
    );
    expect(operationalCall?.[0].prompt).toContain("DECLARATIONS Item 1. Named Insured Example Corp.");
    expect(operationalCall?.[0].prompt).not.toContain("Supplemental source span 409");
  });

  it("uses declaration schedule rows instead of page blobs for operational profile evidence", async () => {
    const page = buildPageSourceSpans([{
      documentId: "doc-1",
      pageNumber: 5,
      text: "DECLARATIONS PAGE BLOB SHOULD NOT DRIVE COVERAGE EXTRACTION A. Technology Professional Liability only.",
    }])[0]!;
    const genericPolicyWording = [
      "Coverage applies only to those Insureds and Insuring Agreements for which a Limit of Liability has been purchased.",
      "The terms, conditions, limitations, and exclusions set forth herein apply to this policy.",
    ].map((text, index) => buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text,
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "text",
    }, index + 50));
    const scheduleRows = [
      "Item 6. Coverage Parts, Limits of Liability, Deductibles, and Retroactive Dates",
      "Coverage Part Limit of Liability Deductible Retroactive Date",
      "A. Technology Professional Liability $2,000,000 Each Claim $10,000 01/01/2024",
      "$2,000,000 Policy Aggregate",
      "B. Network Security and Privacy Liability $1,000,000 Each Claim / $5,000 Each 05/01/2025",
      "Aggregate (sub-limit, part of and not in addition to Aggregate Policy Limit) $1,000,000",
      "C. Regulatory Proceedings Sub-Limit $100,000 Each Proceeding / $5,000 Each 05/01/2025",
      "Aggregate (sub-limit, part of Coverage Part B) $100,000",
      "D. Social Engineering Fraud $250,000 Each Loss / $5,000 Each 05/01/2026",
      ...Array.from({ length: 14 }, (_, index) =>
        `Coverage Part Supplemental ${index + 1} Limit of Liability $${index + 1},000 Deductible $500`,
      ),
    ].map((text, index) => buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text,
      pageStart: 5,
      pageEnd: 5,
      sourceUnit: "text",
    }, index + 100));
    let operationalPrompt = "";
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") {
        operationalPrompt = params.prompt;
        return {
          object: {
            documentType: "policy",
            policyTypes: ["cyber"],
          },
        };
      }
      return { object: { labels: [], groups: [] } };
    }) as GenerateObject;

    await runSourceTreeExtraction({
      id: "doc-1",
      sourceSpans: [page, ...genericPolicyWording, ...scheduleRows],
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
    });

    expect(operationalPrompt).toContain("B. Network Security and Privacy Liability");
    expect(operationalPrompt).toContain("C. Regulatory Proceedings Sub-Limit");
    expect(operationalPrompt).toContain("D. Social Engineering Fraud");
    expect(operationalPrompt).not.toContain("Coverage applies only to those Insureds");
    expect(operationalPrompt.indexOf("B. Network Security and Privacy Liability")).toBeLessThan(
      operationalPrompt.indexOf("PAGE BLOB SHOULD NOT DRIVE COVERAGE EXTRACTION"),
    );
  });

  it("keeps policy uploads typed as policies when the model returns quote", async () => {
    const evidence = buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      text: "Policy Number APD-1 Named Insured Example Logistics Inc.",
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "text",
    });
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") {
        return {
          object: {
            documentType: "quote",
            policyTypes: ["inland_marine"],
            policyNumber: {
              value: "APD-1",
              sourceNodeIds: [],
              sourceSpanIds: [evidence.id],
            },
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

    expect(result.operationalProfile.documentType).toBe("policy");
    expect(result.document.type).toBe("policy");
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
      linesOfBusiness: ["OLIB"],
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
