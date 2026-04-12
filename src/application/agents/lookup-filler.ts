import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildLookupFillPrompt } from "../../prompts/application/pdf-mapping";
import { LookupFillResultSchema, type LookupFillResult, type LookupRequest, type ApplicationField } from "../../schemas/application";

/**
 * Fill fields from company records / policy data based on lookup requests.
 * Small agent — matching task against available data.
 */
export async function fillFromLookup(
  requests: LookupRequest[],
  targetFields: ApplicationField[],
  availableData: string,
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ result: LookupFillResult; usage?: TokenUsage }> {
  const requestSummaries = requests.map((r) => ({
    type: r.type,
    description: r.description,
    targetFieldIds: r.targetFieldIds,
  }));

  const fieldSummaries = targetFields.map((f) => ({
    id: f.id,
    label: f.label,
    fieldType: f.fieldType,
  }));

  const prompt = buildLookupFillPrompt(requestSummaries, fieldSummaries, availableData);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: LookupFillResultSchema,
      maxTokens: 4096,
      providerOptions,
    }),
  );

  return { result: object as LookupFillResult, usage };
}
