import { describe, expect, it, vi } from "vitest";
import {
  runDecision,
  parseDecisionPolicy,
  validDecisionAnswers,
  type DecisionResponse,
  type DecisionPolicy,
} from "../../core/decisions";
import {
  choiceQuestion,
  noulQuestion,
  scoreQuestion,
} from "../../core/decision-questions";
import {
  parseDecideRequest,
  parseDecideResponse,
} from "../../core/decision-validation";

const questions = {
  route: choiceQuestion(
    { question: "Choose the supported value", nested: [true, 3, null] },
    { yes: { evidence: ["s1", null], count: 2 } },
  ),
};
const response = (
  override: Partial<DecisionResponse> = {},
): DecisionResponse => ({
  contractVersion: 1,
  requestId: "test",
  model: "jev-test",
  usage: { inputTokens: 10, outputTokens: 2 },
  cost: { status: "unpriced", costNanoUsd: null },
  durationMs: 1,
  answers: {
    route: {
      type: "choice",
      choice: "yes",
      confidence: 0.99,
      probabilities: { yes: 0.99, __abstain__: 0.01 },
    },
  },
  ...override,
});
const policy: DecisionPolicy = {
  mode: "active",
  families: { test: { threshold: 0.95, evaluationId: "test-only" } },
};

function options() {
  return {
    family: "test",
    state: { data: [true, 5, null] },
    questions,
    policy,
    decide: vi.fn(async () => response()),
    accept: () => ({ source: "decision", value: 1 }),
    fallback: vi.fn(async () => ({ source: "reasoning", value: 9 })),
  };
}

