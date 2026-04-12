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
        object: {
          tasks: [
            {
              extractorName: "sections",
              startPage: 2,
              endPage: 4,
              description: "Extract sections from a focused page range",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: { complete: true, missingFields: [], additionalTasks: [] },
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

  it("passes the full PDF to classify and plan, then dispatches worker extraction", async () => {
    const generateText = vi.fn();
    const generateObject = vi.fn();
    const extractor = createExtractor({
      generateText,
      generateObject,
      providerOptions: { anthropic: { thinking: true } },
    });

    await extractor.extract("full-pdf-base64", "doc-1");

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

    expect(runExtractor).toHaveBeenCalledWith(
      expect.objectContaining({
        pdfBase64: "full-pdf-base64",
        startPage: 2,
        endPage: 4,
        providerOptions: { anthropic: { thinking: true } },
      }),
    );
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
});
