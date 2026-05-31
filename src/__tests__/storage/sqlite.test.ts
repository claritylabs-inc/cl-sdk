import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStore } from "../../storage/sqlite/index";
import type { PolicyDocument } from "../../schemas/document";
import { buildPageSourceSpans, chunkSourceSpans } from "../../source";

const mockEmbed = async (text: string): Promise<number[]> => {
  const hash = Array.from(text).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Array.from({ length: 8 }, (_, i) => Math.sin(hash + i));
};

describe("SQLite store", () => {
  let store: ReturnType<typeof createSqliteStore>;

  beforeEach(() => {
    store = createSqliteStore({ path: ":memory:", embed: mockEmbed });
  });

  afterEach(() => {
    store.close();
  });

  const testPolicy: PolicyDocument = {
    id: "pol-1",
    type: "policy",
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    documentMetadata: {},
    documentOutline: [],
    coverages: [{ name: "GL", limit: "$1M" }],
  };

  it("saves and retrieves a document", async () => {
    await store.documents.save(testPolicy);
    const result = await store.documents.get("pol-1");
    expect(result).toMatchObject({ id: "pol-1", carrier: "Acme Insurance" });
  });

  it("queries by carrier", async () => {
    await store.documents.save(testPolicy);
    const results = await store.documents.query({ carrier: "Acme" });
    expect(results.length).toBe(1);
  });

  it("deletes a document", async () => {
    await store.documents.save(testPolicy);
    await store.documents.delete("pol-1");
    const result = await store.documents.get("pol-1");
    expect(result).toBeNull();
  });

  it("adds and searches chunks", async () => {
    await store.documents.save(testPolicy);
    await store.memory.addChunks([
      { id: "c1", documentId: "pol-1", type: "coverage", text: "General Liability $1M limit", metadata: { coverageName: "GL" } },
      { id: "c2", documentId: "pol-1", type: "carrier_info", text: "Carrier is State Farm", metadata: {} },
    ]);
    const results = await store.memory.search("liability coverage", { limit: 1 });
    expect(results.length).toBe(1);
  });

  it("adds and retrieves conversation turns", async () => {
    await store.memory.addTurn({
      id: "t1", conversationId: "conv-1", role: "user",
      content: "What are the liability limits?", timestamp: Date.now(),
    });
    const history = await store.memory.getHistory("conv-1");
    expect(history.length).toBe(1);
    expect(history[0].content).toContain("liability limits");
  });

  it("persists and retrieves source spans and source chunks", async () => {
    const spans = buildPageSourceSpans([
      { documentId: "pol-1", sourceKind: "policy_pdf", pageNumber: 1, text: "Building limit is $1,000,000.", formNumber: "CP 00 10" },
      { documentId: "pol-1", sourceKind: "policy_pdf", pageNumber: 2, text: "Water exclusion applies." },
    ]);
    const chunks = chunkSourceSpans(spans);

    await store.source.addSourceSpans(spans);
    await store.source.addSourceChunks(chunks);

    await expect(store.source.getSourceSpan(spans[0].id)).resolves.toEqual(spans[0]);
    await expect(store.source.getSourceSpansByDocument("pol-1")).resolves.toHaveLength(2);
    await expect(store.source.getSourceChunksByDocument("pol-1")).resolves.toHaveLength(1);
  });

  it("searches source spans with deterministic source-span evidence", async () => {
    const spans = buildPageSourceSpans([
      { documentId: "pol-1", sourceKind: "policy_pdf", pageNumber: 1, text: "Building limit is $1,000,000.", formNumber: "CP 00 10" },
      { documentId: "pol-1", sourceKind: "policy_pdf", pageNumber: 2, text: "Water exclusion applies." },
    ]);
    await store.source.addSourceSpans(spans);

    const results = await store.source.searchSourceSpans({
      question: "building limit",
      documentIds: ["pol-1"],
      filters: { formNumber: "CP 00 10" },
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].span.id).toBe(spans[0].id);
  });

  it("bounds chunk embedding concurrency instead of embedding serially", async () => {
    let active = 0;
    let maxActive = 0;
    const concurrentStore = createSqliteStore({
      path: ":memory:",
      embed: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return Array.from({ length: 8 }, (_, index) => index + 1);
      },
    });

    try {
      await concurrentStore.documents.save(testPolicy);
      await concurrentStore.memory.addChunks(Array.from({ length: 6 }, (_, index) => ({
        id: `chunk-${index}`,
        documentId: "pol-1",
        type: "coverage" as const,
        text: `Coverage ${index}`,
        metadata: {},
      })));
    } finally {
      concurrentStore.close();
    }

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("bounds source span embedding concurrency instead of embedding serially", async () => {
    let active = 0;
    let maxActive = 0;
    const concurrentStore = createSqliteStore({
      path: ":memory:",
      embed: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return Array.from({ length: 8 }, (_, index) => index + 1);
      },
    });

    try {
      await concurrentStore.source.addSourceSpans(buildPageSourceSpans(
        Array.from({ length: 6 }, (_, index) => ({
          documentId: "pol-1",
          sourceKind: "policy_pdf" as const,
          pageNumber: index + 1,
          text: `Policy text ${index}`,
        })),
      ));
    } finally {
      concurrentStore.close();
    }

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
