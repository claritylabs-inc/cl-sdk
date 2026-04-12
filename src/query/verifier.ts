import type { GenerateObject, TokenUsage } from "../core/types";
import { withRetry } from "../core/retry";
import { buildVerifyPrompt } from "../prompts/query/verify";
import {
  VerifyResultSchema,
  type VerifyResult,
  type SubAnswer,
  type EvidenceItem,
} from "../schemas/query";

export interface VerifierConfig {
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
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
      id: e.chunkId ?? e.documentId ?? e.turnId,
      text: e.text.slice(0, 500), // Truncate for context efficiency
      relevance: e.relevance,
    })),
    null,
    2,
  );

  const prompt = buildVerifyPrompt(originalQuestion, subAnswersJson, evidenceJson);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: VerifyResultSchema,
      maxTokens: 2048,
      providerOptions,
    }),
  );

  return { result: object as VerifyResult, usage };
}
