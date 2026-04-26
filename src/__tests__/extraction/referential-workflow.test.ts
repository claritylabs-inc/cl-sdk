import { describe, expect, it, vi } from "vitest";
import type { GenerateObject } from "../../core/types";
import { findReferencedPages, parseReferenceTarget } from "../../extraction/resolve-referential";
import { decideReferentialResolutionAction } from "../../extraction/referential-workflow";

describe("referential workflow", () => {
  it("parses common referential targets", () => {
    expect(parseReferenceTarget("Shown in the Declarations")).toBe("Declarations");
    expect(parseReferenceTarget("See Schedule of Coverage")).toBe("Schedule of Coverage");
    expect(parseReferenceTarget("As stated in Section 4 of Policy")).toBe("Section 4");
    expect(parseReferenceTarget("As stated for Item 2")).toBe("Item 2");
    expect(parseReferenceTarget("Shown for Premises No. 1")).toBe("Premises No. 1");
    expect(parseReferenceTarget("If applicable")).toBeUndefined();
  });

  it("chooses declarations or schedule pages from memory before page location", () => {
    expect(
      decideReferentialResolutionAction({
        referenceTarget: "Policy",
        sections: [],
        formInventory: [
          { formNumber: "DEC", formType: "declarations", title: "Commercial Property Declarations", pageStart: 1, pageEnd: 2 },
        ],
      }),
    ).toEqual({
      kind: "lookup_pages",
      source: "declarations_schedule",
      pageRange: { startPage: 1, endPage: 2 },
    });

    expect(
      decideReferentialResolutionAction({
        referenceTarget: "Item 3",
        sections: [],
        formInventory: [
          { formNumber: "SCH", formType: "coverage", title: "Scheduled Property Coverage", pageStart: 5, pageEnd: 6 },
        ],
      }),
    ).toEqual({
      kind: "lookup_pages",
      source: "declarations_schedule",
      pageRange: { startPage: 5, endPage: 6 },
    });
  });

  it("chooses extracted sections when inventory does not locate the target", () => {
    expect(
      decideReferentialResolutionAction({
        referenceTarget: "Premises",
        formInventory: [],
        sections: [
          { type: "schedule", title: "Designated Premises Schedule", pageStart: 7, pageEnd: 8 },
        ],
      }),
    ).toEqual({
      kind: "lookup_pages",
      source: "sections",
      pageRange: { startPage: 7, endPage: 8 },
    });
  });

  it("skips unknown targets instead of spending a page-location call", () => {
    expect(
      decideReferentialResolutionAction({
        referenceTarget: undefined,
        formInventory: [],
        sections: [],
      }),
    ).toEqual({ kind: "skip", reason: "no concrete reference target" });
  });

  it("tracks usage for page-location fallback calls", async () => {
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
    expect(trackUsage).toHaveBeenCalledWith({ inputTokens: 12, outputTokens: 3 });
  });
});
