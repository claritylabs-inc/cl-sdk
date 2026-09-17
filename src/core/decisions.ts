import {
  parseDecisionEntry,
  parseDecisionQuestion,
  parseDecideResponse,
  validateDecisionAnswers,
} from "./decision-validation";
import type { TokenUsage } from "./types";

export type DecisionJson =
  | string
  | number
  | boolean
  | null
  | DecisionJson[]
  | { [key: string]: DecisionJson };
export type JsonValue = DecisionJson;
export type DecisionEntry =
  | string
  | null
  | DecisionJson[]
  | { [key: string]: DecisionJson };
export type EntryType = DecisionEntry;
export type DecisionQuestion =
  | {
      type: "choice";
      instructions: DecisionEntry;
      criteria: Record<string, DecisionEntry>;
    }
  | {
      type: "noul";
      instructions: DecisionEntry;
      criteria?: { true?: DecisionEntry; false?: DecisionEntry };
    }
  | { type: "score"; instructions: DecisionEntry; criteria: DecisionEntry[] };
export type DecisionAnswer =
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
    }
  | { type: "noul"; noul: number }
  | {
      type: "score";
      score: number;
      probabilities: Record<string, number>;
      legend: Record<string, DecisionEntry>;
      confidence: number;
    };
export interface DecideRequest {
  tenantId: string;
  orgId?: string;
  task?: string;
  state: DecisionEntry;
  questions: Record<string, DecisionQuestion>;
  executionBudgetMs?: number;
  parentRequestId?: string;
  trace?: { traceId?: string; parentRequestId?: string; channel?: string };
}
export interface DecideResponse {
  contractVersion: 1;
  requestId: string;
  parentRequestId?: string;
  model: string;
  answers: Record<string, DecisionAnswer>;
  usage: TokenUsage;
  cost: { status: "priced" | "unpriced"; costNanoUsd: number | null };
  durationMs: number;
}
export type DecisionRequest = DecideRequest;
export type DecisionResponse = DecideResponse;
/** Host closure supplies wire tenancy; signal is local transport control, never JSON. */
export type DecisionInput = Omit<DecideRequest, "tenantId" | "orgId"> & {
  signal?: AbortSignal;
};
export type Decide = (request: DecisionInput) => Promise<DecideResponse>;
export type DecisionMode = "legacy" | "shadow" | "active";
export interface DecisionFamilyPolicy {
  mode?: DecisionMode;
  /** Calibrated on a separate calibration split; never inferred from synthetic tests. */
  threshold?: number;
  evaluationId?: string;
}
export interface DecisionPolicy {
  mode: DecisionMode;
  policyVersion?: string;
  timeoutMs?: number;
  families?: Record<string, DecisionFamilyPolicy>;
}
export interface DecisionEvent {
  family: string;
  mode: DecisionMode;
  outcome: "accepted" | "fallback" | "shadow" | "bypass";
  reason: string;
  durationMs: number;
  policyVersion?: string;
  evaluationId?: string;
  response?: DecisionResponse;
}
export interface DecisionConfig {
  decide?: Decide;
  decisionPolicy?: DecisionPolicy;
  onDecision?: (event: DecisionEvent) => void;
}
export interface RunDecisionOptions<T> {
  decide?: Decide;
  policy?: DecisionPolicy;
  family: string;
  state: DecisionEntry;
  questions: Record<string, DecisionQuestion>;
  accept: (answers: Record<string, DecisionAnswer>) => T | undefined;
  /** Confidence applies only to consumed branches; the full response is still validated. */
  requiredQuestionIds?: (
    answers: Record<string, DecisionAnswer>,
  ) => readonly string[];
  fallback: () => Promise<T>;
  onDecision?: (event: DecisionEvent) => void;
  onUsage?: (usage?: TokenUsage) => void;
  signal?: AbortSignal;
}
const probability = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

/** Validate provider output against the exact questions before trusting any answer. */
export function validDecisionAnswers(
  questions: Record<string, DecisionQuestion>,
  answers: Record<string, DecisionAnswer>,
): boolean {
  try {
    validateDecisionAnswers(questions, answers);
    return true;
  } catch {
    return false;
  }
}

