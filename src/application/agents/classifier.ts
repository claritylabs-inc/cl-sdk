import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { APPLICATION_CLASSIFY_PROMPT } from "../../prompts/application/classify";
import { ApplicationClassifyResultSchema, type ApplicationClassifyResult } from "../../schemas/application";

/**
 * Classify whether a PDF is an insurance application form.
 * Small, fast agent — suitable for cheap/fast models.
 */
export async function classifyApplication(
  pdfContent: string,
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ result: ApplicationClassifyResult; usage?: TokenUsage }> {
  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt: `${APPLICATION_CLASSIFY_PROMPT}\n\nAnalyze the following document content:\n${pdfContent}`,
      schema: ApplicationClassifyResultSchema,
      maxTokens: 512,
      providerOptions,
    }),
  );

  return { result: object as ApplicationClassifyResult, usage };
}
