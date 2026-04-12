import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildAutoFillPrompt } from "../../prompts/application/auto-fill";
import { AutoFillResultSchema, type AutoFillResult, type ApplicationField } from "../../schemas/application";
import type { BackfillProvider, PriorAnswer } from "../store";

/**
 * Auto-fill fields from business context and prior answers.
 * Small agent — simple matching task, fast model works well.
 */
export async function autoFillFromContext(
  fields: ApplicationField[],
  orgContext: { key: string; value: string; category: string }[],
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ result: AutoFillResult; usage?: TokenUsage }> {
  const fieldSummaries = fields.map((f) => ({
    id: f.id,
    label: f.label,
    fieldType: f.fieldType,
    section: f.section,
  }));

  const prompt = buildAutoFillPrompt(fieldSummaries, orgContext);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: AutoFillResultSchema,
      maxTokens: 4096,
      providerOptions,
    }),
  );

  return { result: object as AutoFillResult, usage };
}

/**
 * Backfill fields from prior application answers using vector search.
 * No LLM call — pure retrieval from the backfill provider.
 */
export async function backfillFromPriorAnswers(
  fields: ApplicationField[],
  backfillProvider: BackfillProvider,
): Promise<PriorAnswer[]> {
  const unfilled = fields.filter((f) => !f.value);
  if (unfilled.length === 0) return [];

  return backfillProvider.searchPriorAnswers(
    unfilled.map((f) => ({
      id: f.id,
      label: f.label,
      section: f.section,
      fieldType: f.fieldType,
    })),
    { limit: unfilled.length * 2 },
  );
}
