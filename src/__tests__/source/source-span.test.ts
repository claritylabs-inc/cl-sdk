import { describe, expect, it } from "vitest";
import { buildSectionSourceSpans, buildSourceSpanId, orderSourceEvidence, sourceSpanTextHash, stableHash } from "../../source";

describe("source span helpers", () => {
  it("builds deterministic hashes and IDs from normalized source-span inputs", () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
    expect(sourceSpanTextHash("Limit:   $1,000\nDeductible: $500")).toBe(
      sourceSpanTextHash("Limit: $1,000 Deductible: $500"),
    );

    const input = {
      documentId: "policy 1",
      chunkId: "policy 1:coverage:0",
      text: "Limit:   $1,000\nDeductible: $500",
      location: { page: 4, charStart: 12, charEnd: 48 },
    };

    expect(buildSourceSpanId(input)).toBe(buildSourceSpanId({ ...input, text: "Limit: $1,000 Deductible: $500" }));
    expect(buildSourceSpanId(input)).toMatch(/^policy_1:policy_1:coverage:0:/);
  });

  it("orders evidence by relevance and stable source-aware tie-breaks", () => {
    const ordered = orderSourceEvidence([
      {
        source: "chunk",
        chunkId: "chunk-b",
        documentId: "doc-1",
        text: "B",
        relevance: 0.8,
      },
      {
        source: "source_span",
        sourceSpanId: "span-a",
        chunkId: "chunk-a",
        documentId: "doc-1",
        text: "A",
        relevance: 0.8,
      },
      {
        source: "document",
        documentId: "doc-2",
        text: "C",
        relevance: 0.95,
      },
    ]);

    expect(ordered.map((item) => item.sourceSpanId ?? item.chunkId ?? item.documentId)).toEqual([
      "doc-2",
      "chunk-b",
      "span-a",
    ]);
  });

  it("builds deterministic section candidate spans from page text", () => {
    const spans = buildSectionSourceSpans([{
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      pageNumber: 3,
      text: `
SECTION I COVERAGE
We will pay covered damages subject to a limit of $1,000,000 and the terms shown in this section.
This paragraph is long enough to become a source candidate for downstream extraction and Q&A.

EXCLUSIONS
This insurance does not apply to recall expenses or known losses described in the policy wording.
This paragraph is long enough to become a source candidate for deterministic source grounding.
`,
    }]);

    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.sectionId)).toEqual(["SECTION I COVERAGE", "EXCLUSIONS"]);
    expect(spans[0].id).toBe(buildSectionSourceSpans([{
      documentId: "policy-1",
      sourceKind: "policy_pdf",
      pageNumber: 3,
      text: `
SECTION I COVERAGE
We will pay covered damages subject to a limit of $1,000,000 and the terms shown in this section.
This paragraph is long enough to become a source candidate for downstream extraction and Q&A.

EXCLUSIONS
This insurance does not apply to recall expenses or known losses described in the policy wording.
This paragraph is long enough to become a source candidate for deterministic source grounding.
`,
    }])[0].id);
    expect(spans[0].metadata?.sourceUnit).toBe("section_candidate");
  });
});
