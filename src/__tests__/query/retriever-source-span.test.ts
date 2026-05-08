import { describe, expect, it, vi } from "vitest";
import { retrieve } from "../../query/retriever";
import type { DocumentStore, MemoryStore } from "../../storage/interfaces";
import type { DocumentChunk } from "../../storage/chunk-types";
import type { SourceRetriever } from "../../source";

describe("query retriever source-span support", () => {
  it("combines source-span and chunk evidence in deterministic hybrid order", async () => {
    const documentStore: DocumentStore = {
      save: vi.fn(),
      get: vi.fn(),
      query: vi.fn(async () => []),
      delete: vi.fn(),
    };
    const memoryStore: MemoryStore = {
      addChunks: vi.fn(),
      search: vi.fn(async (): Promise<DocumentChunk[]> => [
        {
          id: "doc-1:coverage:b",
          documentId: "doc-1",
          type: "coverage",
          text: "Coverage B chunk",
          metadata: {},
        },
      ]),
      addTurn: vi.fn(),
      getHistory: vi.fn(async () => []),
      searchHistory: vi.fn(async () => []),
    };
    const sourceRetriever: SourceRetriever = {
      searchSourceSpans: vi.fn(async () => [
        {
          span: {
            id: "doc-1:span:a",
            documentId: "doc-1",
            chunkId: "doc-1:coverage:a",
            kind: "pdf_text" as const,
            text: "Coverage A source span",
            hash: "hash-a",
            location: { page: 2 },
          },
          relevance: 0.8,
        },
      ]),
    };

    const result = await retrieve(
      { question: "What is covered?", intent: "policy_question" },
      undefined,
      {
        documentStore,
        memoryStore,
        sourceRetriever,
        retrievalLimit: 10,
        retrievalMode: "hybrid",
      },
    );

    expect(sourceRetriever.searchSourceSpans).toHaveBeenCalledWith({
      question: "What is covered?",
      limit: 10,
      mode: "hybrid",
    });
    expect(result.evidence.map((item) => item.sourceSpanId ?? item.chunkId)).toEqual([
      "doc-1:coverage:b",
      "doc-1:span:a",
    ]);
  });

  it("uses source spans in long-context mode when a source retriever is available", async () => {
    const documentStore: DocumentStore = {
      save: vi.fn(),
      get: vi.fn(),
      query: vi.fn(async () => []),
      delete: vi.fn(),
    };
    const memoryStore: MemoryStore = {
      addChunks: vi.fn(),
      search: vi.fn(async (): Promise<DocumentChunk[]> => []),
      addTurn: vi.fn(),
      getHistory: vi.fn(async () => []),
      searchHistory: vi.fn(async () => []),
    };
    const sourceRetriever: SourceRetriever = {
      searchSourceSpans: vi.fn(async () => [
        {
          span: {
            id: "doc-1:span:full",
            documentId: "doc-1",
            kind: "pdf_text" as const,
            text: "Full policy source text with limit $1,000,000.",
            hash: "hash-full",
          },
          relevance: 0.95,
        },
      ]),
    };

    const result = await retrieve(
      { question: "What is the limit?", intent: "policy_question" },
      undefined,
      {
        documentStore,
        memoryStore,
        sourceRetriever,
        retrievalLimit: 4,
        retrievalMode: "long_context",
      },
    );

    expect(sourceRetriever.searchSourceSpans).toHaveBeenCalledWith({
      question: "What is the limit?",
      limit: 4,
      mode: "long_context",
    });
    expect(memoryStore.search).not.toHaveBeenCalled();
    expect(result.evidence).toEqual([
      expect.objectContaining({
        source: "source_span",
        sourceSpanId: "doc-1:span:full",
        retrievalMode: "long_context",
      }),
    ]);
  });
});