describe("decision cascade", () => {
  it("preserves structured JSON and returns accepted values without reasoning", async () => {
    const o = options();
    expect(await runDecision(o)).toEqual({ source: "decision", value: 1 });
    expect(o.fallback).not.toHaveBeenCalled();
    expect(o.decide.mock.calls[0]).toBeDefined();
  });
  it("returns the exact fallback value and never synthesizes probability metadata", async () => {
    const value = { arbitrary: new Map([["x", 1]]) };
    const result = await runDecision({
      ...options(),
      accept: () => undefined,
      fallback: async () => value,
    });
    expect(result).toBe(value);
  });
  it("defaults to legacy and requires an evaluated active family", async () => {
    for (const p of [
      undefined,
      { mode: "active" as const },
      { mode: "active" as const, families: { test: { threshold: 0.95 } } },
    ]) {
      const o = options();
      await runDecision({ ...o, policy: p });
      expect(o.decide).not.toHaveBeenCalled();
      expect(o.fallback).toHaveBeenCalledOnce();
    }
  });
  it("shadow records the proposed answer but only returns reasoning", async () => {
    const o = options();
    const events = vi.fn();
    expect(
      await runDecision({
        ...o,
        policy: { mode: "shadow" },
        onDecision: events,
      }),
    ).toEqual({ source: "reasoning", value: 9 });
    expect(events.mock.calls[0][0].outcome).toBe("shadow");
    expect(events.mock.calls[0][0].response.cost.costNanoUsd).toBeNull();
  });
  it.each(["missing", "unknown", "distribution", "confidence", "metadata"])(
    "falls back on malformed %s",
    async (defect) => {
      const r = response();
      if (defect === "missing") r.answers = {};
      if (defect === "unknown")
        r.answers.route = {
          type: "choice",
          choice: "injected",
          confidence: 1,
          probabilities: { injected: 1, yes: 0 },
        };
      if (defect === "distribution")
        r.answers.route = {
          type: "choice",
          choice: "yes",
          confidence: 1,
          probabilities: { yes: 0.1, __abstain__: 0.1 },
        };
      if (defect === "confidence")
        r.answers.route = {
          type: "choice",
          choice: "yes",
          confidence: 0.6,
          probabilities: { yes: 0.8, __abstain__: 0.2 },
        };
      if (defect === "metadata")
        r.cost = { status: "priced", costNanoUsd: NaN };
      const o = options();
      await runDecision({ ...o, decide: async () => r });
      expect(o.fallback).toHaveBeenCalledOnce();
    },
  );
  it("times out once, aborts the adapter, and invokes reasoning once", async () => {
    const o = options();
    let signal: AbortSignal | undefined;
    await runDecision({
      ...o,
      policy: { ...policy, timeoutMs: 100 },
      decide: (req) => {
        signal = req.signal;
        return new Promise(() => {});
      },
    });
    expect(signal?.aborted).toBe(true);
    expect(o.fallback).toHaveBeenCalledOnce();
  });
  it("never invokes reasoning after caller abort, before or during inference", async () => {
    for (const already of [true, false]) {
      const o = options();
      const controller = new AbortController();
      if (already) controller.abort();
      const result = runDecision({
        ...o,
        signal: controller.signal,
        decide: async () => {
          controller.abort();
          return response();
        },
      });
      await expect(result).rejects.toThrow();
      expect(o.fallback).not.toHaveBeenCalled();
    }
  });
  it("observer failures cannot replay a decision or fallback", async () => {
    const o = options();
    await runDecision({
      ...o,
      onDecision: () => {
        throw Error("observer");
      },
      onUsage: () => {
        throw Error("usage observer");
      },
    });
    expect(o.decide).toHaveBeenCalledOnce();
    expect(o.fallback).not.toHaveBeenCalled();
  });
  it("preserves fallback exceptions", async () => {
    const error = new Error("reasoning unavailable");
    await expect(
      runDecision({
        ...options(),
        decide: async () => {
          throw Error("transient");
        },
        fallback: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });
});

describe("decision contracts and policies", () => {
  it("round trips nested structured instructions, options, score legends and Noul criteria", () => {
    const request = {
      tenantId: "tenant",
      state: { nested: [true, 1, null] },
      questions: {
        ...questions,
        score: scoreQuestion(null, [{ level: [false, 0] }, [null, 1]]),
        supported: noulQuestion(["Is it supported?", { value: true }], {
          true: { match: true },
          false: null,
        }),
      },
    };
    expect(parseDecideRequest(JSON.parse(JSON.stringify(request)))).toEqual(
      request,
    );
    const r = response({
      answers: {
        ...response().answers,
        score: {
          type: "score",
          score: 0.9,
          probabilities: { "0": 0.1, "1": 0.9 },
          confidence: 0.9,
          legend: { "0": { level: [false, 0] }, "1": [null, 1] },
        },
        supported: { type: "noul", noul: 0.99 },
      },
    });
    expect(parseDecideResponse(r, request)).toEqual(r);
    expect(validDecisionAnswers(request.questions, r.answers)).toBe(true);
  });
  it("rejects fabricated Noul confidence, changed legends and inconsistent lineage", () => {
    expect(() =>
      parseDecideResponse(
        response({
          answers: { q: { type: "noul", noul: 1, confidence: 1 } },
        } as unknown as DecisionResponse),
      ),
    ).toThrow();
    expect(
      validDecisionAnswers(
        { q: scoreQuestion("Rate", ["low", "high"]) },
        {
          q: {
            type: "score",
            score: 1,
            confidence: 1,
            probabilities: { "0": 0, "1": 1 },
            legend: { "0": "wrong", "1": "high" },
          },
        },
      ),
    ).toBe(false);
    expect(() =>
      parseDecideRequest({
        tenantId: "t",
        state: null,
        questions,
        parentRequestId: "a",
        trace: { parentRequestId: "b" },
      }),
    ).toThrow();
  });
  it("rejects scalar entry booleans, unsupported modes and incomplete activation", () => {
    expect(() =>
      parseDecideRequest({ tenantId: "t", state: true, questions }),
    ).toThrow();
    expect(() => parseDecisionPolicy({ mode: "jev_active" })).toThrow();
    expect(() =>
      parseDecisionPolicy({
        mode: "active",
        families: { test: { threshold: 0.9 } },
      }),
    ).toThrow();
    expect(parseDecisionPolicy(policy).families?.test.evaluationId).toBe(
      "test-only",
    );
  });
});

describe("decision review regressions", () => {
  it("never emits provider or accept exception text", async () => {
    const events = vi.fn();
    await runDecision({
      ...options(),
      onDecision: events,
      decide: async () => {
        throw Error("SECRET evidence payload");
      },
    });
    expect(events.mock.calls[0][0].reason).toBe("decision_failed");
    expect(JSON.stringify(events.mock.calls)).not.toContain("SECRET");
  });
  it("validates timeout boundaries and rejects typo fields", () => {
    for (const timeoutMs of [0, 99, 100.1, 900001, Infinity])
      expect(() =>
        parseDecisionPolicy({ mode: "legacy", timeoutMs }),
      ).toThrow();
    expect(() =>
      parseDecisionPolicy({ mode: "active", familys: {} }),
    ).toThrow();
    expect(() =>
      parseDecisionPolicy({
        mode: "active",
        families: {
          test: { threshold: 0.99, evaluationId: "e", mod: "legacy" },
        },
      }),
    ).toThrow();
  });
  it("keeps prototype-like family names as data and never inherits activation", async () => {
    const parsed = parseDecisionPolicy(
      JSON.parse(
        '{"mode":"legacy","families":{"__proto__":{"mode":"active","threshold":0.99,"evaluationId":"test"}}}',
      ),
    );
    expect(Object.getPrototypeOf(parsed.families)).toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(parsed.families, "__proto__"),
    ).toBe(true);
    const o = options();
    await runDecision({
      ...o,
      policy: {
        mode: "active",
        families: Object.create({
          test: { threshold: 0.99, evaluationId: "inherited" },
        }),
      },
    });
    expect(o.decide).not.toHaveBeenCalled();
  });
  it("compares score objects without key-order sensitivity but preserves array order", () => {
    const q = { s: scoreQuestion("Rate", [{ a: 1, b: [2, 3] }, null]) };
    const a = {
      s: {
        type: "score" as const,
        score: 0,
        confidence: 1,
        probabilities: { "0": 1, "1": 0 },
        legend: { "0": { b: [2, 3], a: 1 }, "1": null },
      },
    };
    expect(validDecisionAnswers(q, a)).toBe(true);
    a.s.legend["0"].b = [3, 2];
    expect(validDecisionAnswers(q, a)).toBe(false);
  });
  it("rejects inherited answer IDs and permits ordinary metadata properties", () => {
    const inherited = Object.assign(
      Object.create({ route: response().answers.route }),
      { other: response().answers.route },
    );
    expect(validDecisionAnswers(questions, inherited)).toBe(false);
    expect(
      parseDecideRequest({
        tenantId: "t",
        state: { constructor: "class", prototype: { inherited: false } },
        questions,
      }).state,
    ).toEqual({ constructor: "class", prototype: { inherited: false } });
  });
});

describe("speculative branch acceptance", () => {
  it("accepts a confident selected branch with uncertain unused answers", async () => {
    const o = options();
    const q = { ...questions, unused: noulQuestion("Unused branch premise?") };
    const r = response({
      answers: { ...response().answers, unused: { type: "noul", noul: 0.5 } },
    });
    expect(
      await runDecision({
        ...o,
        questions: q,
        decide: async () => r,
        requiredQuestionIds: () => ["route"],
      }),
    ).toEqual({ source: "decision", value: 1 });
    expect(o.fallback).not.toHaveBeenCalled();
    await runDecision({ ...o, questions: q, decide: async () => r });
    expect(o.fallback).toHaveBeenCalledOnce();
  });
  it("rejects empty or non-own required IDs and malformed unused answers", async () => {
    for (const ids of [[], ["constructor"], ["missing"]]) {
      const o = options();
      await runDecision({ ...o, requiredQuestionIds: () => ids });
      expect(o.fallback).toHaveBeenCalledOnce();
    }
    const o = options();
    await runDecision({
      ...o,
      questions: { ...questions, unused: noulQuestion("Unused?") },
      requiredQuestionIds: () => ["route"],
      decide: async () =>
        response({
          answers: { ...response().answers, unused: { type: "noul", noul: 2 } },
        }),
    });
    expect(o.fallback).toHaveBeenCalledOnce();
  });
});
