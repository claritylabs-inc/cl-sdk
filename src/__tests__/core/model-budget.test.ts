import { describe, expect, it } from "vitest";

import { resolveModelBudget } from "../../core/model-budget";

describe("resolveModelBudget", () => {
  it("uses the task preference and treats the model max as a cap", () => {
    const budget = resolveModelBudget({
      taskKind: "extraction_long_list",
      hintTokens: 8192,
      modelCapabilities: {
        maxOutputTokens: 32768,
        longListOutputTokens: 16384,
      },
    });

    expect(budget.maxTokens).toBe(16384);
    expect(budget.preferredOutputTokens).toBe(16384);
  });

  it("uses the call hint before a generic model default", () => {
    const budget = resolveModelBudget({
      taskKind: "extraction_source_tree",
      hintTokens: 4096,
      modelCapabilities: {
        maxOutputTokens: 32768,
        defaultOutputTokens: 8192,
      },
    });

    expect(budget.maxTokens).toBe(4096);
    expect(budget.preferredOutputTokens).toBe(4096);
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

  it("reports input warnings without forcing low task preferences into output caps", () => {
    const budget = resolveModelBudget({
      taskKind: "extraction_long_list",
      hintTokens: 8192,
      expectedListLength: 100,
      inputContextBytes: 390_000,
      modelCapabilities: {
        maxInputTokens: 100_000,
        maxOutputTokens: 32768,
      },
    });

    expect(budget.estimatedInputTokens).toBe(97500);
    expect(budget.maxTokens).toBe(8192);
    expect(budget.outputTruncationRisk).toBe("medium");
    expect(budget.warnings).toEqual([
      "Resolved extraction_long_list budget may be under-sized for the expected output shape.",
      "Estimated extraction_long_list input context is close to or above the configured model input limit.",
    ]);
  });
});
