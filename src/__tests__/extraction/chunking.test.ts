// src/__tests__/extraction/chunking.test.ts
import { describe, it, expect } from "vitest";
import { chunkDocument } from "../../extraction/chunking";
import type { PolicyDocument } from "../../schemas/document";

describe("chunkDocument", () => {
  const doc: PolicyDocument = {
    id: "pol-1",
    type: "policy",
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [
      { name: "General Liability", limit: "$1,000,000" },
      { name: "Property", limit: "$500,000" },
    ],
    endorsements: [
      {
        formNumber: "CG2010",
        title: "Additional Insured",
        endorsementType: "additional_insured",
        content: "Adds additional insured coverage.",
        pageStart: 10,
      },
    ],
  };

  it("creates carrier_info chunk", () => {
    const chunks = chunkDocument(doc);
    const carrier = chunks.find((c) => c.type === "carrier_info");
    expect(carrier).toBeDefined();
    expect(carrier!.text).toContain("Acme Insurance");
    expect(carrier!.id).toBe("pol-1:carrier_info:0");
  });

  it("creates one chunk per coverage", () => {
    const chunks = chunkDocument(doc);
    const coverages = chunks.filter((c) => c.type === "coverage");
    expect(coverages.length).toBe(2);
    expect(coverages[0].metadata.coverageName).toBe("General Liability");
  });

  it("creates endorsement chunks", () => {
    const chunks = chunkDocument(doc);
    const endorsements = chunks.filter((c) => c.type === "endorsement");
    expect(endorsements.length).toBe(1);
  });

  it("assigns deterministic IDs", () => {
    const chunks1 = chunkDocument(doc);
    const chunks2 = chunkDocument(doc);
    expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
  });
});
