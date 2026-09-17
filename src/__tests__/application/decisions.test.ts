import { describe, expect, it, vi } from "vitest";
import { autoFillFromContext } from "../../application/agents/auto-filler";
import { classifyReplyIntent } from "../../application/agents/reply-router";
import { parseAnswers } from "../../application/agents/answer-parser";
import { fillFromLookup } from "../../application/agents/lookup-filler";
import { decisionTestConfig } from "../fixtures/decision-test-helpers";
import type { ApplicationField } from "../../schemas/application";
import type { GenerateObject } from "../../core/types";

const field: ApplicationField = {
  id: "f1",
  label: "Claims in last 3 years?",
  fieldType: "yes_no",
  required: true,
  section: "History",
};
const reasoning = (object: unknown) =>
  vi.fn(async () => ({ object })) as unknown as GenerateObject;

describe("application decision callsites", () => {
  it("copies an exact context value and does not generate a novel value", async () => {
    const generate = reasoning({ matches: [] });
    const result = await autoFillFromContext(
      [field],
      [{ key: "prior_claims", value: "No", category: "history" }],
      generate,
      undefined,
      4096,
      decisionTestConfig("application.field_match", () => "c0"),
    );
    expect(result.result.matches[0]).toMatchObject({
      fieldId: "f1",
      value: "No",
      contextKey: "prior_claims",
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it("escalates a missing source candidate without setting a field", async () => {
    const generate = reasoning({ matches: [] });
    const result = await autoFillFromContext(
      [field],
      [],
      generate,
      undefined,
      4096,
      decisionTestConfig("application.field_match", () => "__abstain__"),
    );
    expect(result.result.matches).toEqual([]);
    expect(generate).toHaveBeenCalledOnce();
  });
  it("retains generative extraction for lookup intent and mixed prose", async () => {
    const generate = reasoning({
      primaryIntent: "lookup_request",
      hasAnswers: false,
      lookupRequests: [
        {
          type: "policy",
          description: "Look up claims",
          targetFieldIds: ["f1"],
        },
      ],
    });
    const result = await classifyReplyIntent(
      [field],
      "Find my claims",
      generate,
      undefined,
      1024,
      decisionTestConfig("application.reply_intent", (id) =>
        id === "intent" ? "lookup_request" : 0,
      ),
    );
    expect(result.intent.lookupRequests).toHaveLength(1);
    expect(generate).toHaveBeenCalledOnce();
  });
  it("maps bounded answers but never parses silence as authorization", async () => {
    const generate = reasoning({ answers: [], unanswered: ["f1"] });
    const result = await parseAnswers(
      [field],
      "No claims",
      generate,
      undefined,
      4096,
      decisionTestConfig("application.bounded_answers", () => "v1"),
    );
    expect(result.result.answers).toEqual([{ fieldId: "f1", value: "No" }]);
    expect(generate).not.toHaveBeenCalled();
    const unanswered = await parseAnswers(
      [field],
      "Thanks",
      generate,
      undefined,
      4096,
      decisionTestConfig("application.bounded_answers", () => "unanswered"),
    );
    expect(unanswered.result).toEqual({ answers: [], unanswered: ["f1"] });
  });
  it("retains prose/explanation parsing", async () => {
    const generate = reasoning({ answers: [], unanswered: ["f1"] });
    const config = decisionTestConfig(
      "application.bounded_answers",
      () => "v0",
    );
    config.decide = vi.fn(config.decide!);
    await parseAnswers(
      [{ ...field, requiresExplanationIfYes: true }],
      "Yes, here's why...",
      generate,
      undefined,
      4096,
      config,
    );
    expect(config.decide).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
  });
  it("lookup copies only offered source values", async () => {
    const generate = reasoning({ fills: [], unfillable: [] });
    const result = await fillFromLookup(
      [],
      [field],
      "Prior claims: No",
      generate,
      undefined,
      4096,
      decisionTestConfig("application.lookup_match", () => "c0"),
    );
    expect(result.result.fills[0]).toEqual({
      fieldId: "f1",
      value: "No",
      source: "Prior claims: No",
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
