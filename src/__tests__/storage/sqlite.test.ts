import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSqliteStore } from "../../storage/sqlite/index";
import type { PolicyDocument } from "../../schemas/document";

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
});
