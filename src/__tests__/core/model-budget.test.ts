import { describe, expect, it } from "vitest";

import { resolveModelBudget } from "../../core/model-budget";

describe("resolveModelBudget", () => {
  it("expands long-list extraction budgets when model capabilities allow it", () => {
    const budget = resolveModelBudget({
      taskKind: "extraction_long_list",
      hintTokens: 8192,
      modelCapabilities: {
        maxOutputTokens: 32768,
        longListOutputTokens: 16384,
      },
    });

    expect(budget.maxTokens).toBe(16384);
  });

  it("honors explicit smaller hard constraints", () => {
    const budget = resolveModelBudget({
      taskKind: "extraction_long_list",
      hintTokens: 8192,
      modelCapabilities: {
        maxOutputTokens: 32768,
        longListOutputTokens: 16384,
      },
      constraint: {
        maxOutputTokens: 4096,
      },
    });

    expect(budget.maxTokens).toBe(4096);
  });

  it("reports truncation risk and input warnings", () => {
    const budget = resolveModelBudget({
      taskKind: "extraction_long_list",
      hintTokens: 8192,
      expectedListLength: 200,
      inputContextBytes: 390_000,
      modelCapabilities: {
        maxInputTokens: 100_000,
        maxOutputTokens: 8192,
      },
    });

    expect(budget.estimatedInputTokens).toBe(97500);
    expect(budget.outputTruncationRisk).toBe("high");
    expect(budget.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
