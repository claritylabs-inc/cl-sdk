import { describe, expect, it } from "vitest";
import { resolveOperationalProfileLinesOfBusiness } from "../../source";
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
});
