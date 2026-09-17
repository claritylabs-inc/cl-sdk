import { describe, expect, it } from "vitest";
import {
  evaluateDecisionGate,
  type DecisionEvaluationSample,
} from "../../core/decision-evaluation";
const sample = (
  id: string,
  split: "calibration" | "held_out",
): DecisionEvaluationSample => ({
  id,
  split,
  origin: "representative",
  family: "test",
  baselineCorrect: true,
  decisionCorrect: true,
  accepted: true,
  baselineDurationMs: 100,
  decisionDurationMs: 90,
  baselineCostNanoUsd: 100,
  decisionCostNanoUsd: 90,
});
const options = {
  family: "test",
  risk: "consequential" as const,
  minimumHeldOut: 1,
  minimumAccepted: 1,
};
describe("decision evaluation gates", () => {
  it("never qualifies synthetic fixtures or unknown workflow costs", () => {
    const gate = evaluateDecisionGate({
      ...options,
      samples: [
        sample("cal", "calibration"),
        {
          ...sample("held", "held_out"),
          origin: "synthetic",
          decisionCostNanoUsd: null,
        },
      ],
    });
    expect(gate.qualified).toBe(false);
    expect(gate.reasons).toContain("representative_corpus_required");
    expect(gate.decisionCostNanoUsd).toBeNull();
  });
  it("rejects leaked splits and consequential false acceptance", () => {
    const gate = evaluateDecisionGate({
      ...options,
      samples: [
        sample("same", "calibration"),
        { ...sample("same", "held_out"), decisionCorrect: false },
      ],
    });
    expect(gate.reasons).toContain("duplicate_or_leaked_sample");
    expect(gate.reasons).toContain("consequential_false_acceptance");
  });
  it("permits at most five points reversible regression", () => {
    const samples = [
      sample("cal", "calibration"),
      ...Array.from({ length: 20 }, (_, i) => ({
        ...sample(`held${i}`, "held_out"),
        decisionCorrect: i > 0,
      })),
    ];
    expect(
      evaluateDecisionGate({ ...options, risk: "reversible", samples })
        .qualified,
    ).toBe(true);
    samples[2].decisionCorrect = false;
    expect(
      evaluateDecisionGate({ ...options, risk: "reversible", samples })
        .qualified,
    ).toBe(false);
  });
});
