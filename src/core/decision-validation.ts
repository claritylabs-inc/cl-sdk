import type { DecideRequest, DecideResponse, DecisionAnswer, DecisionEntry, DecisionQuestion } from "./decisions";

function invalid(): never { throw new Error("Invalid decision contract"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid();
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > 256) invalid();
}
function natural(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
}
function probability(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid();
}
function json(value: unknown, depth = 0): void {
  if (depth > 32) invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(item => json(item, depth + 1)); return; }
  const entries = object(value);
  for (const [key, item] of Object.entries(entries)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) invalid();
    json(item, depth + 1);
  }
}
export function parseDecisionEntry(value: unknown): DecisionEntry {
  if (typeof value === "number" || typeof value === "boolean") invalid();
  json(value);
  return value as DecisionEntry;
}
export function parseDecisionQuestion(value: unknown): DecisionQuestion {
  const q = object(value);
  exact(q, ["type", "instructions", "criteria"]);
  parseDecisionEntry(q.instructions);
  if (q.type === "choice") {
    const criteria = object(q.criteria);
    if (Object.keys(criteria).length < 2 || Object.keys(criteria).length > 128) invalid();
    for (const [key, entry] of Object.entries(criteria)) { text(key); parseDecisionEntry(entry); }
  } else if (q.type === "score") {
    if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 128) invalid();
    q.criteria.forEach(parseDecisionEntry);
  } else if (q.type === "noul") {
    if (q.criteria !== undefined) {
      const criteria = object(q.criteria);
      exact(criteria, ["true", "false"]);
      Object.values(criteria).forEach(parseDecisionEntry);
    }
  } else invalid();
  return value as DecisionQuestion;
}
export function parseDecideRequest(value: unknown): DecideRequest {
  const r = object(value);
  exact(r, ["tenantId", "orgId", "task", "state", "questions", "executionBudgetMs", "parentRequestId", "trace"]);
  text(r.tenantId);
  for (const key of ["orgId", "task", "parentRequestId"]) if (r[key] !== undefined) text(r[key]);
  parseDecisionEntry(r.state);
  const questions = object(r.questions);
  if (!Object.keys(questions).length || Object.keys(questions).length > 128) invalid();
  for (const [key, question] of Object.entries(questions)) { text(key); parseDecisionQuestion(question); }
  if (r.executionBudgetMs !== undefined) {
    natural(r.executionBudgetMs);
    if (r.executionBudgetMs < 100 || r.executionBudgetMs > 900_000) invalid();
  }
  if (r.trace !== undefined) {
    const trace = object(r.trace);
    exact(trace, ["traceId", "parentRequestId", "channel"]);
    Object.values(trace).forEach(text);
    if (r.parentRequestId !== undefined && trace.parentRequestId !== undefined && r.parentRequestId !== trace.parentRequestId) invalid();
  }
  if (utf8Bytes(JSON.stringify(r)) > 4 * 1024 * 1024) invalid();
  const parsed = r as unknown as DecideRequest;
  const parentRequestId = parsed.parentRequestId ?? parsed.trace?.parentRequestId;
  return { ...parsed, ...(parentRequestId ? { parentRequestId } : {}) };
}
function parseAnswer(value: unknown): DecisionAnswer {
  const a = object(value);
  if (a.type === "noul") { exact(a, ["type", "noul"]); probability(a.noul); }
  else if (a.type === "choice" || a.type === "score") {
    exact(a, a.type === "choice" ? ["type", "choice", "probabilities", "confidence"] : ["type", "score", "legend", "probabilities", "confidence"]);
    probability(a.confidence);
    const probs = object(a.probabilities);
    const values = Object.values(probs);
    if (values.length < 2) invalid();
    values.forEach(probability);
    if (Math.abs((values as number[]).reduce((sum, n) => sum + n, 0) - 1) > 0.001) invalid();
    if (a.type === "choice") {
      text(a.choice);
      if (!Object.prototype.hasOwnProperty.call(probs, a.choice) || (probs[a.choice] as number) < Math.max(...values as number[])) invalid();
    } else {
      const legend = object(a.legend);
      Object.values(legend).forEach(parseDecisionEntry);
      if (Object.keys(legend).length !== values.length) invalid();
      for (let i = 0; i < values.length; i++) if (!Object.prototype.hasOwnProperty.call(legend, String(i)) || !Object.prototype.hasOwnProperty.call(probs, String(i))) invalid();
      const expected = Object.entries(probs).reduce((sum, [key, p]) => sum + Number(key) * (p as number), 0);
      if (typeof a.score !== "number" || !Number.isFinite(a.score) || Math.abs(a.score - expected) > 0.001) invalid();
    }
  } else invalid();
  return value as DecisionAnswer;
}
export function validateDecisionAnswers(questions: Record<string, DecisionQuestion>, answers: Record<string, DecisionAnswer>): void {
  if (Object.keys(questions).length !== Object.keys(answers).length) invalid();
  for (const [id, q] of Object.entries(questions)) {
    const a = parseAnswer(answers[id]);
    if (a.type !== q.type) invalid();
    if (a.type === "choice" && q.type === "choice") {
      if (Object.keys(a.probabilities).length !== Object.keys(q.criteria).length || Object.keys(q.criteria).some(key => !Object.prototype.hasOwnProperty.call(a.probabilities, key))) invalid();
    }
    if (a.type === "score" && q.type === "score") {
      if (Object.keys(a.legend).length !== q.criteria.length || q.criteria.some((entry, i) => JSON.stringify(entry) !== JSON.stringify(a.legend[String(i)]))) invalid();
    }
  }
}
export function parseDecideResponse(value: unknown, request?: DecideRequest): DecideResponse {
  const r = object(value);
  exact(r, ["contractVersion", "requestId", "parentRequestId", "model", "answers", "usage", "cost", "durationMs"]);
  if (r.contractVersion !== 1) invalid();
  text(r.requestId); text(r.model);
  // The SDK validates the contract; the host adapter pins its decision provider version.
  if (r.parentRequestId !== undefined) text(r.parentRequestId);
  natural(r.durationMs);
  const usage = object(r.usage); exact(usage, ["inputTokens", "outputTokens"]);
  natural(usage.inputTokens); natural(usage.outputTokens);
  const cost = object(r.cost); exact(cost, ["status", "costNanoUsd"]);
  if (cost.status === "priced") natural(cost.costNanoUsd);
  else if (cost.status !== "unpriced" || cost.costNanoUsd !== null) invalid();
  const answers = object(r.answers);
  Object.values(answers).forEach(parseAnswer);
  if (request) {
    if (r.parentRequestId !== (request.parentRequestId ?? request.trace?.parentRequestId)) invalid();
    validateDecisionAnswers(request.questions, answers as Record<string, DecisionAnswer>);
  }
  return r as unknown as DecideResponse;
}

export const validateDecideRequest = parseDecideRequest;
export const validateDecideResponse = parseDecideResponse;

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
