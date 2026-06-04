import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  safeGenerateObject,
  runExtractor,
  formatDocumentContent,
  chunkDocument,
  assembleDocument,
} = vi.hoisted(() => ({
  safeGenerateObject: vi.fn(),
  runExtractor: vi.fn(),
  formatDocumentContent: vi.fn(),
  chunkDocument: vi.fn(),
  assembleDocument: vi.fn(),
}));

vi.mock("../../core/safe-generate", () => ({
  safeGenerateObject,
}));

vi.mock("../../extraction/extractor", () => ({
  runExtractor,
}));

vi.mock("../../extraction/pdf", () => {
  const getPdfPageCount = vi.fn().mockResolvedValue(6);
  const extractPageRange = vi.fn().mockResolvedValue("mapped-pages-pdf-base64");
  return {
    getPdfPageCount,
    extractPageRange,
    createPdfPageSlicer: vi.fn().mockResolvedValue({
      getPageCount: () => getPdfPageCount.getMockImplementation()?.() ?? 6,
      extractPageRange,
    }),
    pdfInputToBase64: vi.fn().mockImplementation((input: string) => Promise.resolve(input)),
    buildPdfProviderOptions: vi.fn().mockImplementation(async (input: string, existing?: Record<string, unknown>) => ({
      ...existing,
      pdfBase64: input,
    })),
  };
});

vi.mock("../../extraction/formatter", () => ({
  formatDocumentContent,
}));

vi.mock("../../extraction/chunking", () => ({
  chunkDocument,
}));

vi.mock("../../extraction/assembler", () => ({
  assembleDocument,
}));

import { createExtractor } from "../../extraction/coordinator";
import { extractPageRange, getPdfPageCount } from "../../extraction/pdf";
import { buildPageSourceSpans, buildSourceSpan } from "../../source";

