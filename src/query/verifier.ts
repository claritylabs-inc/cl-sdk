import type { GenerateObject, TokenUsage } from "../core/types";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import { resolveModelBudget } from "../core/model-budget";
import { withRetry } from "../core/retry";
import { buildVerifyPrompt } from "../prompts/query/verify";
import {
  VerifyResultSchema,
  type VerifyResult,
  type SubAnswer,
  type EvidenceItem,
} from "../schemas/query";
import { deterministicQueryGroundingIssues } from "./quality";

export interface VerifierConfig {
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  modelCapabilities?: ModelCapabilities;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
}

/**
 * Verify that sub-answers are grounded in evidence, internally consistent,
 * and complete. Returns approval status and specific issues found.
 */
export async function verify(
  originalQuestion: string,
  subAnswers: SubAnswer[],
  allEvidence: EvidenceItem[],
  config: VerifierConfig,
): Promise<{ result: VerifyResult; usage?: TokenUsage }> {
  const { generateObject, providerOptions } = config;

  const subAnswersJson = JSON.stringify(
    subAnswers.map((sa) => ({
      subQuestion: sa.subQuestion,
      answer: sa.answer,
      citations: sa.citations,
      confidence: sa.confidence,
      needsMoreContext: sa.needsMoreContext,
    })),
    null,
    2,
  );

  const evidenceJson = JSON.stringify(
    allEvidence.map((e) => ({
      source: e.source,
      id: e.sourceSpanId ?? e.chunkId ?? e.documentId ?? e.turnId ?? e.attachmentId,
      chunkId: e.chunkId,
      sourceSpanId: e.sourceSpanId,
      text: e.text.slice(0, 500), // Truncate for context efficiency
      relevance: e.relevance,
    })),
    null,
    2,
  );

  const prompt = buildVerifyPrompt(originalQuestion, subAnswersJson, evidenceJson);
  const budget = resolveModelBudget({
    taskKind: "query_verify",
    hintTokens: 2048,
    modelCapabilities: config.modelCapabilities,
    constraint: config.modelBudgetConstraints?.query_verify,
  });

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: VerifyResultSchema,
      maxTokens: budget.maxTokens,
      taskKind: "query_verify",
      budgetDiagnostics: budget,
      providerOptions,
    }),
  );

  const result = object as VerifyResult;
  const deterministicIssues = deterministicQueryGroundingIssues(subAnswers, allEvidence);
  if (deterministicIssues.length > 0) {
    return {
      result: {
        ...result,
        approved: false,
        issues: Array.from(new Set([...result.issues, ...deterministicIssues])),
        retrySubQuestions: Array.from(new Set([
          ...(result.retrySubQuestions ?? []),
          ...subAnswers
            .filter((answer) => deterministicIssues.some((issue) => issue.includes(`"${answer.subQuestion}"`)))
            .map((answer) => answer.subQuestion),
        ])),
      },
      usage,
    };
  }

  return { result, usage };
}
