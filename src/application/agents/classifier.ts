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
  maxTokens = 512,
): Promise<{ result: ApplicationClassifyResult; usage?: TokenUsage }> {
  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt: `${APPLICATION_CLASSIFY_PROMPT}\n\nAnalyze the attached insurance document. If text source units are provided in provider options, use them as supporting context. Do not infer from base64 text.`,
      schema: ApplicationClassifyResultSchema,
      maxTokens,
      taskKind: "application_classify",
      providerOptions: {
        ...providerOptions,
        pdfBase64: providerOptions?.pdfBase64 ?? pdfContent,
      },
    }),
  );

  return { result: object as ApplicationClassifyResult, usage };
}