describe("createExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPdfPageCount).mockResolvedValue(6);
    vi.mocked(extractPageRange).mockResolvedValue("mapped-pages-pdf-base64");

    safeGenerateObject
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["general_liability"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["carrier_info", "named_insured", "declarations", "coverage_limits"] },
            { localPageNumber: 2, extractorNames: ["coverage_limits"] },
            { localPageNumber: 3, extractorNames: ["sections"] },
            { localPageNumber: 4, extractorNames: ["sections"] },
            { localPageNumber: 5, extractorNames: ["endorsements"] },
            { localPageNumber: 6, extractorNames: ["endorsements"] },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    runExtractor.mockResolvedValue({
      name: "sections",
      data: { sections: [] },
      usage: { inputTokens: 20, outputTokens: 10 },
    });

    assembleDocument.mockReturnValue({ id: "doc-1", type: "policy" });
    formatDocumentContent.mockResolvedValue({
      document: { id: "doc-1", type: "policy" },
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    chunkDocument.mockReturnValue([]);
  });

  it("returns an object with extract method", () => {
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });
    expect(typeof extractor.extract).toBe("function");
  });

  it("passes the full PDF to classify and review, page-scoped PDFs to page mapping, then dispatches page-mapped extractors", async () => {
    const generateText = vi.fn();
    const generateObject = vi.fn();
    const extractor = createExtractor({
      generateText,
      generateObject,
      providerOptions: { anthropic: { thinking: true } },
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1");

    expect(safeGenerateObject).toHaveBeenNthCalledWith(
      1,
      generateObject,
      expect.objectContaining({
        maxTokens: 512,
        taskKind: "extraction_classify",
        budgetDiagnostics: expect.objectContaining({ taskKind: "extraction_classify", maxTokens: 512 }),
        providerOptions: {
          anthropic: { thinking: true },
          pdfBase64: "full-pdf-base64",
        },
      }),
      expect.any(Object),
    );

    expect(safeGenerateObject).toHaveBeenNthCalledWith(
      2,
      generateObject,
      expect.objectContaining({
        maxTokens: 2048,
        taskKind: "extraction_form_inventory",
        budgetDiagnostics: expect.objectContaining({ taskKind: "extraction_form_inventory", maxTokens: 2048 }),
        providerOptions: {
          anthropic: { thinking: true },
          pdfBase64: "full-pdf-base64",
        },
      }),
      expect.any(Object),
    );

    expect(safeGenerateObject).toHaveBeenNthCalledWith(
      3,
      generateObject,
      expect.objectContaining({
        maxTokens: 2048,
        taskKind: "extraction_page_map",
        budgetDiagnostics: expect.objectContaining({ taskKind: "extraction_page_map", maxTokens: 2048 }),
        providerOptions: {
          anthropic: { thinking: true },
          pdfBase64: "mapped-pages-pdf-base64",
        },
      }),
      expect.any(Object),
    );

    expect(safeGenerateObject).toHaveBeenNthCalledWith(
      4,
      generateObject,
      expect.objectContaining({
        maxTokens: 1536,
        taskKind: "extraction_review",
        budgetDiagnostics: expect.objectContaining({ taskKind: "extraction_review", maxTokens: 1536 }),
        providerOptions: {
          anthropic: { thinking: true },
          pdfBase64: "full-pdf-base64",
        },
      }),
      expect.any(Object),
    );

    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfInput: "full-pdf-base64",
        taskKind: expect.stringMatching(/^extraction_(focused|long_list)$/),
        budgetDiagnostics: expect.objectContaining({
          taskKind: expect.stringMatching(/^extraction_(focused|long_list)$/),
        }),
        providerOptions: { anthropic: { thinking: true } },
      }),
    );
    expect(runExtractor.mock.calls.some(([arg]) => arg.name === "supplementary")).toBe(false);
    expect(result.reviewReport).toEqual(expect.objectContaining({
      qualityGateStatus: expect.stringMatching(/passed|warning|failed/),
      rounds: expect.any(Array),
      artifacts: expect.any(Array),
      issues: expect.any(Array),
      formInventory: expect.any(Array),
    }));
    expect(result.performanceReport.modelCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskKind: "extraction_classify",
          label: "classify",
          maxTokens: 512,
          usageReported: false,
        }),
      ]),
    );
  });

  it("keeps failed LLM review fallbacks non-clean", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["general_liability"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["sections"] },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          complete: false,
          missingFields: ["llm_review_unavailable"],
          qualityIssues: ["LLM extraction review failed; deterministic review was used and the result needs review."],
          additionalTasks: [],
        },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1");
    const reviewOptions = safeGenerateObject.mock.calls[3]?.[2];

    expect(reviewOptions).toEqual(expect.objectContaining({
      fallback: expect.objectContaining({
        complete: false,
        missingFields: ["llm_review_unavailable"],
        qualityIssues: expect.arrayContaining([
          expect.stringContaining("LLM extraction review failed"),
        ]),
      }),
    }));
    expect(result.reviewReport.reviewRoundRecords[0]).toEqual(expect.objectContaining({
      complete: false,
      missingFields: ["llm_review_unavailable"],
      qualityIssues: expect.arrayContaining([
        expect.stringContaining("LLM extraction review failed"),
      ]),
    }));
    expect(result.reviewReport.rounds[0]).toEqual(expect.objectContaining({
      status: "warning",
    }));
    expect(result.reviewReport.qualityGateStatus).toBe("warning");
  });

  it("accepts all optional config fields", () => {
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      convertPdfToImages: vi.fn(),
      concurrency: 4,
      pageMapConcurrency: 3,
      extractorConcurrency: 5,
      formatConcurrency: 2,
      maxReviewRounds: 3,
      reviewMode: "auto",
      onTokenUsage: vi.fn(),
      onProgress: vi.fn(),
      log: vi.fn(),
      providerOptions: { anthropic: {} },
      modelCapabilities: { maxOutputTokens: 32768 },
      modelBudgetConstraints: { extraction_review: { maxOutputTokens: 1024 } },
    });
    expect(typeof extractor.extract).toBe("function");
  });

  it("persists caller-provided source spans without forwarding them through source-tree provider options", async () => {
    safeGenerateObject
      .mockReset()
      .mockImplementation(async (_generateObject, params) => {
        if (params.taskKind === "extraction_source_tree") {
          return { object: { labels: [], groups: [] } };
        }
        return {
          object: { documentType: "policy", policyTypes: ["general_liability"], confidence: 0.95 },
        };
      });
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 1,
        text: "Policy number POL-0001. Building limit is $1,000,000.",
      },
    ]);
    const sourceStore = {
      addSourceSpans: vi.fn(async () => undefined),
      addSourceChunks: vi.fn(async () => undefined),
      getSourceSpan: vi.fn(),
      getSourceSpansByDocument: vi.fn(),
      getSourceChunksByDocument: vi.fn(),
      deleteDocumentSource: vi.fn(),
      searchSourceSpans: vi.fn(),
    };
    runExtractor.mockResolvedValue({
      name: "exclusions",
      data: {
        exclusions: [{
          name: "Building limit",
          content: "Policy number POL-0001. Building limit is $1,000,000.",
          pageNumber: 1,
        }],
      },
      usage: { inputTokens: 20, outputTokens: 10 },
    });
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      sourceStore,
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1", { sourceSpans });

    expect(sourceStore.addSourceSpans).toHaveBeenCalledWith(sourceSpans);
    expect(sourceStore.addSourceChunks).toHaveBeenCalledWith(result.sourceChunks);
    expect(result.sourceSpans).toEqual(sourceSpans);
    expect(result.sourceChunks).toHaveLength(1);
    expect(result.sourceTree?.some((node) => node.kind === "page")).toBe(true);
    expect(result.operationalProfile?.policyNumber?.value).toBe("POL-0001");
    const sourceTreeCallParams = safeGenerateObject.mock.calls.find(([, params]) => params.taskKind === "extraction_source_tree")?.[1];
    expect(sourceTreeCallParams).toEqual(expect.objectContaining({
      taskKind: "extraction_source_tree",
    }));
    expect(sourceTreeCallParams).not.toHaveProperty("providerOptions");
    expect(result.document.documentMetadata?.sourceTreeCanonical).toBe(true);
  });

  it("skips the source-tree organizer for large deterministic page sets", async () => {
    safeGenerateObject
      .mockReset()
      .mockImplementation(async (_generateObject, params) => {
        if (params.taskKind === "extraction_source_tree") {
          return { object: { labels: [], groups: [] } };
        }
        return {
          object: { documentType: "policy", policyTypes: ["cyber"], coverageTypes: ["cyber"] },
        };
      });
    const sourceSpans = buildPageSourceSpans(
      Array.from({ length: 35 }, (_, index) => {
        const pageNumber = index + 1;
        return {
          documentId: "doc-1",
          sourceKind: "policy_pdf",
          pageNumber,
          text: `Page ${pageNumber} policy form content. ${pageNumber === 35 ? "Final endorsement schedule." : "Standard wording."}`,
        };
      }),
    );
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      reviewMode: "skip",
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1", { sourceSpans });

    const sourceTreeCalls = safeGenerateObject.mock.calls.filter(([, params]) => params.taskKind === "extraction_source_tree");
    expect(sourceTreeCalls).toHaveLength(1);
    expect(sourceTreeCalls[0]?.[1]).toEqual(expect.objectContaining({
      prompt: expect.stringContaining("You clean a top-level source outline"),
    }));
    expect(sourceTreeCalls[0]?.[1]).not.toHaveProperty("providerOptions");
    expect(result.sourceTree).toEqual(expect.arrayContaining([
      expect.objectContaining({ pageStart: 35, title: "Page 35" }),
    ]));
  });

  it("groups endorsements under a generic parent while rejecting range rollup titles", async () => {
    safeGenerateObject
      .mockReset()
      .mockImplementation(async (_generateObject, params) => {
        if (params.taskKind === "extraction_source_tree") {
          const topLevelNodeIds = JSON.parse(
            (params.prompt as string).match(/Top-level page\/form candidates in this batch: (.+)/)?.[1] ?? "[]",
          ) as string[];
          return {
            object: {
              labels: [
                {
                  nodeId: topLevelNodeIds[0],
                  kind: "schedule",
                  title: "Declarations (Technology E&O & Cyber Liability)",
                },
                {
                  nodeId: topLevelNodeIds[1],
                  kind: "form",
                  title: "Policy Form — Technology Errors & Omissions / Cyber Liability",
                },
              ],
              groups: [
                {
                  kind: "page_group",
                  title: "Endorsements 1–2 (Network Security/Privacy; Bricking/Cyber Extortion)",
                  childNodeIds: topLevelNodeIds.slice(2, 4),
                },
              ],
            },
          };
        }
        return {
          object: { documentType: "policy", policyTypes: ["cyber"], coverageTypes: ["cyber"] },
        };
      });

    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 1,
        text: "Declarations. Technology errors and omissions and cyber liability.",
      },
      {
        documentId: "doc-1",
        pageNumber: 2,
        text: "Policy Form. Technology errors and omissions / cyber liability coverage form.",
      },
      {
        documentId: "doc-1",
        pageNumber: 3,
        text: "Endorsement No. 1. Network Security and Privacy Liability Coverage.",
      },
      {
        documentId: "doc-1",
        pageNumber: 4,
        text: "Endorsement No. 2. Cyber Extortion Expense Coverage.",
      },
    ]);
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      reviewMode: "skip",
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1", { sourceSpans });

    expect(result.sourceTree).toEqual(expect.arrayContaining([
      expect.objectContaining({ pageStart: 1, title: "Declarations" }),
      expect.objectContaining({ pageStart: 2, title: "Policy Form" }),
    ]));
    expect(result.sourceTree).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "page_group",
        title: expect.stringMatching(/^Endorsements\s+\d+[–-]\d+/),
        metadata: expect.objectContaining({ organizer: "llm_group" }),
      }),
    ]));
    const endorsementGroup = result.sourceTree?.find((node) => node.kind === "page_group" && node.title === "Endorsements");
    expect(endorsementGroup).toEqual(expect.objectContaining({
      pageStart: 3,
      pageEnd: 4,
    }));
    const childEndorsements = result.sourceTree
      ?.filter((node) => node.parentId === endorsementGroup?.id)
      .map((node) => ({ kind: node.kind, title: node.title, pageStart: node.pageStart }));
    expect(childEndorsements).toEqual([
      { kind: "endorsement", title: "Endorsement No. 1", pageStart: 3 },
      { kind: "endorsement", title: "Endorsement No. 2", pageStart: 4 },
    ]);
  });

  it("deterministically groups Northwoods-like declarations, policy form pages, and endorsements", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { labels: [], groups: [] },
      })
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["cyber"], coverageTypes: ["cyber"] },
      });
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 5,
        text: "TERRORISM RISK INSURANCE ACT (TRIA) DISCLOSURE AND REJECTION Form NWC-TRIA-D 04 22 Disclosure of Federal Participation in Payment of Terrorism Losses.",
      },
      {
        documentId: "doc-1",
        pageNumber: 6,
        text: "DECLARATIONS PAGE TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY Item 1. Named Insured Cove Technologies Inc.",
      },
      {
        documentId: "doc-1",
        pageNumber: 7,
        text: "Coverage Part Each Claim Limit Aggregate Limit Retroactive Date AI/ML Output Sub-Limit $1,000,000 $2,000,000 subject to Endorsement No. 4. Item 7. Self-Insured Retention.",
      },
      {
        documentId: "doc-1",
        pageNumber: 8,
        text: "A Bilateral Discovery Period of 60 days is automatically available. Item 13. Forms and Endorsements at inception.",
      },
      {
        documentId: "doc-1",
        pageNumber: 9,
        text: "Trade or Economic Sanctions Limitation. This administrative notice explains sanctions restrictions.",
      },
      {
        documentId: "doc-1",
        pageNumber: 10,
        text: "TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY Form NWC-TEC 04 25 PLEASE READ THIS ENTIRE POLICY CAREFULLY.",
      },
      {
        documentId: "doc-1",
        pageNumber: 11,
        text: "INSURING AGREEMENT Defense Outside Limits Until Supplementary Defense Cap Is Exhausted.",
      },
      {
        documentId: "doc-1",
        pageNumber: 12,
        text: "Claim means a written demand for monetary or non-monetary relief. Insured means the Named Insured. Additional exclusions may be modified by Endorsement No. 2.",
      },
      {
        documentId: "doc-1",
        pageNumber: 21,
        text: "NWC-END 001 04 25 NORTHWOODS CONTINENTAL INSURANCE COMPANY THIS ENDORSEMENT CHANGES THE POLICY. Network Security and Privacy Liability.",
      },
      {
        documentId: "doc-1",
        pageNumber: 22,
        text: "Additional exclusions and conditions under Endorsement No. 1.",
      },
      {
        documentId: "doc-1",
        pageNumber: 23,
        text: "NWC-END 002 04 25 NORTHWOODS CONTINENTAL INSURANCE COMPANY THIS ENDORSEMENT CHANGES THE POLICY. Cyber Extortion Expense Coverage.",
      },
      {
        documentId: "doc-1",
        pageNumber: 24,
        text: "Regulatory defense and fines provisions continued under Endorsement No. 2.",
      },
      {
        documentId: "doc-1",
        pageNumber: 26,
        text: "NWC-END 004 04 25 NORTHWOODS CONTINENTAL INSURANCE COMPANY THIS ENDORSEMENT CHANGES THE POLICY. AI/ML Output Sub-Limit.",
      },
    ]);
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      reviewMode: "skip",
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1", { sourceSpans });

    const documentRoot = result.sourceTree?.find((node) => node.kind === "document");
    const topLevel = result.sourceTree
      ?.filter((node) => node.parentId === documentRoot?.id)
      .map((node) => ({ title: node.title, kind: node.kind, pageStart: node.pageStart, pageEnd: node.pageEnd }));
    expect(topLevel).toEqual([
      { title: "Notices and Jacket", kind: "page_group", pageStart: 5, pageEnd: 9 },
      { title: "Declarations", kind: "page_group", pageStart: 6, pageEnd: 8 },
      { title: "Policy Form", kind: "form", pageStart: 10, pageEnd: 12 },
      { title: "Endorsements", kind: "page_group", pageStart: 21, pageEnd: 26 },
    ]);

    const notices = result.sourceTree?.find((node) => node.kind === "page_group" && node.title === "Notices and Jacket");
    expect(result.sourceTree?.filter((node) => node.parentId === notices?.id).map((node) => node.pageStart)).toEqual([5, 9]);

    const declarations = result.sourceTree?.find((node) => node.kind === "page_group" && node.title === "Declarations");
    expect(declarations).toEqual(expect.objectContaining({ pageStart: 6, pageEnd: 8 }));
    expect(result.sourceTree?.filter((node) => node.parentId === declarations?.id).map((node) => node.pageStart)).toEqual([6, 7, 8]);

    const policyForm = result.sourceTree?.find((node) => node.kind === "form" && node.title === "Policy Form");
    expect(policyForm).toEqual(expect.objectContaining({ pageStart: 10, pageEnd: 12 }));
    expect(result.sourceTree?.filter((node) => node.parentId === policyForm?.id).map((node) => node.pageStart)).toEqual([10, 11, 12]);

    const endorsementGroup = result.sourceTree?.find((node) => node.kind === "page_group" && node.title === "Endorsements");
    expect(endorsementGroup).toEqual(expect.objectContaining({ pageStart: 21, pageEnd: 26 }));
    expect(result.sourceTree?.filter((node) => node.parentId === endorsementGroup?.id).map((node) => node.pageStart))
      .not.toEqual(expect.arrayContaining([7, 12]));
    expect(result.sourceTree
      ?.filter((node) => node.parentId === endorsementGroup?.id)
      .map((node) => ({ kind: node.kind, title: node.title, pageStart: node.pageStart, pageEnd: node.pageEnd }))).toEqual([
        { kind: "endorsement", title: "Endorsement No. 1", pageStart: 21, pageEnd: 22 },
        { kind: "endorsement", title: "Endorsement No. 2", pageStart: 23, pageEnd: 24 },
        { kind: "endorsement", title: "Endorsement No. 4", pageStart: 26, pageEnd: 26 },
      ]);
    const firstEndorsement = result.sourceTree?.find((node) => node.parentId === endorsementGroup?.id && node.title === "Endorsement No. 1");
    expect(result.sourceTree?.filter((node) => node.parentId === firstEndorsement?.id).map((node) => node.pageStart))
      .toEqual(expect.arrayContaining([22]));
  });

  it("keeps front matter separate and includes page ranges on standard policy groups", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValue({
        object: { documentType: "policy", policyTypes: ["cyber"], coverageTypes: ["cyber"] },
      });
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        pageNumber: 2,
        text: "IMPORTANT NOTICE — HOW TO REPORT A CLAIM. This notice explains claim reporting.",
      },
      {
        documentId: "doc-1",
        pageNumber: 3,
        text: "PRIVACY NOTICE TO POLICYHOLDERS. This administrative notice is not policy wording.",
      },
      {
        documentId: "doc-1",
        pageNumber: 4,
        text: "OFAC ADVISORY NOTICE. This administrative notice is not policy wording.",
      },
      {
        documentId: "doc-1",
        pageNumber: 5,
        text: "DECLARATIONS PAGE TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY Item 1. Named Insured Cove Technologies Inc.",
      },
      {
        documentId: "doc-1",
        pageNumber: 6,
        text: "Coverage Part Each Claim Limit Aggregate Limit Retroactive Date. Item 13. Forms and Endorsements at inception.",
      },
      {
        documentId: "doc-1",
        pageNumber: 7,
        text: "Trade or Economic Sanctions Limitation. This administrative notice explains sanctions restrictions.",
      },
      {
        documentId: "doc-1",
        pageNumber: 8,
        text: "TECHNOLOGY ERRORS & OMISSIONS AND CYBER LIABILITY INSURANCE POLICY Form NWC-TEC 04 25 PLEASE READ THIS ENTIRE POLICY CAREFULLY.",
      },
      {
        documentId: "doc-1",
        pageNumber: 9,
        text: "INSURING AGREEMENT. DEFINITIONS. EXCLUSIONS. CONDITIONS. Claim means a written demand.",
      },
      {
        documentId: "doc-1",
        pageNumber: 10,
        text: "NWC-END 001 04 25 THIS ENDORSEMENT CHANGES THE POLICY. Network Security and Privacy Liability.",
      },
      {
        documentId: "doc-1",
        pageNumber: 11,
        text: "All other terms and conditions remain unchanged under Endorsement No. 1.",
      },
    ]);
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      reviewMode: "skip",
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1", { sourceSpans });
    expect(safeGenerateObject.mock.calls.filter(([, params]) => params.taskKind === "extraction_source_tree")).toHaveLength(0);
    const topLevel = result.sourceTree
      ?.filter((node) => node.parentId === result.sourceTree?.find((candidate) => candidate.kind === "document")?.id)
      .map((node) => ({ title: node.title, kind: node.kind, pageStart: node.pageStart, pageEnd: node.pageEnd, description: node.description }));

    expect(topLevel).toEqual([
      expect.objectContaining({ title: "Notices and Jacket", kind: "page_group", pageStart: 2, pageEnd: 7 }),
      expect.objectContaining({ title: "Declarations", kind: "page_group", pageStart: 5, pageEnd: 6, description: expect.stringContaining("pages 5-6") }),
      expect.objectContaining({ title: "Policy Form", kind: "form", pageStart: 8, pageEnd: 9, description: expect.stringContaining("pages 8-9") }),
      expect.objectContaining({ title: "Endorsements", kind: "page_group", pageStart: 10, pageEnd: 11, description: expect.stringContaining("pages 10-11") }),
    ]);
    const notices = result.sourceTree?.find((node) => node.kind === "page_group" && node.title === "Notices and Jacket");
    expect(result.sourceTree?.filter((node) => node.parentId === notices?.id).map((node) => node.pageStart))
      .toEqual([2, 3, 4, 7]);
    expect(result.sourceTree?.find((node) => node.parentId === notices?.id && node.pageStart === 7))
      .toEqual(expect.objectContaining({ title: "Page 7" }));
  });

  it("uses source spans for source-tree section indexes without section LLM calls", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 2, extractorNames: ["sections"] },
          ],
        },
      });
    const sourceSpans = [
      buildSourceSpan({
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageStart: 2,
        pageEnd: 2,
        sectionId: "Commercial Property Provisions",
        text: "Commercial Property Provisions. This part describes policy administration, coverage territory, inspections, transfer of rights, and other general policy wording.",
        metadata: { sourceUnit: "section_candidate" },
      }),
    ];
    assembleDocument.mockImplementation((_id, _type, memory) => ({
      id: "doc-1",
      type: "policy",
      sections: ((memory as Map<string, unknown>).get("sections") as { sections?: unknown[] } | undefined)?.sections,
    }));
    formatDocumentContent.mockImplementation(async (document) => ({
      document,
      usage: { inputTokens: 0, outputTokens: 0 },
    }));

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      reviewMode: "skip",
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1", { sourceSpans });

    expect(safeGenerateObject.mock.calls.filter(([, params]) => params.taskKind === "extraction_source_tree")).toHaveLength(2);
    expect(safeGenerateObject.mock.calls.some(([, params]) => params.taskKind === "extraction_source_tree")).toBe(true);
    expect(safeGenerateObject.mock.calls.some(([, params]) => params.taskKind === "extraction_operational_profile")).toBe(true);
    expect(safeGenerateObject.mock.calls.some(([, params]) => params.taskKind === "extraction_form_inventory")).toBe(false);
    expect(safeGenerateObject.mock.calls.some(([, params]) => params.taskKind === "extraction_page_map")).toBe(false);
    expect(runExtractor.mock.calls.some(([arg]) => arg.name === "sections")).toBe(false);
    expect(result.sourceTree).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "section",
        title: "Commercial Property Provisions",
        pageStart: 2,
        pageEnd: 2,
        sourceSpanIds: [sourceSpans[0].id],
      }),
    ]));
    expect(result.document.documentOutline).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Page 2",
        children: expect.arrayContaining([
          expect.objectContaining({
            title: "Commercial Property Provisions",
            sourceSpanIds: [sourceSpans[0].id],
          }),
        ]),
      }),
    ]));
  });

  it("accepts Docling documents without PDF slicing and derives source spans", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["declarations", "coverage_limits"] },
            { localPageNumber: 2, extractorNames: ["sections"] },
          ],
        },
      })
      .mockResolvedValue({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    runExtractor.mockResolvedValue({
      name: "coverage_limits",
      data: {
        coverages: [{
          name: "Building",
          limit: "$1,000,000",
          pageNumber: 1,
        }],
      },
      usage: { inputTokens: 20, outputTokens: 10 },
    });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      reviewMode: "skip",
    });

    const result = await extractor.extract({
      kind: "docling_document",
      document: {
        body: {
          children: [{ $ref: "#/texts/0" }, { $ref: "#/texts/1" }],
        },
        texts: [
          {
            self_ref: "#/texts/0",
            label: "section_header",
            text: "Commercial Property Declarations",
            prov: [{ page_no: 1 }],
          },
          {
            self_ref: "#/texts/1",
            label: "paragraph",
            text: "Building limit $1,000,000",
            prov: [{ page_no: 2 }],
          },
        ],
        pages: { "1": {}, "2": {} },
      },
    }, "doc-1");

    expect(getPdfPageCount).not.toHaveBeenCalled();
    expect(extractPageRange).not.toHaveBeenCalled();
    expect(result.sourceSpans).toHaveLength(2);
    expect(result.sourceTree).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "section_header",
        sourceSpanIds: [result.sourceSpans[0].id],
      }),
      expect.objectContaining({
        title: "paragraph",
        sourceSpanIds: [result.sourceSpans[1].id],
      }),
    ]));
    const sourceTreeCallParams = safeGenerateObject.mock.calls.find(([, params]) => params.taskKind === "extraction_source_tree")?.[1];
    expect(sourceTreeCallParams).toEqual(expect.objectContaining({
      taskKind: "extraction_source_tree",
      prompt: expect.stringContaining("Source nodes"),
    }));
    expect(sourceTreeCallParams).not.toHaveProperty("providerOptions");
    expect(runExtractor).not.toHaveBeenCalled();
  });

  it("uses the model output limit for long-list extractors when capabilities allow it", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["general_liability"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["coverage_limits"] },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      modelCapabilities: {
        maxOutputTokens: 32768,
        longListOutputTokens: 16384,
      },
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "coverage_limits",
        maxTokens: 32768,
        budgetDiagnostics: expect.objectContaining({
          preferredOutputTokens: 16384,
          maxTokens: 32768,
        }),
      }),
    );
  });

  it("maps page chunks in parallel and reports each chunk deterministically", async () => {
    vi.mocked(getPdfPageCount).mockResolvedValue(10);
    vi.mocked(extractPageRange)
      .mockResolvedValueOnce("mapped-pages-1-8")
      .mockResolvedValueOnce("mapped-pages-9-10");
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["general_liability"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: Array.from({ length: 8 }, (_, index) => ({
            localPageNumber: index + 1,
            extractorNames: ["sections"],
          })),
        },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["endorsements"] },
            { localPageNumber: 2, extractorNames: ["endorsements"] },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      concurrency: 2,
    });

    const result = await extractor.extract("full-pdf-base64", "doc-1");

    expect(extractPageRange).toHaveBeenCalledTimes(2);
    expect(result.performanceReport.modelCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskKind: "extraction_page_map", label: "page_map:1-8" }),
        expect.objectContaining({ taskKind: "extraction_page_map", label: "page_map:9-10" }),
      ]),
    );
    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({ name: "sections", startPage: 1, endPage: 8 }),
    );
    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({ name: "endorsements", startPage: 9, endPage: 10 }),
    );
  });

  it("honors model page-map choices for coverage_limits before planning", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            {
              localPageNumber: 1,
              extractorNames: ["carrier_info", "named_insured", "declarations", "coverage_limits"],
              pageRole: "declarations_schedule",
              hasScheduleValues: true,
            },
            {
              localPageNumber: 2,
              extractorNames: ["conditions", "coverage_limits", "sections"],
              pageRole: "condition_exclusion_form",
              hasScheduleValues: false,
              notes: "Generic form text describing how the declarations limit applies",
            },
            {
              localPageNumber: 3,
              extractorNames: ["endorsements", "coverage_limits", "sections"],
              pageRole: "endorsement_form",
              hasScheduleValues: false,
              notes: "Endorsement text that references limits shown in the declarations",
            },
            { localPageNumber: 4, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 5, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 6, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    const coverageCalls = runExtractor.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.name === "coverage_limits");

    expect(coverageCalls).toHaveLength(1);
    expect(coverageCalls[0]).toEqual(expect.objectContaining({
      startPage: 1,
      endPage: 3,
    }));
  });

  it("runs supplementary extraction when form inventory suggests notice or regulatory facts", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: {
          forms: [
            {
              formNumber: "IL 01 46",
              formType: "notice",
              pageStart: 6,
              pageEnd: 6,
              title: "State Department of Insurance Complaint Notice",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["declarations"], pageRole: "declarations_schedule", hasScheduleValues: true },
            { localPageNumber: 2, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 3, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 4, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 5, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 6, extractorNames: ["sections"], pageRole: "other", hasScheduleValues: false },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "supplementary",
        startPage: 6,
        endPage: 6,
        pdfInput: "full-pdf-base64",
      }),
    );
  });

  it("lets review request supplementary as a focused follow-up", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["declarations"], pageRole: "declarations_schedule", hasScheduleValues: true },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          complete: false,
          missingFields: ["claims contact"],
          qualityIssues: ["Claims contact notice appears missing"],
          additionalTasks: [
            {
              extractorName: "supplementary",
              startPage: 1,
              endPage: 1,
              description: "Extract claims contact details",
            },
          ],
        },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      maxReviewRounds: 1,
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "supplementary",
        startPage: 1,
        endPage: 1,
        pdfInput: "full-pdf-base64",
      }),
    );
  });

  it("broadens exclusions and conditions to the containing form range before dispatch", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: {
          forms: [
            { formNumber: "PR5070CF", formType: "coverage", pageStart: 2, pageEnd: 5, title: "Commercial Property Coverage Form" },
            { formNumber: "PR068END", formType: "endorsement", pageStart: 6, pageEnd: 6, title: "Leasehold Interest" },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["declarations"], pageRole: "declarations_schedule", hasScheduleValues: true },
            { localPageNumber: 2, extractorNames: ["sections", "exclusions", "conditions"], pageRole: "condition_exclusion_form", hasScheduleValues: false },
            { localPageNumber: 3, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 4, extractorNames: ["sections", "exclusions"], pageRole: "condition_exclusion_form", hasScheduleValues: false },
            { localPageNumber: 5, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 6, extractorNames: ["sections", "endorsements", "exclusions"], pageRole: "endorsement_form", hasScheduleValues: false },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    const exclusionsCalls = runExtractor.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.name === "exclusions");
    const conditionsCalls = runExtractor.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.name === "conditions");
    const endorsementCalls = runExtractor.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.name === "endorsements");

    expect(exclusionsCalls).toEqual([
      expect.objectContaining({ startPage: 2, endPage: 6 }),
    ]);
    expect(conditionsCalls).toEqual([
      expect.objectContaining({ startPage: 2, endPage: 5 }),
    ]);
    expect(endorsementCalls).toEqual([
      expect.objectContaining({ startPage: 6, endPage: 6 }),
    ]);
  });

  it("broadens definitions and covered reasons to the containing form range before dispatch", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: {
          forms: [
            { formNumber: "CP1030", formType: "coverage", pageStart: 2, pageEnd: 5, title: "Causes of Loss - Special Form" },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["declarations"], pageRole: "declarations_schedule", hasScheduleValues: true },
            { localPageNumber: 2, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 3, extractorNames: ["covered_reasons"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 4, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 5, extractorNames: ["definitions"], pageRole: "policy_form", hasScheduleValues: false },
            { localPageNumber: 6, extractorNames: ["sections"], pageRole: "policy_form", hasScheduleValues: false },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    const definitionCalls = runExtractor.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.name === "definitions");
    const coveredReasonCalls = runExtractor.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.name === "covered_reasons");

    expect(definitionCalls).toEqual([
      expect.objectContaining({ startPage: 2, endPage: 5 }),
    ]);
    expect(coveredReasonCalls).toEqual([
      expect.objectContaining({ startPage: 2, endPage: 5 }),
    ]);
  });

  it("falls back through sections when covered reasons extraction produces no object", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            { localPageNumber: 1, extractorNames: ["covered_reasons"], pageRole: "policy_form", hasScheduleValues: false },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    runExtractor.mockImplementation(async (arg) => {
      if (arg.name === "covered_reasons") {
        throw new Error("AI_NoOutputGeneratedError: No output generated.");
      }
      if (arg.name === "sections") {
        return {
          name: "sections",
          data: {
            sections: [
              {
                title: "Covered Causes of Loss",
                type: "covered_reason",
                content: "We will pay for direct physical loss caused by fire.",
                pageStart: 1,
              },
            ],
          },
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      }
      return {
        name: arg.name,
        data: {},
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });

    await extractor.extract("full-pdf-base64", "doc-1");

    const memory = assembleDocument.mock.calls[0][2] as Map<string, unknown>;
    expect(memory.get("covered_reasons")).toEqual({
      coveredReasons: [
        expect.objectContaining({
          coverageName: "Covered Causes of Loss",
          title: "Covered Causes of Loss",
          content: "We will pay for direct physical loss caused by fire.",
          pageNumber: 1,
        }),
      ],
    });
  });

  it("fails before assembly when strict quality gate finds blocking issues", async () => {
    safeGenerateObject
      .mockReset()
      .mockResolvedValueOnce({
        object: { documentType: "policy", policyTypes: ["commercial_property"], confidence: 0.95 },
      })
      .mockResolvedValueOnce({
        object: { forms: [] },
      })
      .mockResolvedValueOnce({
        object: {
          pages: [
            {
              localPageNumber: 1,
              extractorNames: ["coverage_limits"],
              pageRole: "declarations_schedule",
              hasScheduleValues: true,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
      });

    runExtractor.mockImplementation(async ({ name }: { name: string }) => {
      if (name === "coverage_limits") {
        return {
          name,
          data: {
            coverages: [
              {
                name: "Commercial Property Coverage Form",
                limit: "",
                formNumber: "PR5070CF",
                pageNumber: 1,
                sectionRef: "Scheduled Coverages",
                originalContent: "Commercial Property Coverage Form | PR5070CF",
              },
            ],
          },
          usage: { inputTokens: 20, outputTokens: 10 },
        };
      }

      return {
        name,
        data: {},
        usage: { inputTokens: 20, outputTokens: 10 },
      };
    });

    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      qualityGate: "strict",
    });

    await expect(extractor.extract("full-pdf-base64", "doc-1")).rejects.toThrow(
      "Extraction quality gate failed",
    );
    expect(assembleDocument).not.toHaveBeenCalled();
  });
});
