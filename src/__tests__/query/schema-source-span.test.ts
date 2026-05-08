import { describe, expect, it } from "vitest";
import {
  CitationSchema,
  EvidenceItemSchema,
  QueryClassifyResultSchema,
  QueryRetrievalModeSchema,
} from "../../schemas/query";

describe("query source-span schema compatibility", () => {
  it("accepts legacy chunk citations and source-span citations", () => {
    expect(
      CitationSchema.parse({
        index: 1,
        chunkId: "doc-1:coverage:0",
        documentId: "doc-1",
        quote: "Deductible: $500",
        relevance: 0.9,
      }),
    ).toMatchObject({ chunkId: "doc-1:coverage:0" });

    expect(
      CitationSchema.parse({
        index: 2,
        sourceSpanId: "doc-1:span:abc",
        documentId: "doc-1",
        quote: "Limit: $1,000",
        relevance: 0.91,
        retrievalMode: "hybrid",
        sourceLocation: { page: 3, charStart: 12, charEnd: 25 },
      }),
    ).toMatchObject({ sourceSpanId: "doc-1:span:abc", retrievalMode: "hybrid" });
  });

  it("accepts source-span evidence and retrieval mode classification hints", () => {
    expect(QueryRetrievalModeSchema.options).toEqual([
      "graph_only",
      "source_rag",
      "long_context",
      "hybrid",
    ]);

    expect(
      EvidenceItemSchema.parse({
        source: "source_span",
        sourceSpanId: "doc-1:span:abc",
        chunkId: "doc-1:coverage:0",
        documentId: "doc-1",
        text: "Limit: $1,000",
        relevance: 0.93,
        retrievalMode: "source_rag",
      }),
    ).toMatchObject({ source: "source_span", retrievalMode: "source_rag" });

    expect(
      QueryClassifyResultSchema.parse({
        intent: "policy_question",
        subQuestions: [{ question: "What is the limit?", intent: "policy_question" }],
        requiresDocumentLookup: true,
        requiresChunkSearch: true,
        requiresConversationHistory: false,
        retrievalMode: "hybrid",
      }),
    ).toMatchObject({ retrievalMode: "hybrid" });
  });
});
