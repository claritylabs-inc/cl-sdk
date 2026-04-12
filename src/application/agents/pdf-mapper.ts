import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildFlatPdfMappingPrompt, buildAcroFormMappingPrompt } from "../../prompts/application/pdf-mapping";
import { z } from "zod";
import type { ApplicationField, FlatPdfPlacement, AcroFormMapping } from "../../schemas/application";

const FlatMappingResultSchema = z.object({
  placements: z.array(
    z.object({
      fieldId: z.string(),
      page: z.number(),
      x: z.number(),
      y: z.number(),
      text: z.string(),
      fontSize: z.number().optional(),
      isCheckmark: z.boolean().optional(),
    }),
  ),
});

const AcroFormMappingResultSchema = z.object({
  mappings: z.array(
    z.object({
      fieldId: z.string(),
      acroFormName: z.string(),
      value: z.string(),
    }),
  ),
});

/**
 * Map filled fields to flat PDF coordinates for text overlay.
 * Small agent — spatial reasoning task.
 */
export async function mapToFlatPdf(
  filledFields: ApplicationField[],
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ placements: FlatPdfPlacement[]; usage?: TokenUsage }> {
  const fieldSummaries = filledFields
    .filter((f) => f.value)
    .map((f) => ({
      id: f.id,
      label: f.label,
      value: f.value!,
      fieldType: f.fieldType,
    }));

  const prompt = buildFlatPdfMappingPrompt(fieldSummaries);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: FlatMappingResultSchema,
      maxTokens: 8192,
      providerOptions,
    }),
  );

  return { placements: (object as { placements: FlatPdfPlacement[] }).placements, usage };
}

/**
 * Map filled fields to AcroForm field names for fillable PDFs.
 * Small agent — name matching task.
 */
export async function mapToAcroForm(
  filledFields: ApplicationField[],
  acroFormFields: { name: string; type: string; options?: string[] }[],
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ mappings: AcroFormMapping[]; usage?: TokenUsage }> {
  const fieldSummaries = filledFields
    .filter((f) => f.value)
    .map((f) => ({
      id: f.id,
      label: f.label,
      value: f.value,
    }));

  const prompt = buildAcroFormMappingPrompt(fieldSummaries, acroFormFields);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: AcroFormMappingResultSchema,
      maxTokens: 4096,
      providerOptions,
    }),
  );

  return { mappings: (object as { mappings: AcroFormMapping[] }).mappings, usage };
}
