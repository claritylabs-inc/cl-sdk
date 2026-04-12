// src/__tests__/extraction/coordinator.test.ts
import { describe, it, expect, vi } from "vitest";
import { createExtractor } from "../../extraction/coordinator";

describe("createExtractor", () => {
  it("returns an object with extract method", () => {
    const extractor = createExtractor({
      generateText: vi.fn(),
      generateObject: vi.fn(),
    });
    expect(typeof extractor.extract).toBe("function");
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
