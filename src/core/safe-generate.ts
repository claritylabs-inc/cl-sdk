import type { GenerateObject, TokenUsage, LogFn } from "./types";
import { withRetry } from "./retry";
import { toStrictSchema } from "./strict-schema";

export interface SafeGenerateOptions<T> {
  /** Return this value instead of throwing when all retries are exhausted. */
  fallback?: T;
  /** Number of retries for non-rate-limit errors (schema validation, malformed response). Default 1. */
  maxRetries?: number;
  /** Called on each error for observability. */
  onError?: (error: unknown, attempt: number) => void;
  /** Logger for pipeline status messages. */
  log?: LogFn;
}

export interface SafeGenerateParams {
  prompt: string;
  system?: string;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}

/**
 * Wraps a `generateObject` call with two layers of resilience:
 *
 * 1. Inner: `withRetry` handles 429 / rate-limit errors with exponential backoff
 * 2. Outer: catches all other errors (schema validation, malformed JSON, transient API errors)
 *    and retries up to `maxRetries` times. If all retries fail, returns `fallback` (if provided)
 *    or re-throws.
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
      const result = await withRetry(
        () => generateObject(strictParams),
        options?.log,
      );
      return result;
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

  throw lastError;
}
