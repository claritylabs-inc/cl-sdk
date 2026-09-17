import {
  decisionJson,
  decisionOptions,
  runDecision,
  type DecisionConfig,
  type DecisionQuestion,
} from "../core/decisions";
import {
  choiceQuestion,
  noulQuestion,
  sourceValueQuestion,
} from "../core/decision-questions";
import type {
  ApplicationField,
  AutoFillResult,
  AnswerParsingResult,
  ReplyIntent,
  LookupFillResult,
} from "../schemas/application";
import type { TokenUsage } from "../core/types";

export interface ApplicationDecisionConfig extends DecisionConfig {
  onDecisionUsage?: (usage?: TokenUsage) => void;
}

export function contextMatchesDecision(
  fields: ApplicationField[],
  context: { key: string; value: string; category: string }[],
  config: ApplicationDecisionConfig,
  fallback: () => Promise<{ result: AutoFillResult; usage?: TokenUsage }>,
) {
  return runDecision({
    ...decisionOptions(config),
    family: "application.field_match",
    state: decisionJson({ fields, context }),
    questions: Object.fromEntries(
      fields.map((field, i) => [
        `f${i}`,
        sourceValueQuestion(
          decisionJson(field),
          Object.fromEntries(
            context.map((entry, j) => [`c${j}`, decisionJson(entry)]),
          ),
        ),
      ]),
    ),
    accept: (answers) => {
      const matches: AutoFillResult["matches"] = [];
      for (const [i, field] of fields.entries()) {
        const a = answers[`f${i}`];
        if (a.type !== "choice") return;
        const index = context.findIndex((_, j) => a.choice === `c${j}`);
        if (index < 0) return;
        const entry = context[index];
        if (field.options?.length && !field.options.includes(entry.value))
          return;
        matches.push({
          fieldId: field.id,
          value: entry.value,
          confidence: "confirmed",
          contextKey: entry.key,
        });
      }
      return { result: { matches } };
    },
    fallback,
    onUsage: config.onDecisionUsage,
  });
}

export function replyIntentDecision(
  fields: ApplicationField[],
  replyText: string,
  config: ApplicationDecisionConfig,
  fallback: () => Promise<{ intent: ReplyIntent; usage?: TokenUsage }>,
) {
  return runDecision({
    ...decisionOptions(config),
    family: "application.reply_intent",
    state: decisionJson({ fields, replyText }),
    questions: {
      intent: choiceQuestion(
        "What does this user reply ask the application workflow to do?",
        {
          answers_only: "Only supply answers to the current fields",
          question: "Ask for an explanation",
          lookup_request: "Ask for external or document lookup",
          mixed: "Combine answers, explanations or lookups",
        },
      ),
      answers: noulQuestion(
        "Does this reply explicitly provide one or more answers to the current fields?",
      ),
    },
    // Lookup instructions and question prose still require generative extraction.
    requiredQuestionIds: (answers) =>
      answers.intent.type === "choice" &&
      answers.intent.choice === "answers_only"
        ? ["intent", "answers"]
        : ["intent"],
    accept: (answers) =>
      answers.intent.type === "choice" &&
      answers.intent.choice === "answers_only" &&
      answers.answers.type === "noul" &&
      answers.answers.noul > 0.5
        ? {
            intent: {
              primaryIntent: "answers_only" as const,
              hasAnswers: true,
            },
          }
        : undefined,
    fallback,
    onUsage: config.onDecisionUsage,
  });
}

export function boundedAnswersDecision(
  fields: ApplicationField[],
  replyText: string,
  config: ApplicationDecisionConfig,
  fallback: () => Promise<{ result: AnswerParsingResult; usage?: TokenUsage }>,
) {
  if (
    fields.some(
      (f) =>
        (!f.options?.length && f.fieldType !== "yes_no") ||
        f.requiresExplanationIfYes ||
        f.fieldType === "declaration",
    )
  )
    return fallback();
  const questions: Record<string, DecisionQuestion> = {};
  fields.forEach((field, i) => {
    questions[`f${i}`] = choiceQuestion(
      {
        question:
          "Which allowed value did the user explicitly supply for this field? Never infer consent, authorization or an answer from silence.",
        field: decisionJson(field),
      },
      {
        ...Object.fromEntries(
          (field.options?.length ? field.options : ["Yes", "No"]).map(
            (option, j) => [`v${j}`, option],
          ),
        ),
        unanswered: "The reply does not answer this field",
      },
    );
  });
  return runDecision({
    ...decisionOptions(config),
    family: "application.bounded_answers",
    state: decisionJson({ fields, replyText }),
    questions,
    accept: (answers) => {
      const result: AnswerParsingResult = { answers: [], unanswered: [] };
      for (const [i, field] of fields.entries()) {
        const a = answers[`f${i}`];
        if (a.type !== "choice") return;
        if (a.choice === "unanswered") {
          result.unanswered.push(field.id);
          continue;
        }
        const values = field.options?.length ? field.options : ["Yes", "No"];
        const index = values.findIndex((_, j) => a.choice === `v${j}`);
        if (index < 0) return;
        result.answers.push({ fieldId: field.id, value: values[index] });
      }
      return { result };
    },
    fallback,
    onUsage: config.onDecisionUsage,
  });
}

export function lookupMatchesDecision(
  fields: ApplicationField[],
  availableData: string,
  config: ApplicationDecisionConfig,
  fallback: () => Promise<{ result: LookupFillResult; usage?: TokenUsage }>,
) {
  // Enumerate verbatim source values; semantic matching belongs to the decision model.
  const candidates = availableData.split(/\n/).flatMap((line, lineIndex) => {
    const colon = line.indexOf(":");
    return colon >= 0 && line.slice(colon + 1).trim()
      ? [
          {
            id: `c${lineIndex}`,
            value: line.slice(colon + 1).trim(),
            source: line,
          },
        ]
      : [];
  });
  return runDecision({
    ...decisionOptions(config),
    family: "application.lookup_match",
    state: decisionJson({ fields, availableData }),
    questions: Object.fromEntries(
      fields.map((field, i) => [
        `f${i}`,
        sourceValueQuestion(
          decisionJson(field),
          Object.fromEntries(candidates.map((c) => [c.id, decisionJson(c)])),
        ),
      ]),
    ),
    accept: (answers) => {
      const fills: LookupFillResult["fills"] = [];
      for (const [i, field] of fields.entries()) {
        const a = answers[`f${i}`];
        const candidate =
          a.type === "choice"
            ? candidates.find((c) => c.id === a.choice)
            : undefined;
        if (
          !candidate ||
          (field.options?.length && !field.options.includes(candidate.value))
        )
          return;
        fills.push({
          fieldId: field.id,
          value: candidate.value,
          source: candidate.source,
        });
      }
      return { result: { fills, unfillable: [] } };
    },
    fallback,
    onUsage: config.onDecisionUsage,
  });
}
