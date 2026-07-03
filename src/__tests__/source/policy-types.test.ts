import { describe, expect, it } from "vitest";
import { resolveOperationalProfilePolicyTypes } from "../../source";
import type { OperationalCoverageLine } from "../../source";

describe("operational profile policy type resolution", () => {
  it("augments a specific but incomplete profile type from coverage labels", () => {
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
      source: "profile_augmented",
    });
  });
});
