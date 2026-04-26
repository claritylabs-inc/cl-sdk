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

  it("deduplicates coverage rows by normalized key parts", () => {
    const merged = mergeExtractorResult(
      "coverage_limits",
      {
        coverages: [
          { name: "Personal & Advertising Injury", limit: "$1,000,000", limitType: "per_occurrence" },
        ],
      },
      {
        coverages: [
          { name: "Personal and Advertising Injury", limit: "$1,000,000", limitType: "Per Occurrence", pageNumber: 3 },
        ],
      },
    ) as { coverages: Array<{ name: string; pageNumber?: number }> };

    expect(merged.coverages).toHaveLength(1);
    expect(merged.coverages[0].pageNumber).toBe(3);
  });

  it("keeps occurrence and aggregate coverage rows separate when other values match", () => {
    const merged = mergeExtractorResult(
      "coverage_limits",
      {
        coverages: [
          {
            name: "Causes Of Loss - Earthquake",
            limitType: "per_occurrence",
            limit: "$425,804",
            deductible: "$50,000 / 5%",
            formNumber: "PR080END",
          },
        ],
      },
      {
        coverages: [
          {
            name: "Causes Of Loss - Earthquake",
            limitType: "aggregate",
            limit: "$425,804",
            deductible: "$50,000 / 5%",
            formNumber: "PR080END",
          },
        ],
      },
    ) as { coverages: Array<{ name: string; limitType?: string }> };

    expect(merged.coverages).toHaveLength(2);
    expect(merged.coverages.map((coverage) => coverage.limitType)).toEqual([
      "per_occurrence",
      "aggregate",
    ]);
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

  it("deduplicates supplementary auxiliary facts and contacts across passes", () => {
    const merged = mergeExtractorResult(
      "supplementary",
      {
        auxiliaryFacts: [
          { key: "policyholder_age", value: "42", subject: "Jane Doe", context: "Driver Schedule" },
        ],
        claimsContacts: [
          { name: "Claims Dept", phone: "800-555-1212" },
        ],
      },
      {
        auxiliaryFacts: [
          { key: "policyholder_age", value: "42", subject: "Jane Doe", context: "Driver Schedule" },
          { key: "insured_name", value: "John Doe", context: "Named Insured" },
        ],
        claimsContacts: [
          { name: "Claims Dept", phone: "800-555-1212" },
        ],
      },
    ) as {
      auxiliaryFacts: Array<{ key: string; value: string }>;
      claimsContacts: Array<{ name: string; phone: string }>;
    };

    expect(merged.auxiliaryFacts).toHaveLength(2);
    expect(merged.claimsContacts).toHaveLength(1);
  });

  it("merges covered reasons using the canonical camelCase memory key", () => {
    const merged = mergeExtractorResult(
      "covered_reasons",
      {
        covered_reasons: [
          { title: "Fire", coverageName: "Property", pageNumber: 9 },
        ],
      },
      {
        coveredReasons: [
          { title: "Fire", coverageName: "Property", pageNumber: 9, content: "Fire is covered." },
          { title: "Windstorm", coverageName: "Property", pageNumber: 10 },
        ],
      },
    ) as { coveredReasons: Array<{ title: string; pageNumber?: number; content?: string }>; covered_reasons?: unknown };

    expect(merged.coveredReasons).toHaveLength(2);
    expect(merged.coveredReasons[0].pageNumber).toBe(9);
    expect(merged.coveredReasons[0].content).toBe("Fire is covered.");
    expect(merged.covered_reasons).toBeUndefined();
  });
});
