// src/__tests__/extraction/extractor.test.ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock pdf module to avoid pdf-lib dependency in tests
vi.mock("../../extraction/pdf", () => ({
  extractPageRange: vi.fn().mockResolvedValue("mock-pdf-base64"),
  pdfInputToBase64: vi.fn().mockResolvedValue("base64data"),
}));

import { runExtractor } from "../../extraction/extractor";

describe("runExtractor", () => {
  it("calls generateObject with prompt and schema, returns result", async () => {
    const schema = z.object({ name: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { name: "Acme" },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await runExtractor({
      name: "carrier_info",
      prompt: "Extract carrier info",
      schema,
      pdfInput: "base64data",
      startPage: 1,
      endPage: 3,
      generateObject,
    });

    expect(result.name).toBe("carrier_info");
    expect(result.data).toEqual({ name: "Acme" });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(generateObject).toHaveBeenCalledOnce();
  });

  it("passes a page-scoped PDF to providerOptions when no convertPdfToImages", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await runExtractor({
      name: "test",
      prompt: "Extract value",
      schema,
      pdfInput: "base64data",
      startPage: 2,
      endPage: 5,
      generateObject,
    });

    const callArgs = generateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("provided as a PDF file");
    expect(callArgs.prompt).toContain("pages 2-5");
    expect(callArgs.providerOptions).toEqual({ pdfBase64: "mock-pdf-base64" });
  });

  it("passes images to providerOptions when convertPdfToImages is provided", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const convertPdfToImages = vi.fn().mockResolvedValue([{ imageBase64: "img-1", mimeType: "image/png" }]);

    await runExtractor({
      name: "test",
      prompt: "Extract value",
      schema,
      pdfInput: "base64data",
      startPage: 1,
      endPage: 4,
      generateObject,
      convertPdfToImages,
    });

    const callArgs = generateObject.mock.calls[0][0];
    expect(convertPdfToImages).toHaveBeenCalledWith("base64data", 1, 4);
    expect(callArgs.prompt).toContain("provided as images");
    expect(callArgs.prompt).toContain("pages 1-4");
    expect(callArgs.providerOptions).toEqual({
      images: [{ imageBase64: "img-1", mimeType: "image/png" }],
    });
  });

  it("passes Docling page-range text without slicing a PDF", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const getPageRangeText = vi.fn().mockResolvedValue("Page 2\nBuilding limit $1,000,000");

    await runExtractor({
      name: "test",
      prompt: "Extract value",
      schema,
      startPage: 2,
      endPage: 2,
      generateObject,
      providerOptions: { sourceSpans: [] },
      getPageRangeText,
    });

    const callArgs = generateObject.mock.calls[0][0];
    expect(getPageRangeText).toHaveBeenCalledWith(2, 2);
    expect(callArgs.prompt).toContain("Docling-extracted text");
    expect(callArgs.prompt).toContain("Building limit $1,000,000");
    expect(callArgs.providerOptions).toEqual({
      sourceSpans: [],
      doclingText: "Page 2\nBuilding limit $1,000,000",
      doclingPageRange: { startPage: 2, endPage: 2 },
    });
  });

  it("merges page-scoped PDF into existing providerOptions", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
    });

    await runExtractor({
      name: "test",
      prompt: "Extract",
      schema,
      pdfInput: "base64data",
      startPage: 1,
      endPage: 1,
      generateObject,
      maxTokens: 8192,
      providerOptions: { anthropic: { thinking: true } },
    });

    const callArgs = generateObject.mock.calls[0][0];
    expect(callArgs.maxTokens).toBe(8192);
    expect(callArgs.providerOptions).toEqual({
      anthropic: { thinking: true },
      pdfBase64: "mock-pdf-base64",
    });
  });

  it("adds bounded source-span context for the extracted page range", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
    });

    await runExtractor({
      name: "test",
      prompt: "Extract",
      schema,
      pdfInput: "base64data",
      startPage: 2,
      endPage: 3,
      generateObject,
      providerOptions: {
        sourceSpans: [
          {
            id: "doc:span:1:0:aaa",
            documentId: "doc",
            kind: "pdf_text",
            sourceKind: "policy_pdf",
            text: "Page one",
            hash: "aaa",
            pageStart: 1,
            pageEnd: 1,
          },
          {
            id: "doc:span:2:0:bbb",
            documentId: "doc",
            kind: "pdf_text",
            sourceKind: "policy_pdf",
            text: "Limit: $1,000,000",
            hash: "bbb",
            pageStart: 2,
            pageEnd: 2,
            sectionId: "SECTION I COVERAGE",
          },
        ],
      },
    });

    const callArgs = generateObject.mock.calls[0][0];
    expect(callArgs.prompt).toContain("SOURCE SPANS FOR THESE PAGES");
    expect(callArgs.prompt).toContain("sourceSpan:doc:span:2:0:bbb");
    expect(callArgs.prompt).toContain("SECTION I COVERAGE");
    expect(callArgs.prompt).not.toContain("Page one");
    expect(callArgs.trace).toEqual({
      label: "test pages 2-3",
      extractorName: "test",
      startPage: 2,
      endPage: 3,
      phase: "extractor",
      sourceBacked: true,
    });
  });
});
