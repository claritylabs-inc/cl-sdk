import { describe, it, expect } from "vitest";
import { mergeExtractorResult } from "../../extraction/merge";

describe("mergeExtractorResult", () => {
  it("merges coverage arrays instead of overwriting earlier extraction output", () => {
    const merged = mergeExtractorResult(
      "coverage_limits",
      {
        coverages: [
          { name: "Business Personal Property", limit: "$350,804", deductible: "$2,500", formNumber: "PR5070CF" },
        ],
        coverageForm: "occurrence",
      },
      {
        coverages: [
          { name: "Professional Fees", limit: "$100,000", deductible: "$2,500", formNumber: "PR5070CF" },
        ],
      },
    ) as { coverages: Array<{ name: string }>; coverageForm: string };

    expect(merged.coverages).toHaveLength(2);
    expect(merged.coverages.map((coverage) => coverage.name)).toEqual([
      "Business Personal Property",
      "Professional Fees",
    ]);
    expect(merged.coverageForm).toBe("occurrence");
  });

  it("deduplicates repeated sections when merging follow-up extractor runs", () => {
    const merged = mergeExtractorResult(
      "sections",
      {
        sections: [
          { title: "Commercial Property Coverage Form", type: "policy_form", pageStart: 7, pageEnd: 12, content: "..." },
        ],
      },
      {
        sections: [
          { title: "Commercial Property Coverage Form", type: "policy_form", pageStart: 7, pageEnd: 12, content: "..." },
          { title: "Common Conditions", type: "condition", pageStart: 25, pageEnd: 27, content: "..." },
        ],
      },
    ) as { sections: Array<{ title: string }> };

    expect(merged.sections).toHaveLength(2);
    expect(merged.sections.map((section) => section.title)).toEqual([
      "Commercial Property Coverage Form",
      "Common Conditions",
    ]);
  });
});
