import { describe, expect, it } from "vitest";
import { assembleDocument } from "../../extraction/assembler";

describe("assembleDocument", () => {
  it("plumbs definitions and covered reasons from extractor memory", () => {
    const memory = new Map<string, unknown>([
      ["carrier_info", { carrierName: "Test Carrier", policyNumber: "P-1", effectiveDate: "01/01/2025" }],
      ["named_insured", { insuredName: "Test Insured" }],
      ["coverage_limits", { coverages: [] }],
      ["definitions", { definitions: [{ term: "Covered Cause of Loss", definition: "See policy form" }] }],
      ["covered_reasons", { coveredReasons: [{ coverageName: "Property", title: "Fire", content: "Fire is covered." }] }],
    ]);

    const doc = assembleDocument("doc-1", "policy", memory) as any;

    expect(doc.definitions).toEqual([
      expect.objectContaining({ term: "Covered Cause of Loss", definition: "See policy form" }),
    ]);
    expect(doc.definitions[0].recordId).toMatch(/^definition:doc_1:/);
    expect(doc.coveredReasons).toEqual([
      expect.objectContaining({ coverageName: "Property", title: "Fire", content: "Fire is covered." }),
    ]);
    expect(doc.coveredReasons[0].recordId).toMatch(/^covered_reason:doc_1:/);
  });

  it("accepts snake_case covered reasons from extractor memory", () => {
    const memory = new Map<string, unknown>([
      ["carrier_info", { carrierName: "Test Carrier", policyNumber: "P-1", effectiveDate: "01/01/2025" }],
      ["named_insured", { insuredName: "Test Insured" }],
      ["coverage_limits", { coverages: [] }],
      ["covered_reasons", { covered_reasons: [{ coverageName: "Property", title: "Wind", content: "Wind is covered." }] }],
    ]);

    const doc = assembleDocument("doc-1", "policy", memory) as any;

    expect(doc.coveredReasons).toEqual([
      expect.objectContaining({ coverageName: "Property", title: "Wind", content: "Wind is covered." }),
    ]);
    expect(doc.coveredReasons[0].recordId).toMatch(/^covered_reason:doc_1:/);
  });
});
