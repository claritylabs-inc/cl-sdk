import { describe, expect, it, vi } from "vitest";
import type { GenerateObject } from "../../core/types";
import { findReferencedPages, parseReferenceTarget } from "../../extraction/resolve-referential";

describe("referential workflow", () => {
  it("preserves referential target text for the model", () => {
    expect(parseReferenceTarget("Shown in the Declarations")).toBe("Shown in the Declarations");
    expect(parseReferenceTarget("As stated in Section 4 of Policy")).toBe("As stated in Section 4 of Policy");
    expect(parseReferenceTarget("If applicable")).toBe("If applicable");
    expect(parseReferenceTarget("   ")).toBeUndefined();
  });

  it("uses the model to locate referenced pages", async () => {
    const trackUsage = vi.fn();
    const generateObject = vi.fn().mockResolvedValue({
      object: { startPage: 9, endPage: 10 },
      usage: { inputTokens: 12, outputTokens: 3 },
    }) as unknown as GenerateObject;

    await expect(
      findReferencedPages({
        referenceTarget: "Section 8",
        sections: [],
        formInventory: [],
        pdfInput: { fileId: "file-123", mimeType: "application/pdf" },
        pageCount: 12,
        generateObject,
        trackUsage,
      }),
    ).resolves.toEqual({ startPage: 9, endPage: 10 });

    expect(generateObject).toHaveBeenCalledOnce();
    expect(generateObject).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('referenced as "Section 8"'),
    }));
    expect(trackUsage).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: 3 });
  });
});
