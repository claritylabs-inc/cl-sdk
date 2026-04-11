import { describe, it, expect } from "vitest";
import { pLimit } from "../../core/concurrency";

describe("pLimit", () => {
  it("limits concurrent execution", async () => {
    const limit = pLimit(2);
    let active = 0;
    let maxActive = 0;

    const task = () => limit(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return "done";
    });

    const results = await Promise.all([task(), task(), task(), task()]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual(["done", "done", "done", "done"]);
  });
});
