import type { LogFn } from "./types";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limits
    if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests")) {
      return true;
    }
    // Transient provider errors
    if (msg.includes("grammar compilation timed out")) return true;
    if (msg.includes("no output generated")) return true;
    if (msg.includes("overloaded")) return true;
    if (msg.includes("internal server error")) return true;
    if (msg.includes("service unavailable")) return true;
    if (msg.includes("gateway timeout")) return true;
  }
  if (typeof error === "object" && error !== null) {
    const status = (error as Record<string, unknown>).status ?? (error as Record<string, unknown>).statusCode;
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  log?: LogFn,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const jitter = Math.random() * 1000;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
      await log?.(`Retryable error, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
