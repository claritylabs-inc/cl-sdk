export interface DecisionEvaluationSample {
  id: string;
  split: "calibration" | "held_out";
  origin: "representative" | "synthetic";
  family: string;
  baselineCorrect: boolean;
  decisionCorrect: boolean;
  accepted: boolean;
  baselineDurationMs: number;
  decisionDurationMs: number;
  /** Total workflow costs, including decision and reasoning fallback. Null means unmeasured. */
  baselineCostNanoUsd: number | null;
  decisionCostNanoUsd: number | null;
}
export interface DecisionEvaluationGate {
  qualified: boolean;
  reasons: string[];
  heldOutSamples: number;
  acceptedSamples: number;
  baselineAccuracy: number | null;
  decisionAccuracy: number | null;
  acceptanceRate: number | null;
  baselineP50Ms: number | null;
  baselineP95Ms: number | null;
  decisionP50Ms: number | null;
  decisionP95Ms: number | null;
  baselineCostNanoUsd: number | null;
  decisionCostNanoUsd: number | null;
}

/** Evaluate paired workflow results. Synthetic fixtures can never qualify production activation. */
export function evaluateDecisionGate(params: {
  family: string;
  risk: "reversible" | "consequential";
  samples: DecisionEvaluationSample[];
  minimumHeldOut: number;
  minimumAccepted: number;
}): DecisionEvaluationGate {
  const rows = params.samples.filter((s) => s.family === params.family);
  const held = rows.filter((s) => s.split === "held_out");
  const calibration = rows.filter((s) => s.split === "calibration");
  const reasons: string[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) reasons.push("duplicate_or_leaked_sample");
    ids.add(row.id);
    if (
      ![row.baselineDurationMs, row.decisionDurationMs].every(
        (n) => Number.isFinite(n) && n >= 0,
      ) ||
      ![row.baselineCostNanoUsd, row.decisionCostNanoUsd].every(
        (n) => n === null || (Number.isSafeInteger(n) && n >= 0),
      )
    )
      reasons.push("invalid_measurement");
  }
  const accepted = held.filter((s) => s.accepted);
  if (
    !Number.isSafeInteger(params.minimumHeldOut) ||
    params.minimumHeldOut < 1 ||
    !Number.isSafeInteger(params.minimumAccepted) ||
    params.minimumAccepted < 1
  )
    reasons.push("invalid_sample_requirement");
  if (!calibration.length) reasons.push("calibration_required");
  if (
    !held.length ||
    held.length < params.minimumHeldOut ||
    accepted.length < params.minimumAccepted
  )
    reasons.push("insufficient_held_out_samples");
  if (rows.some((s) => s.origin !== "representative"))
    reasons.push("representative_corpus_required");
  const baselineAccuracy = held.length
    ? held.filter((s) => s.baselineCorrect).length / held.length
    : null;
  const decisionAccuracy = held.length
    ? held.filter((s) => s.decisionCorrect).length / held.length
    : null;
  if (
    baselineAccuracy !== null &&
    decisionAccuracy !== null &&
    baselineAccuracy - decisionAccuracy >
      (params.risk === "reversible" ? 0.05 : 0) + 1e-10
  )
    reasons.push("quality_regression");
  if (
    params.risk === "consequential" &&
    accepted.some((s) => !s.decisionCorrect)
  )
    reasons.push("consequential_false_acceptance");
  const cost = (key: "baselineCostNanoUsd" | "decisionCostNanoUsd") =>
    held.length && held.every((s) => s[key] !== null)
      ? held.reduce((sum, s) => sum + s[key]!, 0)
      : null;
  const baselineCostNanoUsd = cost("baselineCostNanoUsd");
  const decisionCostNanoUsd = cost("decisionCostNanoUsd");
  if (baselineCostNanoUsd === null || decisionCostNanoUsd === null)
    reasons.push("total_workflow_cost_unmeasured");
  const percentile = (
    key: "baselineDurationMs" | "decisionDurationMs",
    p: number,
  ) =>
    held.length
      ? held.map((s) => s[key]).sort((a, b) => a - b)[
          Math.max(0, Math.ceil(held.length * p) - 1)
        ]
      : null;
  return {
    qualified: reasons.length === 0,
    reasons: [...new Set(reasons)],
    heldOutSamples: held.length,
    acceptedSamples: accepted.length,
    baselineAccuracy,
    decisionAccuracy,
    acceptanceRate: held.length ? accepted.length / held.length : null,
    baselineP50Ms: percentile("baselineDurationMs", 0.5),
    baselineP95Ms: percentile("baselineDurationMs", 0.95),
    decisionP50Ms: percentile("decisionDurationMs", 0.5),
    decisionP95Ms: percentile("decisionDurationMs", 0.95),
    baselineCostNanoUsd,
    decisionCostNanoUsd,
  };
}
