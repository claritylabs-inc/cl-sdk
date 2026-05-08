import { describe, expect, it } from "vitest";
import { buildPageSourceSpans } from "../../source";
import { findSourceSpansForRecord, groundExtractionMemoryWithSourceSpans } from "../../extraction/source-grounding";

describe("extraction source grounding", () => {
  it("matches records to source spans by page and content", () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 3,
        text: "Building coverage limit is $1,000,000 with deductible $5,000.",
      },
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 4,
        text: "Water exclusion applies.",
      },
    ]);

    const matches = findSourceSpansForRecord({
      name: "Building",
      limit: "$1,000,000",
      pageNumber: 3,
    }, sourceSpans);

    expect(matches.map((span) => span.id)).toEqual([sourceSpans[0].id]);
  });

  it("adds source span IDs and text hashes to repeated extraction records", () => {
    const sourceSpans = buildPageSourceSpans([
      {
        documentId: "doc-1",
        sourceKind: "policy_pdf",
        pageNumber: 5,
        formNumber: "CP 00 10",
        text: "Water exclusion applies to flood and sewer backup.",
      },
    ]);
    const memory = new Map<string, unknown>([
      ["exclusions", {
        exclusions: [{
          name: "Water",
          formNumber: "CP 00 10",
          content: "Water exclusion applies to flood and sewer backup.",
          pageNumber: 5,
        }],
      }],
    ]);

    groundExtractionMemoryWithSourceSpans(memory, sourceSpans);

    expect(memory.get("exclusions")).toEqual({
      exclusions: [
        expect.objectContaining({
          sourceSpanIds: [sourceSpans[0].id],
          sourceTextHash: sourceSpans[0].textHash,
        }),
      ],
    });
  });
});
