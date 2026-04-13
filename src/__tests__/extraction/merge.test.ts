import { describe, it, expect } from "vitest";
import { mergeExtractorResult } from "../../extraction/merge";

describe("mergeExtractorResult", () => {
  it("merges coverage arrays instead of overwriting earlier extraction output", () => {
    const merged = mergeExtractorResult(
      "coverage_limits",
      {
        coverages: [
          { name: "Business Personal Property", limit: "$350,804", deductible: "$2,500", formNumber: "PR5070CF", pageNumber: 1 },
        ],
        coverageForm: "occurrence",
      },
      {
        coverages: [
          { name: "Professional Fees", limit: "$100,000", deductible: "$2,500", formNumber: "PR5070CF", pageNumber: 2 },
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

  it("preserves newly learned coverage provenance when merging duplicate coverage rows", () => {
    const merged = mergeExtractorResult(
      "coverage_limits",
      {
        coverages: [
          { name: "Business Personal Property", limit: "$350,804", deductible: "$2,500", formNumber: "PR5070CF" },
        ],
      },
      {
        coverages: [
          {
            name: "Business Personal Property",
            limit: "$350,804",
            deductible: "$2,500",
            formNumber: "PR5070CF",
            pageNumber: 1,
            sectionRef: "Commercial Property Declarations",
          },
        ],
      },
    ) as { coverages: Array<{ name: string; pageNumber?: number; sectionRef?: string }> };

    expect(merged.coverages).toHaveLength(1);
    expect(merged.coverages[0]).toMatchObject({
      name: "Business Personal Property",
      pageNumber: 1,
      sectionRef: "Commercial Property Declarations",
    });
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

  it("combines additive exclusions with the same identity across extractor runs", () => {
    const merged = mergeExtractorResult(
      "exclusions",
      {
        exclusions: [
          {
            name: "Nuclear Hazard",
            excludedPerils: ["Nuclear hazard"],
            isAbsolute: true,
            appliesTo: ["Commercial Property Coverage Form"],
            content: "We will not pay for loss or damage caused directly or indirectly by nuclear reaction.",
            pageNumber: 13,
          },
        ],
      },
      {
        exclusions: [
          {
            name: "Nuclear Hazard",
            excludedPerils: ["Nuclear reaction", "Radioactive contamination"],
            isAbsolute: false,
            exceptions: ["If nuclear hazard results in fire, we will pay for the loss or damage caused by that fire."],
            appliesTo: ["Property"],
            content:
              "We will not pay for loss or damage caused directly or indirectly by nuclear reaction, nuclear radiation or radioactive contamination; however, if it results in fire, we will pay for the loss or damage caused by that fire.",
            pageNumber: 14,
          },
        ],
      },
    ) as {
      exclusions: Array<{
        name: string;
        excludedPerils?: string[];
        isAbsolute?: boolean;
        exceptions?: string[];
        appliesTo?: string[];
        content: string;
        pageNumber?: number;
      }>;
    };

    expect(merged.exclusions).toHaveLength(1);
    expect(merged.exclusions[0]).toMatchObject({
      name: "Nuclear Hazard",
      isAbsolute: false,
      pageNumber: 13,
    });
    expect(merged.exclusions[0].excludedPerils).toEqual([
      "Nuclear hazard",
      "Nuclear reaction",
      "Radioactive contamination",
    ]);
    expect(merged.exclusions[0].exceptions).toEqual([
      "If nuclear hazard results in fire, we will pay for the loss or damage caused by that fire.",
    ]);
    expect(merged.exclusions[0].appliesTo).toEqual([
      "Commercial Property Coverage Form",
      "Property",
    ]);
    expect(merged.exclusions[0].content).toContain("radioactive contamination");
  });

  it("keeps same-named exclusions separate when they come from different forms", () => {
    const merged = mergeExtractorResult(
      "exclusions",
      {
        exclusions: [
          {
            name: "By-Laws",
            formNumber: "PR5070CF",
            content: "Base form exclusion text",
          },
        ],
      },
      {
        exclusions: [
          {
            name: "By-Laws",
            formNumber: "PR068END",
            content: "Endorsement-specific carveback text",
          },
        ],
      },
    ) as { exclusions: Array<{ name: string; formNumber?: string }> };

    expect(merged.exclusions).toHaveLength(2);
    expect(merged.exclusions.map((exclusion) => exclusion.formNumber)).toEqual([
      "PR5070CF",
      "PR068END",
    ]);
  });
});
