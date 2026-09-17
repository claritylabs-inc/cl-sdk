import type {
  Decide,
  DecisionAnswer,
  DecisionConfig,
  DecisionInput,
  DecisionQuestion,
} from "../../core/decisions";

export function decisionTestConfig(
  family: string,
  choose: (
    id: string,
    question: DecisionQuestion,
    request: DecisionInput,
  ) => string | number,
): DecisionConfig {
  const decide: Decide = async (request) => {
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const selected = choose(id, question, request);
      if (question.type === "noul")
        answers[id] = { type: "noul", noul: Number(selected) };
      else if (question.type === "choice")
        answers[id] = {
          type: "choice",
          choice: String(selected),
          confidence: 1,
          probabilities: Object.fromEntries(
            Object.keys(question.criteria).map((k) => [
              k,
              k === selected ? 1 : 0,
            ]),
          ),
        };
      else throw new Error("Unexpected score");
    }
    return {
      contractVersion: 1,
      requestId: "synthetic-test",
      model: "synthetic-test",
      answers,
      usage: { inputTokens: 10, outputTokens: 0 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 1,
    };
  };
  return {
    decide,
    decisionPolicy: {
      mode: "legacy",
      families: {
        [family]: {
          mode: "active",
          threshold: 0.99,
          evaluationId: "synthetic-control-test-only",
        },
      },
    },
  };
}
