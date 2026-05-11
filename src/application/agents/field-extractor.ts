import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildFieldExtractionPrompt } from "../../prompts/application/field-extraction";
import { FieldExtractionResultSchema, type ApplicationField } from "../../schemas/application";
import { normalizeApplicationFields } from "../field-ids";

/**
 * Extract all fillable fields from an application PDF.
 * Moderate agent — needs enough context to see the full form.
 */
export async function extractFields(
  pdfContent: string,
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
  maxTokens = 8192,
): Promise<{ fields: ApplicationField[]; usage?: TokenUsage }> {
  const prompt = `${buildFieldExtractionPrompt()}\n\nExtract fields from the attached application PDF. Use provider-supplied source units/spans for page numbers and anchors when present. Do not treat raw base64 as readable document text.`;

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: FieldExtractionResultSchema,
      maxTokens,
      taskKind: "application_extract_fields",
      providerOptions: {
        ...providerOptions,
        pdfBase64: providerOptions?.pdfBase64 ?? pdfContent,
      },
    }),
  );

  const result = object as { fields: ApplicationField[] };
  return { fields: normalizeApplicationFields(result.fields), usage };
}
