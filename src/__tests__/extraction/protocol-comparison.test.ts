import { describe, expect, it } from "vitest";
import {
  compareExtractionProtocolCorpus,
  type ExtractionProtocolFixture,
} from "../../extraction/protocol-comparison";

function cited(value: string, sourceSpanId: string) {
  return {
    value,
    confidence: "high" as const,
    sourceNodeIds: [`node-${sourceSpanId}`],
    sourceSpanIds: [sourceSpanId],
  };
}

const representativeCorpus: ExtractionProtocolFixture[] = [
  {
    id: "general-liability-declarations",
    v1: {
      policyNumber: cited("GL-100", "span-policy"),
      namedInsured: cited("Example Holdings LLC", "span-insured"),
      insurer: cited("Example Insurance Co.", "span-carrier"),
      effectiveDate: cited("01/01/2026", "span-effective"),
      expirationDate: cited("01/01/2027", "span-expiration"),
      coverages: [{
        name: "Each Occurrence",
        coverageCode: "CGL_EACH_OCC",
        sourceNodeIds: ["node-gl"],
        sourceSpanIds: ["span-gl"],
        limits: [],
      }],
    },
    v2: {
      policyNumber: cited("GL100", "span-policy"),
      namedInsured: cited("Example Holdings LLC", "span-insured"),
      insurer: cited("Example Insurance Co", "span-carrier"),
      effectiveDate: cited("01-01-2026", "span-effective"),
      expirationDate: cited("01-01-2027", "span-expiration"),
      coverages: [{
        name: "Commercial General Liability – Each Occurrence",
        coverageCode: "CGL_EACH_OCC",
        sourceNodeIds: ["node-gl"],
        sourceSpanIds: ["span-gl"],
        limits: [],
      }],
    },
  },
  {
    id: "property-schedule",
    v1: {
      policyNumber: cited("PROP-22", "span-property-policy"),
      coverages: [{
        name: "Building",
        sourceNodeIds: ["node-building"],
        sourceSpanIds: ["span-building"],
        limits: [],
      }],
    },
    v2: {
      policyNumber: cited("PROP-22", "span-property-policy"),
      coverages: [{
        name: "Building Coverage",
        sourceNodeIds: ["node-building"],
        sourceSpanIds: ["span-building"],
        limits: [],
      }],
    },
  },
  {
    id: "party-changing-endorsement",
    v1: {
      namedInsured: cited("Example Holdings LLC", "span-endorsement-party"),
      coverages: [],
    },
    v2: {
      namedInsured: cited("Example Holdings LLC", "span-endorsement-party"),
      coverages: [],
    },
  },
];

describe("extraction protocol shadow comparison", () => {
  it("accepts a representative corpus with no critical-fact or coverage recall regression", () => {
    const comparison = compareExtractionProtocolCorpus(representativeCorpus);

    expect(comparison).toMatchObject({
      fixtureCount: 3,
      passedFixtureCount: 3,
      failedFixtureCount: 0,
      criticalFactRegressionCount: 0,
      coverageRecallRegressionCount: 0,
      passed: true,
    });
  });

  it("blocks activation when a cited critical fact or coverage disappears", () => {
    const comparison = compareExtractionProtocolCorpus([{
      id: "regression",
      v1: representativeCorpus[0]!.v1,
      v2: { coverages: [] },
    }]);

    expect(comparison.passed).toBe(false);
    expect(comparison.criticalFactRegressionCount).toBeGreaterThan(0);
    expect(comparison.coverageRecallRegressionCount).toBe(1);
  });

  it("does not count an uncited matching coverage as preserved recall", () => {
    const comparison = compareExtractionProtocolCorpus([{
      id: "uncited-coverage",
      v1: representativeCorpus[0]!.v1,
      v2: {
        ...representativeCorpus[0]!.v2,
        coverages: [{
          name: "Each Occurrence",
          coverageCode: "CGL_EACH_OCC",
          sourceNodeIds: [],
          sourceSpanIds: [],
          limits: [],
        }],
      },
    }]);

    expect(comparison.coverageRecallRegressionCount).toBe(1);
    expect(comparison.passed).toBe(false);
  });
});
