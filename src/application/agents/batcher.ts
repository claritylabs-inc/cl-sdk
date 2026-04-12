import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildQuestionBatchPrompt } from "../../prompts/application/question-batch";
import { QuestionBatchResultSchema, type QuestionBatchResult, type ApplicationField } from "../../schemas/application";

/**
 * Organize unfilled fields into topic-based batches for user collection.
 * Small agent — grouping task, fast model is fine.
 */
export async function batchQuestions(
  unfilledFields: ApplicationField[],
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ result: QuestionBatchResult; usage?: TokenUsage }> {
  const fieldSummaries = unfilledFields.map((f) => ({
    id: f.id,
    label: f.label,
    text: f.label,
    fieldType: f.fieldType,
    section: f.section,
    required: f.required,
    condition: f.condition,
  }));

  const prompt = buildQuestionBatchPrompt(fieldSummaries);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: QuestionBatchResultSchema,
      maxTokens: 2048,
      providerOptions,
    }),
  );

  return { result: object as QuestionBatchResult, usage };
}