/** One bounded decision attempt; all uncertainty returns to the caller's existing reasoning path. */
export async function runDecision<T>(
  options: RunDecisionOptions<T>,
): Promise<T> {
  const {
    decide,
    policy,
    family,
    state,
    questions,
    accept,
    fallback,
    onDecision,
    onUsage,
    signal,
    requiredQuestionIds,
  } = options;
  signal?.throwIfAborted();
  const rule =
    policy?.families &&
    Object.prototype.hasOwnProperty.call(policy.families, family)
      ? policy.families[family]
      : undefined;
  const mode = rule?.mode ?? policy?.mode ?? "legacy";
  const started = Date.now();
  const emit = (
    outcome: DecisionEvent["outcome"],
    reason: string,
    response?: DecisionResponse,
  ) => {
    // Observability must never rerun an accepted decision or its fallback.
    try {
      onDecision?.({
        family,
        mode,
        outcome,
        reason,
        durationMs: Date.now() - started,
        policyVersion: policy?.policyVersion,
        evaluationId: rule?.evaluationId,
        response,
      });
    } catch {
      /* observer only */
    }
  };
  const threshold = rule?.threshold;
  if (!decide || mode === "legacy" || !Object.keys(questions).length) {
    emit(
      "bypass",
      !decide ? "no_callback" : mode === "legacy" ? "legacy" : "no_questions",
    );
    return fallback();
  }
  if (
    mode === "active" &&
    (!rule?.evaluationId ||
      threshold === undefined ||
      !probability(threshold) ||
      threshold <= 0.5)
  ) {
    emit("bypass", "evaluation_required");
    return fallback();
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: DecisionResponse | undefined;
  let selected: T | undefined;
  let reason = "uncertain";
  let timedOut = false;
  try {
    if (signal?.aborted) throw new Error("aborted");
    const timeout = policy?.timeoutMs ?? 1000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 900_000) {
      emit("bypass", "invalid_timeout");
      return fallback();
    }
    parseDecisionEntry(state);
    if (Object.keys(questions).length > 128) throw new Error("question_budget");
    Object.values(questions).forEach(parseDecisionQuestion);
    const rawResponse = await Promise.race([
      decide({
        state,
        questions,
        task: family,
        executionBudgetMs: timeout,
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("timeout"));
        }, timeout);
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted_or_timeout")),
          { once: true },
        );
      }),
    ]);
    response = parseDecideResponse(rawResponse);
    try {
      onUsage?.(response.usage);
    } catch {
      /* observer only */
    }
    if (!validDecisionAnswers(questions, response.answers))
      reason = "malformed";
    else {
      const answers = response.answers;
      const required =
        requiredQuestionIds?.(answers) ?? Object.keys(questions);
      if (
        !Array.isArray(required) ||
        !required.length ||
        required.some(
          (id) =>
            typeof id !== "string" ||
            !Object.prototype.hasOwnProperty.call(questions, id),
        )
      )
        reason = "invalid_required_questions";
      else if (
        !required.every((id) => {
          const answer = answers[id];
          return answer.type === "noul"
            ? Math.max(answer.noul, 1 - answer.noul) >= (threshold ?? 0.95)
            : answer.confidence >= (threshold ?? 0.95);
        })
      )
        reason = "low_confidence";
      else {
        selected = accept(response.answers);
        reason = selected === undefined ? "abstain_or_unsupported" : "accepted";
      }
    }
  } catch {
    reason = timedOut
      ? "timeout"
      : signal?.aborted
        ? "caller_aborted"
        : "decision_failed";
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  signal?.throwIfAborted();
  if (mode === "active" && selected !== undefined) {
    emit("accepted", reason, response);
    return selected;
  }
  emit(mode === "shadow" ? "shadow" : "fallback", reason, response);
  return fallback();
}

export function decisionOptions(config: DecisionConfig) {
  return {
    decide: config.decide,
    policy: config.decisionPolicy,
    onDecision: config.onDecision,
  };
}

/** Serialize domain data as JSON (omitting undefined properties); reject invalid entries and cycles. */
export function decisionJson(value: unknown): DecisionEntry {
  return parseDecisionEntry(
    JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (typeof item === "number" && !Number.isFinite(item))
          throw new Error("Non-finite decision state");
        return item;
      }),
    ),
  );
}

/** Validate deployment configuration without coercion or implicit family activation. */
export function parseDecisionPolicy(value: unknown): DecisionPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Decision policy must be an object");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        !["mode", "policyVersion", "timeoutMs", "families"].includes(key),
    )
  )
    throw new Error("Unknown decision policy field");
  const modes: unknown[] = ["legacy", "shadow", "active"];
  if (!modes.includes(input.mode))
    throw new Error("Invalid decision policy mode");
  if (
    input.policyVersion !== undefined &&
    (typeof input.policyVersion !== "string" || !input.policyVersion.trim())
  )
    throw new Error("Invalid policyVersion");
  if (
    input.timeoutMs !== undefined &&
    (typeof input.timeoutMs !== "number" ||
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 100 ||
      input.timeoutMs > 900_000)
  )
    throw new Error("Invalid timeoutMs");
  const families: Record<string, DecisionFamilyPolicy> = Object.create(null);
  if (input.families !== undefined) {
    if (
      !input.families ||
      typeof input.families !== "object" ||
      Array.isArray(input.families)
    )
      throw new Error("Invalid families");
    for (const [family, value] of Object.entries(input.families)) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Invalid family ${family}`);
      const rule = value as Record<string, unknown>;
      if (
        Object.keys(rule).some(
          (key) => !["mode", "threshold", "evaluationId"].includes(key),
        )
      )
        throw new Error(`Unknown rule field for ${family}`);
      if (rule.mode !== undefined && !modes.includes(rule.mode))
        throw new Error(`Invalid mode for ${family}`);
      if (
        rule.threshold !== undefined &&
        (typeof rule.threshold !== "number" ||
          !probability(rule.threshold) ||
          rule.threshold <= 0.5)
      )
        throw new Error(`Invalid threshold for ${family}`);
      if (
        rule.evaluationId !== undefined &&
        (typeof rule.evaluationId !== "string" || !rule.evaluationId.trim())
      )
        throw new Error(`Invalid evaluationId for ${family}`);
      if (
        (rule.mode ?? input.mode) === "active" &&
        (rule.threshold === undefined || !rule.evaluationId)
      )
        throw new Error(
          `Active family ${family} requires threshold and evaluationId`,
        );
      families[family] = {
        mode: rule.mode as DecisionMode | undefined,
        threshold: rule.threshold as number | undefined,
        evaluationId: rule.evaluationId as string | undefined,
      };
    }
  }
  return {
    mode: input.mode as DecisionMode,
    policyVersion: input.policyVersion as string | undefined,
    timeoutMs: input.timeoutMs as number | undefined,
    families,
  };
}
