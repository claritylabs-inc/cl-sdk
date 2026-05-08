import { describe, expect, it } from "vitest";
import {
  buildPageSourceSpans,
  buildSourceSpan,
  buildTextSourceSpans,
  chunkSourceSpans,
  MemorySourceStore,
} from "../../source";

describe("source extraction and store", () => {
  it("builds plan-shaped deterministic page spans with text hashes", () => {
    const spans = buildPageSourceSpans([
      {
        documentId: "policy-1",
        sourceKind: "policy_pdf",
        pageNumber: 2,
        text: " Limit: $1,000,000\nDeductible: $5,000 ",
        formNumber: "CP 00 10",
      },
    ]);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^policy-1:span:2:0:/),
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      pageStart: 2,
      pageEnd: 2,
      formNumber: "CP 00 10",
      text: "Limit: $1,000,000 Deductible: $5,000",
    }));
    expect(spans[0].hash).toBe(spans[0].textHash);
  });

  it("chunks source spans with stable source span references", () => {
    const spans = [
      buildSourceSpan({ documentId: "policy-1", sourceKind: "policy_pdf", pageStart: 1, pageEnd: 1, text: "Carrier ABC" }, 0),
      buildSourceSpan({ documentId: "policy-1", sourceKind: "policy_pdf", pageStart: 2, pageEnd: 2, text: "Policy number P-1" }, 1),
    ];

    const chunks = chunkSourceSpans(spans, { maxChars: 1000 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(expect.objectContaining({
      documentId: "policy-1",
      sourceSpanIds: spans.map((span) => span.id),
      pageStart: 1,
      pageEnd: 2,
    }));
  });

  it("splits long email or attachment text into deterministic spans", () => {
    const spans = buildTextSourceSpans({
      documentId: "email-1",
      sourceKind: "email",
      text: "Add location 10 Main St. Effective 06/01/2026.",
      metadata: { messageId: "msg-1" },
    }, { maxChars: 20 });

    expect(spans.length).toBeGreaterThan(1);
    expect(spans[0].sourceKind).toBe("email");
    expect(spans[0].metadata?.messageId).toBe("msg-1");
  });

  it("persists and searches source spans deterministically", async () => {
    const store = new MemorySourceStore();
    const spans = buildPageSourceSpans([
      { documentId: "policy-1", pageNumber: 1, text: "Building limit is $1,000,000." },
      { documentId: "policy-1", pageNumber: 2, text: "Water exclusion applies." },
    ]);
    await store.addSourceSpans(spans);

    const results = await store.searchSourceSpans({
      question: "What is the building limit?",
      documentIds: ["policy-1"],
      limit: 2,
    });

    expect(results[0].span.id).toBe(spans[0].id);
    expect(await store.getSourceSpan(spans[0].id)).toEqual(spans[0]);
    expect(await store.getSourceSpansByDocument("policy-1")).toHaveLength(2);
  });

  it("honors chunk filters without matching unchunked spans", async () => {
    const store = new MemorySourceStore();
    const spans = [
      buildSourceSpan({ documentId: "policy-1", sourceKind: "policy_pdf", text: "Limit is $1,000,000." }, 0),
      { ...buildSourceSpan({ documentId: "policy-1", sourceKind: "policy_pdf", text: "Deductible is $5,000." }, 1), chunkId: "chunk-1" },
    ];
    await store.addSourceSpans(spans);

    const results = await store.searchSourceSpans({
      question: "limit deductible",
      chunkIds: ["chunk-1"],
    });

    expect(results.map((result) => result.span.id)).toEqual([spans[1].id]);
  });
});
