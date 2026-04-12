import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../core/retry";

describe("withRetry", () => {
  it("returns result on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });
  it("retries on rate limit error", async () => {
    const error = new Error("rate limit exceeded");
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("throws non-rate-limit errors immediately", async () => {
    const error = new Error("bad request");
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn)).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledOnce();
  });
});
