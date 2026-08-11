import type { GenerateObject, TokenUsage, LogFn, ModelCallTrace } from "./types";
import type { ModelBudgetResolution, ModelTaskKind } from "./model-budget";
import { sanitizeNulls } from "./sanitize";
import { withRetry, type RetryOptions } from "./retry";
import { toStrictSchema } from "./strict-schema";

export interface SafeGenerateOptions<T> {
  /**
   * Return this value instead of throwing when all retries are exhausted.
   *
   * @deprecated Catch `ModelGenerationFailure` at the workflow boundary and
   * make any deterministic fallback explicit there. This option remains in
   * the 4.x contract only for incremental consumer migration.
   */
  fallback?: T;
  /** Number of retries for non-rate-limit errors (schema validation, malformed response). Default 1. */
  maxRetries?: number;
  /** Called on each error for observability. */
  onError?: (error: unknown, attempt: number) => void;
  /** Logger for pipeline status messages. */
  log?: LogFn;
  /** Controls retryable provider-error backoff around the host callback. Use false when the host already owns fallback. */
  retry?: RetryOptions | false;
}

export type ModelGenerationFailureOptions = {
  taskKind?: ModelTaskKind;
  attempts: number;
  cause: unknown;
};

/** A model-backed structured generation exhausted every configured attempt. */
export class ModelGenerationFailure extends Error {
  readonly taskKind?: ModelTaskKind;
  readonly attempts: number;

  constructor(options: ModelGenerationFailureOptions) {
    const detail = options.cause instanceof Error
      ? options.cause.message
      : String(options.cause);
    super(
      `${options.taskKind ?? "structured_generation"} failed after ${options.attempts} attempt${options.attempts === 1 ? "" : "s"}: ${detail}`,
    );
    this.name = "ModelGenerationFailure";
    (this as Error & { cause?: unknown }).cause = options.cause;
    this.taskKind = options.taskKind;
    this.attempts = options.attempts;
  }
}

export interface SafeGenerateParams {
  prompt: string;
  system?: string;
  maxTokens: number;
  taskKind?: ModelTaskKind;
  budgetDiagnostics?: ModelBudgetResolution;
  trace?: ModelCallTrace;
  providerOptions?: Record<string, unknown>;
}

/**
 * Wraps a `generateObject` call with two layers of resilience:
 *
 * 1. Inner: `withRetry` handles retryable provider errors with exponential backoff unless disabled.
 * 2. Outer: catches all other errors (schema validation, malformed JSON, transient API errors)
 *    and retries up to `maxRetries` times. If all retries fail, returns the deprecated 4.x
 *    `fallback` when supplied or throws `ModelGenerationFailure`.
 *
 * This prevents a single malformed LLM response from crashing an entire pipeline.
 */
export async function safeGenerateObject<T>(
  generateObject: GenerateObject<T>,
  params: SafeGenerateParams & { schema: import("zod").ZodSchema<T> },
  options?: SafeGenerateOptions<T>,
): Promise<{ object: T; usage?: TokenUsage }> {
  const maxRetries = options?.maxRetries ?? 1;
  let lastError: unknown;

  // Transform schema for strict structured output compatibility (OpenAI etc.)
  const strictParams = { ...params, schema: toStrictSchema(params.schema) as typeof params.schema };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const generate = () => generateObject(strictParams);
      const result = options?.retry === false
        ? await generate()
        : await withRetry(generate, options?.log, options?.retry);
      return {
        ...result,
        object: params.schema.parse(sanitizeNulls(result.object)),
      };
    } catch (error) {
      lastError = error;
      options?.onError?.(error, attempt);
      await options?.log?.(
        `safeGenerateObject attempt ${attempt + 1}/${maxRetries + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      if (attempt < maxRetries) {
        // Brief pause before retry (not rate-limit backoff — just avoid hammering)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // All retries exhausted
  if (options?.fallback !== undefined) {
    await options?.log?.(
      `safeGenerateObject: all retries exhausted, returning fallback`,
    );
    return { object: options.fallback };
  }

  throw new ModelGenerationFailure({
    taskKind: params.taskKind,
    attempts: maxRetries + 1,
    cause: lastError,
  });
}
