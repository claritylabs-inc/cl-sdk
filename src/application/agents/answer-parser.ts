import {
  boundedAnswersDecision,
  type ApplicationDecisionConfig,
} from "../decisions";
import type { GenerateObject, TokenUsage } from "../../core/types";
import { withRetry } from "../../core/retry";
import { buildAnswerParsingPrompt } from "../../prompts/application/answer-parsing";
import {
  AnswerParsingResultSchema,
  type AnswerParsingResult,
  type ApplicationField,
} from "../../schemas/application";

/**
 * Parse answers from user reply text.
 * Small agent — extraction task, fast model works well.
 */
export async function parseAnswers(
  fields: ApplicationField[],
  replyText: string,
  generateObject: GenerateObject,
  providerOptions?: Record<string, unknown>,
  maxTokens = 4096,
  decisions: ApplicationDecisionConfig = {},
): Promise<{ result: AnswerParsingResult; usage?: TokenUsage }> {
  return boundedAnswersDecision(fields, replyText, decisions, async () => {
    const questions = fields.map((f) => ({
      id: f.id,
      label: f.label,
      text: f.label,
      fieldType: f.fieldType,
    }));

    const prompt = buildAnswerParsingPrompt(questions, replyText);

    const { object, usage } = await withRetry(() =>
      generateObject({
        prompt,
        schema: AnswerParsingResultSchema,
        maxTokens,
        taskKind: "application_parse_answers",
        providerOptions,
      }),
    );

    return { result: object as AnswerParsingResult, usage };
  });
}
