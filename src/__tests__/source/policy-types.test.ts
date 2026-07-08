import { describe, expect, it } from "vitest";
import {
  annotateOperationalCoverageLinesOfBusiness,
  inferLineOfBusinessForOperationalCoverage,
  resolveOperationalProfileLinesOfBusiness,
} from "../../source";
import type { OperationalCoverageLine } from "../../source";

describe("operational profile line of business resolution", () => {
  it("infers ACORD lines of business from extracted coverage labels before using profile hints", () => {
    const coverages: OperationalCoverageLine[] = [
      {
        name: "Motor Truck Cargo Legal Liability",
        limits: [],
        sourceNodeIds: ["node-mtc"],
        sourceSpanIds: ["span-mtc"],
      },
      {
        name: "Commercial Auto Physical Damage",
        limits: [],
        sourceNodeIds: ["node-apd"],
        sourceSpanIds: ["span-apd"],
      },
    ];

    expect(resolveOperationalProfileLinesOfBusiness({
      profileLinesOfBusiness: ["inland_marine"],
      coverages,
    })).toEqual({
      linesOfBusiness: ["INMRC", "AUTOB"],
      source: "coverage",
    });
  });

  it("does not carry incorrect profile hints when coverage evidence is specific", () => {
    expect(resolveOperationalProfileLinesOfBusiness({
      profileLinesOfBusiness: ["cyber"],
      coverages: [
        {
          name: "Commercial Auto Physical Damage",
          limits: [],
          sourceNodeIds: ["node-apd"],
          sourceSpanIds: ["span-apd"],
        },
      ],
    })).toEqual({
      linesOfBusiness: ["AUTOB"],
      source: "coverage",
    });
  });

  it("uses profile lines only when coverage labels are not classifiable", () => {
    expect(resolveOperationalProfileLinesOfBusiness({
      profileLinesOfBusiness: ["professional_liability"],
      coverages: [
        {
          name: "Primary Coverage",
          limits: [],
          sourceNodeIds: ["node-primary"],
          sourceSpanIds: ["span-primary"],
        },
      ],
    })).toEqual({
      linesOfBusiness: ["EO"],
      source: "profile_hint",
    });
  });

  it("uses explicit coverage line of business before inferring from labels", () => {
    const coverage: OperationalCoverageLine = {
      name: "General Liability",
      lineOfBusiness: "CGL",
      limits: [],
      sourceNodeIds: ["node-gl"],
      sourceSpanIds: ["span-gl"],
    };

    expect(inferLineOfBusinessForOperationalCoverage(coverage, ["EO"])).toBe("CGL");
  });

  it("uses the single policy line as a fallback for unclassified coverage rows", () => {
    const coverages: OperationalCoverageLine[] = [
      {
        name: "Primary Coverage",
        limits: [],
        sourceNodeIds: ["node-primary"],
        sourceSpanIds: ["span-primary"],
      },
    ];

    expect(annotateOperationalCoverageLinesOfBusiness(coverages, ["EO"])).toEqual([
      expect.objectContaining({ lineOfBusiness: "EO" }),
    ]);
  });

  it("leaves ambiguous multi-line package rows unassigned", () => {
    const coverage: OperationalCoverageLine = {
      name: "Package Coverage",
      limits: [
        {
          kind: "aggregate_limit",
          label: "Products-Completed Operations Aggregate",
          value: "$2,000,000",
          sourceNodeIds: ["node-pkg"],
          sourceSpanIds: ["span-pkg"],
        },
      ],
      sourceNodeIds: ["node-pkg"],
      sourceSpanIds: ["span-pkg"],
    };

    expect(inferLineOfBusinessForOperationalCoverage(coverage, ["CGL", "PROPC"])).toBeUndefined();
    expect(annotateOperationalCoverageLinesOfBusiness([coverage], ["CGL", "PROPC"])[0]).not.toHaveProperty("lineOfBusiness");
  });
});
