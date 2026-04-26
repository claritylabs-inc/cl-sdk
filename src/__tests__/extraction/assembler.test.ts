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
      { term: "Covered Cause of Loss", definition: "See policy form" },
    ]);
    expect(doc.coveredReasons).toEqual([
      { coverageName: "Property", title: "Fire", content: "Fire is covered." },
    ]);
  });
});
