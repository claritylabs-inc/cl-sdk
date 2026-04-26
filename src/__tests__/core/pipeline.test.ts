import { describe, expect, it } from "vitest";
import { createPipelineContext, type PipelineCheckpoint } from "../../core/pipeline";

describe("createPipelineContext", () => {
  it("marks earlier ordered phases complete when resuming", () => {
    const resumeFrom: PipelineCheckpoint<{ ok: boolean }> = {
      phase: "extract",
      state: { ok: true },
      timestamp: 1,
    };

    const context = createPipelineContext({
      id: "run-1",
      resumeFrom,
      phaseOrder: ["classify", "plan", "extract", "review"],
    });

    expect(context.isPhaseComplete("classify")).toBe(true);
    expect(context.isPhaseComplete("plan")).toBe(true);
    expect(context.isPhaseComplete("extract")).toBe(true);
    expect(context.isPhaseComplete("review")).toBe(false);
  });

  it("falls back to marking only the resumed phase when no order is provided", () => {
    const context = createPipelineContext({
      id: "run-1",
      resumeFrom: {
        phase: "extract",
        state: { ok: true },
        timestamp: 1,
      },
    });

    expect(context.isPhaseComplete("classify")).toBe(false);
    expect(context.isPhaseComplete("extract")).toBe(true);
  });
});
