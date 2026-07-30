import { describe, expect, it } from "vitest";
import { mergeOperationalProfile } from "../../source/operational-profile";
import type { PolicyOperationalProfile } from "../../source";

function emptyProfile(): PolicyOperationalProfile {
  return {
    documentType: "policy",
    linesOfBusiness: ["UN"],
    declarationFacts: [],
    coverages: [],
    parties: [],
    endorsementSupport: [],
    sourceNodeIds: [],
    sourceSpanIds: [],
    warnings: [],
  };
}

describe("mergeOperationalProfile taxonomy", () => {
  it("keeps a source-backed product name and assigns unambiguous LOB and CoverageCd values", () => {
    const result = mergeOperationalProfile(
      emptyProfile(),
      {
        productIdentity: {
          name: {
            value: "Trip Cancellation & Interruption Plan",
            confidence: "high",
            sourceNodeIds: ["page-1"],
            sourceSpanIds: ["span-1"],
          },
        },
        coverages: [{
          name: "Travel Delay",
          limits: [],
          sourceNodeIds: ["page-2"],
          sourceSpanIds: ["span-2"],
        }],
      },
      new Set(["page-1", "page-2"]),
      new Set(["span-1", "span-2"]),
    );

    expect(result.productIdentity?.name?.value).toBe(
      "Trip Cancellation & Interruption Plan",
    );
    expect(result.linesOfBusiness).toEqual(["TRVL"]);
    expect(result.coverages[0]).toMatchObject({
      coverageCode: "TVLDL",
      lineOfBusiness: "TRVL",
    });
  });

  it("drops product identity values without valid stored evidence", () => {
    const result = mergeOperationalProfile(
      emptyProfile(),
      {
        productIdentity: {
          name: {
            value: "Uncited Plan",
            confidence: "high",
            sourceNodeIds: ["missing"],
            sourceSpanIds: [],
          },
        },
      },
      new Set(),
      new Set(),
    );

    expect(result.productIdentity).toBeUndefined();
  });
});
