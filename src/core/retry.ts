import type { LogFn } from "./types";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests")) {
      return true;
    }
  }
  if (typeof error === "object" && error !== null) {
    const status = (error as Record<string, unknown>).status ?? (error as Record<string, unknown>).statusCode;
    if (status === 429) return true;
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
      if (!isRateLimitError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const jitter = Math.random() * 1000;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
      await log?.(`Rate limited, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
