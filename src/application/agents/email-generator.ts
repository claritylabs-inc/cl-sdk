import type { GenerateText, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildBatchEmailGenerationPrompt } from "../../prompts/application/batch-email";
import type { ApplicationField } from "../../schemas/application";

/**
 * Generate a professional email requesting answers for a batch of fields.
 * Small agent — text generation, fast model produces good emails.
 */
export async function generateBatchEmail(
  batchFields: ApplicationField[],
  batchIndex: number,
  totalBatches: number,
  opts: {
    appTitle?: string;
    totalFieldCount: number;
    filledFieldCount: number;
    previousBatchSummary?: string;
    companyName?: string;
  },
  generateText: GenerateText,
  providerOptions?: Record<string, unknown>,
): Promise<{ text: string; usage?: TokenUsage }> {
  const fieldSummaries = batchFields.map((f) => ({
    id: f.id,
    label: f.label,
    fieldType: f.fieldType,
    options: f.options,
    condition: f.condition,
  }));

  const prompt = buildBatchEmailGenerationPrompt(
    fieldSummaries,
    batchIndex,
    totalBatches,
    opts.appTitle,
    opts.totalFieldCount,
    opts.filledFieldCount,
    opts.previousBatchSummary,
    opts.companyName,
  );

  const { text, usage } = await withRetry(() =>
    generateText({
      prompt,
      maxTokens: 2048,
      providerOptions,
    }),
  );

  return { text, usage };
}
