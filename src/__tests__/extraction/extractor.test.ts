// src/__tests__/extraction/extractor.test.ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

// Mock extractPageRange to avoid pdf-lib dependency in tests
vi.mock("../../extraction/pdf", () => ({
  extractPageRange: vi.fn().mockResolvedValue("mock-pdf-base64"),
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
      pdfBase64: "base64data",
      startPage: 1,
      endPage: 3,
      generateObject,
    });

    expect(result.name).toBe("carrier_info");
    expect(result.data).toEqual({ name: "Acme" });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(generateObject).toHaveBeenCalledOnce();
  });

  it("includes PDF file reference in prompt when no convertPdfToImages", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await runExtractor({
      name: "test",
      prompt: "Extract value",
      schema,
      pdfBase64: "base64data",
      startPage: 2,
      endPage: 5,
      generateObject,
    });

    const calledPrompt = generateObject.mock.calls[0][0].prompt;
    expect(calledPrompt).toContain("PDF file above");
    expect(calledPrompt).toContain("pages 2-5");
  });

  it("includes image reference in prompt when convertPdfToImages is provided", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    await runExtractor({
      name: "test",
      prompt: "Extract value",
      schema,
      pdfBase64: "base64data",
      startPage: 1,
      endPage: 4,
      generateObject,
      convertPdfToImages: vi.fn(),
    });

    const calledPrompt = generateObject.mock.calls[0][0].prompt;
    expect(calledPrompt).toContain("images above");
    expect(calledPrompt).toContain("pages 1-4");
  });

  it("passes maxTokens and providerOptions through", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn().mockResolvedValue({
      object: { value: "test" },
    });

    await runExtractor({
      name: "test",
      prompt: "Extract",
      schema,
      pdfBase64: "base64data",
      startPage: 1,
      endPage: 1,
      generateObject,
      maxTokens: 8192,
      providerOptions: { anthropic: { thinking: true } },
    });

    const callArgs = generateObject.mock.calls[0][0];
    expect(callArgs.maxTokens).toBe(8192);
    expect(callArgs.providerOptions).toEqual({ anthropic: { thinking: true } });
  });
});
