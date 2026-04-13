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

vi.mock("../../extraction/pdf", () => ({
  getPdfPageCount: vi.fn().mockResolvedValue(6),
  extractPageRange: vi.fn().mockResolvedValue("mapped-pages-pdf-base64"),
}));

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

describe("createExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
        providerOptions: {
          anthropic: { thinking: true },
          pdfBase64: "full-pdf-base64",
        },
      }),
      expect.any(Object),
    );

    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfBase64: "full-pdf-base64",
        providerOptions: { anthropic: { thinking: true } },
      }),
    );
    expect(result.reviewReport).toEqual(expect.objectContaining({
      qualityGateStatus: expect.stringMatching(/passed|warning|failed/),
      rounds: expect.any(Array),
      artifacts: expect.any(Array),
      issues: expect.any(Array),
      formInventory: expect.any(Array),
    }));
  });

  it("accepts all optional config fields", () => {
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
      convertPdfToImages: vi.fn(),
      concurrency: 4,
      maxReviewRounds: 3,
      onTokenUsage: vi.fn(),
      onProgress: vi.fn(),
      log: vi.fn(),
      providerOptions: { anthropic: {} },
    });
    expect(typeof extractor.extract).toBe("function");
  });

  it("drops coverage_limits from generic form-language page assignments before planning", async () => {
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
      endPage: 1,
    }));
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
