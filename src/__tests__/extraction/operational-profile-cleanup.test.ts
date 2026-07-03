import { describe, expect, it } from "vitest";
import { applyOperationalProfileCleanup, type OperationalProfileCleanup } from "../../extraction/operational-profile-cleanup";
import type { PolicyOperationalProfile } from "../../source";

describe("operational profile cleanup", () => {
  it("reconstructs coverage display limits from scoped limit terms when cleanup returns a bare amount", () => {
    const profile: PolicyOperationalProfile = {
      documentType: "policy",
      policyTypes: ["cyber"],
      coverages: [{
        name: "Network Security and Privacy Liability",
        limit: "$1,000,000",
        deductible: "$5,000 Each Claim",
        retroactiveDate: "05/01/2025",
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

  it("adds source-backed split terms when cleanup replaces a collapsed combined limit", () => {
    const profile: PolicyOperationalProfile = {
      documentType: "policy",
      policyTypes: ["cyber"],
      coverages: [{
        name: "Network Security and Privacy Liability",
        limit: "$1,000,000 Each Claim / Aggregate",
        deductible: "$5,000 Each Claim",
        retroactiveDate: "05/01/2025",
        sourceNodeIds: ["node-coverage-b"],
        sourceSpanIds: ["span-coverage-b"],
        limits: [
          {
            kind: "each_claim_limit",
            label: "Each Claim / Aggregate",
            value: "$1,000,000 Each Claim / Aggregate",
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
        reason: "The schedule states separate each-claim and aggregate bases.",
        name: undefined,
        limit: null,
        deductible: null,
        premium: null,
        retroactiveDate: null,
        sourceNodeIds: [],
        sourceSpanIds: [],
        termDecisions: [{
          termIndex: 0,
          action: "drop",
          reason: "Combined limit term is replaced by separate source-backed terms.",
          kind: undefined,
          label: undefined,
          value: undefined,
          amount: null,
          appliesTo: null,
          sourceNodeIds: [],
          sourceSpanIds: [],
        }],
        termAdditions: [
          {
            kind: "each_claim_limit",
            label: "Each Claim",
            value: "$1,000,000",
            amount: 1000000,
            appliesTo: null,
            sourceNodeIds: ["node-coverage-b"],
            sourceSpanIds: ["span-coverage-b"],
            reason: "Source row states each claim.",
          },
          {
            kind: "aggregate_limit",
            label: "Aggregate",
            value: "$1,000,000",
            amount: 1000000,
            appliesTo: null,
            sourceNodeIds: ["node-coverage-b"],
            sourceSpanIds: ["span-coverage-b"],
            reason: "Continuation row states aggregate.",
          },
        ],
      }],
      warnings: [],
    };

    const result = applyOperationalProfileCleanup(
      profile,
      cleanup,
      new Set(["node-coverage-b"]),
      new Set(["span-coverage-b"]),
    );

    expect(result.coverages[0]?.limit).toBe("$1,000,000 Each Claim / $1,000,000 Aggregate");
    expect(result.coverages[0]?.limits.map((term) => [term.kind, term.label, term.value])).toEqual([
      ["deductible", "Deductible Each Claim", "$5,000"],
      ["each_claim_limit", "Each Claim", "$1,000,000"],
      ["aggregate_limit", "Aggregate", "$1,000,000"],
    ]);
  });
});
