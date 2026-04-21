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
});
