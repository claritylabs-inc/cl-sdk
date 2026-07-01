import { describe, expect, it } from "vitest";
import { applyOperationalProfileCleanup, type OperationalProfileCleanup } from "../../extraction/operational-profile-cleanup";
import type { PolicyOperationalProfile } from "../../source";

describe("operational profile cleanup", () => {
  it("reconstructs coverage display limits from scoped limit terms when cleanup returns a bare amount", () => {
    const profile: PolicyOperationalProfile = {
      documentType: "policy",
      policyTypes: ["cyber"],
      coverageTypes: ["Network Security and Privacy Liability"],
      coverages: [{
        name: "Network Security and Privacy Liability",
        limit: "$1,000,000",
        deductible: "$5,000 Each Claim",
        retroactiveDate: "05/01/2025",
        coverageOrigin: "core",
        sourceNodeIds: ["node-coverage-b"],
        sourceSpanIds: ["span-coverage-b"],
        limits: [
          {
            kind: "each_claim_limit",
            label: "Each Claim Limit",
            value: "$1,000,000",
            amount: 1000000,
            sourceNodeIds: ["node-coverage-b"],
            sourceSpanIds: ["span-coverage-b"],
          },
          {
            kind: "aggregate_limit",
            label: "Aggregate Sub-Limit",
            value: "$1,000,000",
            amount: 1000000,
            sourceNodeIds: ["node-coverage-b"],
            sourceSpanIds: ["span-coverage-b"],
          },
          {
            kind: "deductible",
            label: "Deductible Each Claim",
            value: "$5,000",
            amount: 5000,
            sourceNodeIds: ["node-coverage-b"],
            sourceSpanIds: ["span-coverage-b"],
          },
        ],
      }],
      parties: [],
      endorsementSupport: [],
      warnings: [],
      sourceNodeIds: ["node-coverage-b"],
      sourceSpanIds: ["span-coverage-b"],
    };
    const cleanup: OperationalProfileCleanup = {
      coverageDecisions: [{
        coverageIndex: 0,
        action: "update",
        reason: "The row is a real coverage, but the display limit was underspecified.",
        name: undefined,
        limit: "$1,000,000",
        deductible: null,
        premium: null,
        retroactiveDate: null,
        coverageOrigin: undefined,
        sourceNodeIds: [],
        sourceSpanIds: [],
        termDecisions: [],
      }],
      warnings: [],
    };

    const result = applyOperationalProfileCleanup(
      profile,
      cleanup,
      new Set(["node-coverage-b"]),
      new Set(["span-coverage-b"]),
    );

    expect(result.coverages[0]?.limit).toBe("$1,000,000 Each Claim / $1,000,000 Aggregate Sub-Limit");
  });
});
