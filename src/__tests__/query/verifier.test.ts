import { describe, expect, it, vi } from "vitest";
import { verify } from "../../query/verifier";
import type { GenerateObject } from "../../core/types";
import type { EvidenceItem, SubAnswer } from "../../schemas/query";

describe("query verifier deterministic grounding", () => {
  it("rejects numeric claims without chunk or source-span evidence even when model approves", async () => {
    const generateObject = vi.fn<GenerateObject>(async ({ schema }) => ({
      object: schema.parse({
        approved: true,
        issues: [],
      }),
    }));
    const subAnswers: SubAnswer[] = [
      {
        subQuestion: "What is the limit?",
        answer: "The limit is $1,000,000.",
        citations: [
          {
            index: 1,
            chunkId: "doc-summary",
            documentId: "doc-1",
            quote: "Limit: $1,000,000",
            relevance: 0.9,
          },
        ],
        confidence: 0.8,
        needsMoreContext: false,
      },
    ];
    const evidence: EvidenceItem[] = [
      {
        source: "document",
        chunkId: "doc-summary",
        documentId: "doc-1",
        text: "Limit: $1,000,000",
        relevance: 0.9,
      },
    ];

    const result = await verify("What is the limit?", subAnswers, evidence, { generateObject });

    expect(result.result.approved).toBe(false);
    expect(result.result.issues).toEqual([
      expect.stringContaining("without chunk or source-span evidence"),
    ]);
    expect(result.result.retrySubQuestions).toEqual(["What is the limit?"]);
  });

  it("approves numeric claims grounded by source spans", async () => {
    const generateObject = vi.fn<GenerateObject>(async ({ schema }) => ({
      object: schema.parse({
        approved: true,
        issues: [],
      }),
    }));
    const subAnswers: SubAnswer[] = [
      {
        subQuestion: "What is the limit?",
        answer: "The limit is $1,000,000.",
        citations: [
          {
            index: 1,
            chunkId: "doc-1:source:1",
            sourceSpanId: "doc-1:span:1:0:abcd",
            documentId: "doc-1",
            quote: "Limit: $1,000,000",
            relevance: 0.9,
          },
        ],
        confidence: 0.8,
        needsMoreContext: false,
      },
    ];
    const evidence: EvidenceItem[] = [
      {
        source: "source_span",
        sourceSpanId: "doc-1:span:1:0:abcd",
        chunkId: "doc-1:source:1",
        documentId: "doc-1",
        text: "Limit: $1,000,000",
        relevance: 0.9,
      },
    ];

    const result = await verify("What is the limit?", subAnswers, evidence, { generateObject });

    expect(result.result.approved).toBe(true);
    expect(result.result.issues).toEqual([]);
  });
});
