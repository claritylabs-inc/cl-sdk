import { describe, expect, it, vi } from "vitest";
import {
  cleanupCoverageDecision,
  sourceValueCandidates,
  verifyExtractionDecision,
} from "../../extraction/decisions";
import { runCoverageRecovery } from "../../extraction/coverage-recovery";
import {
  buildSourceSpan,
  buildDocumentSourceTree,
  buildExtractionEvidenceLedger,
  buildExtractionSourceCoverageMap,
  PolicyOperationalProfileSchema,
} from "../../source";
import { decisionTestConfig } from "../fixtures/decision-test-helpers";
import type { GenerateObject } from "../../core/types";

const spans = [
  buildSourceSpan(
    {
      documentId: "d",
      sourceKind: "policy_pdf",
      pageStart: 1,
      pageEnd: 1,
      text: "Commercial General Liability. Each occurrence limit $1,000,000. Deductible $500.",
    },
    0,
  ),
];
const tree = buildDocumentSourceTree(spans, "d");
const profile = PolicyOperationalProfileSchema.parse({
  documentType: "policy",
  linesOfBusiness: ["CGL"],
  coverages: [
    {
      name: "Commercial General Liability",
      lineOfBusiness: "CGL",
      limit: "$1,000,000",
      deductible: "$500",
      sourceSpanIds: [spans[0].id],
      sourceNodeIds: [],
      limits: [],
    },
  ],
});
const keep = (id: string) =>
  id.endsWith("action")
    ? "keep"
    : id.endsWith("lob")
      ? "CGL"
      : id.endsWith("supported")
        ? 1
        : id.endsWith("contradiction") || id.endsWith("missing")
          ? 0
          : "unchanged";

describe("source-backed extraction decisions", () => {
  it("uses current cleanup call shape without changing independent evidence/source coverage", async () => {
    const before = buildExtractionEvidenceLedger(spans, tree);
    const coverageBefore = buildExtractionSourceCoverageMap(spans, tree);
    const fallback = vi.fn(async () => ({
      operationalProfile: profile,
      warnings: [],
    }));
    const result = await cleanupCoverageDecision({
      sourceTree: tree,
      sourceSpans: spans,
      operationalProfile: profile,
      decisions: decisionTestConfig("extraction.cleanup", keep),
      fallback,
    });
    expect(result.operationalProfile.coverages).toHaveLength(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(buildExtractionEvidenceLedger(spans, tree)).toEqual(before);
    expect(buildExtractionSourceCoverageMap(spans, tree)).toEqual(
      coverageBefore,
    );
  });
  it.each(["contradiction", "missing"])(
    "escalates %s evidence and leaves source-backed rows intact",
    async (issue) => {
      const fallback = vi.fn(async () => ({
        operationalProfile: profile,
        warnings: ["reasoning"],
      }));
      const result = await cleanupCoverageDecision({
        sourceTree: tree,
        sourceSpans: spans,
        operationalProfile: profile,
        decisions: decisionTestConfig("extraction.cleanup", (id) =>
          id.endsWith(issue) ? 1 : keep(id),
        ),
        fallback,
      });
      expect(result.operationalProfile).toBe(profile);
      expect(fallback).toHaveBeenCalledOnce();
    },
  );
  it("does not infer a value from enumeration or accept a missing candidate", async () => {
    const candidates = sourceValueCandidates(spans);
    expect(candidates.some((c) => c.value === "$1,000,000")).toBe(true);
    const fallback = vi.fn(async () => ({
      operationalProfile: profile,
      warnings: [],
    }));
    await cleanupCoverageDecision({
      sourceTree: tree,
      sourceSpans: spans,
      operationalProfile: profile,
      decisions: decisionTestConfig("extraction.cleanup", (id) =>
        id.endsWith("limit") ? "__abstain__" : keep(id),
      ),
      fallback,
    });
    expect(fallback).toHaveBeenCalledOnce();
    expect(profile.coverages[0].limit).toBe("$1,000,000");
  });
  it("targets uncertain and omitted fields for a single reasoning repair", async () => {
    const repaired = {
      policyNumber: { value: "fixed", sourceSpanIds: [spans[0].id] },
    };
    const repair = vi.fn(async (_fields: string[]) => repaired);
    const value = {
      policyNumber: { value: "wrong", sourceSpanIds: [spans[0].id] },
    };
    const result = await verifyExtractionDecision({
      value,
      sourceSpans: spans,
      decisions: decisionTestConfig("extraction.verify", (id) =>
        id === "omitted" || id.endsWith("contradiction") ? 1 : 0,
      ),
      repair,
    });
    expect(result).toBe(repaired);
    expect(repair).toHaveBeenCalledOnce();
    expect(repair.mock.calls[0][0]).toContain("policyNumber.value");
  });
  it("shadow verification never repairs or mutates reasoning output", async () => {
    const config = decisionTestConfig("extraction.verify", () => 0);
    config.decisionPolicy!.families!["extraction.verify"].mode = "shadow";
    const repair = vi.fn(async () => profile);
    expect(
      await verifyExtractionDecision({
        value: profile,
        sourceSpans: spans,
        decisions: config,
        repair,
      }),
    ).toBe(profile);
    expect(repair).not.toHaveBeenCalled();
  });
  it("standalone recovery uses top-level callback/config and retains novel extraction", async () => {
    const generate = vi.fn(async () => ({
      object: {
        coverages: [],
        coverageSchedules: [],
        premiumBreakdown: [],
        taxesAndFees: [],
        warnings: [],
      },
    })) as unknown as GenerateObject;
    const onDecision = vi.fn();
    const result = await runCoverageRecovery({
      sourceTree: tree,
      sourceSpans: spans,
      operationalProfile: profile,
      generateObject: generate,
      ...decisionTestConfig("extraction.recovery_regions", () => 1),
      onDecision,
    });
    expect(result.diagnostics.regionCount).toBe(1);
    expect(generate).toHaveBeenCalledOnce();
    expect(onDecision.mock.calls[0][0].outcome).toBe("accepted");
    expect(result.operationalProfile.coverages).toHaveLength(1);
  });
});
