import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildFieldExtractionPrompt } from "../../prompts/application/field-extraction";
import { FieldExtractionResultSchema, type ApplicationField } from "../../schemas/application";

/**
 * Extract all fillable fields from an application PDF.
 * Moderate agent — needs enough context to see the full form.
 */
export async function extractFields(
  pdfContent: string,
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ fields: ApplicationField[]; usage?: TokenUsage }> {
  const prompt = `${buildFieldExtractionPrompt()}\n\nExtract fields from this application:\n${pdfContent}`;

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: FieldExtractionResultSchema,
      maxTokens: 8192,
      providerOptions,
    }),
  );

  const result = object as { fields: ApplicationField[] };
  return { fields: result.fields, usage };
}
