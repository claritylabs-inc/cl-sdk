import type { GenerateObject, TokenUsage } from "../core/types";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import { resolveModelBudget } from "../core/model-budget";
import { withRetry } from "../core/retry";
import { buildReasonPrompt } from "../prompts/query/reason";
import {
  SubAnswerSchema,
  type SubAnswer,
  type EvidenceItem,
  type QueryIntent,
} from "../schemas/query";

export interface ReasonerConfig {
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  modelCapabilities?: ModelCapabilities;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
}

/**
 * Reason over retrieved evidence to answer a single sub-question.
 * Returns a structured sub-answer with citations and confidence.
 */
export async function reason(
  subQuestion: string,
  intent: QueryIntent,
  evidence: EvidenceItem[],
  config: ReasonerConfig,
): Promise<{ subAnswer: SubAnswer; usage?: TokenUsage }> {
  const { generateObject, providerOptions } = config;

  // Format evidence as numbered items for citation reference
  const evidenceText = evidence
    .map((e, i) => {
      const sourceLabel =
        e.source === "source_span"
          ? `[source-span:${e.sourceSpanId}]`
          : e.source === "chunk"
          ? `[chunk:${e.chunkId}]`
          : e.source === "document"
            ? `[doc:${e.documentId}]`
            : e.source === "attachment"
              ? `[attachment:${e.attachmentId}]`
              : `[turn:${e.turnId}]`;
      return `Evidence ${i + 1} ${sourceLabel} (relevance: ${e.relevance.toFixed(2)}):\n${e.text}`;
    })
    .join("\n\n");

  const prompt = buildReasonPrompt(subQuestion, intent, evidenceText);
  const budget = resolveModelBudget({
    taskKind: "query_reason",
    hintTokens: 4096,
    modelCapabilities: config.modelCapabilities,
    constraint: config.modelBudgetConstraints?.query_reason,
  });

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: SubAnswerSchema,
      maxTokens: budget.maxTokens,
      providerOptions,
    }),
  );

  return { subAnswer: object as SubAnswer, usage };
}
