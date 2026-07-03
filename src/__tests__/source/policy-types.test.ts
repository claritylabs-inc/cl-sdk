import { describe, expect, it } from "vitest";
import { resolveOperationalProfilePolicyTypes } from "../../source";
import type { OperationalCoverageLine } from "../../source";

describe("operational profile policy type resolution", () => {
  it("infers policy types from extracted coverage labels before using profile hints", () => {
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

    expect(resolveOperationalProfilePolicyTypes({
      profileTypes: ["inland_marine"],
      coverages,
    })).toEqual({
      policyTypes: ["inland_marine", "commercial_auto"],
      source: "coverage",
    });
  });

  it("does not carry incorrect profile hints when coverage evidence is specific", () => {
    expect(resolveOperationalProfilePolicyTypes({
      profileTypes: ["cyber"],
      coverages: [
        {
          name: "Commercial Auto Physical Damage",
          limits: [],
          sourceNodeIds: ["node-apd"],
          sourceSpanIds: ["span-apd"],
        },
      ],
    })).toEqual({
      policyTypes: ["commercial_auto"],
      source: "coverage",
    });
  });

  it("uses profile types only when coverage labels are not classifiable", () => {
    expect(resolveOperationalProfilePolicyTypes({
      profileTypes: ["professional_liability"],
      coverages: [
        {
          name: "Primary Coverage",
          limits: [],
          sourceNodeIds: ["node-primary"],
          sourceSpanIds: ["span-primary"],
        },
      ],
    })).toEqual({
      policyTypes: ["professional_liability"],
      source: "profile_hint",
    });
  });
});
