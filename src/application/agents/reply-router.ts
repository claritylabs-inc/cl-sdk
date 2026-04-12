import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildReplyIntentClassificationPrompt } from "../../prompts/application/reply-intent";
import { ReplyIntentSchema, type ReplyIntent, type ApplicationField } from "../../schemas/application";

/**
 * Classify user reply intent — answers, questions, lookup requests, or mixed.
 * Tiny agent — fast classification task.
 */
export async function classifyReplyIntent(
  fields: ApplicationField[],
  replyText: string,
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
): Promise<{ intent: ReplyIntent; usage?: TokenUsage }> {
  const fieldSummaries = fields.map((f) => ({ id: f.id, label: f.label }));
  const prompt = buildReplyIntentClassificationPrompt(fieldSummaries, replyText);

  const { object, usage } = await withRetry(() =>
    generateObject({
      prompt,
      schema: ReplyIntentSchema,
      maxTokens: 1024,
      providerOptions,
    }),
  );

  return { intent: object as ReplyIntent, usage };
}
