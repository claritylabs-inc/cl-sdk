import { describe, expect, it } from "vitest";
import type { ApplicationField, ReplyIntent } from "../../schemas/application";
import { planApplicationWorkflow, planReplyActions } from "../../application/workflow";

function field(overrides: Partial<ApplicationField> = {}): ApplicationField {
  return {
    id: overrides.id ?? "field-1",
    label: overrides.label ?? "Policy Number",
    section: overrides.section ?? "Policy",
    fieldType: overrides.fieldType ?? "text",
    required: overrides.required ?? false,
    value: overrides.value,
  };
}

describe("application workflow planner", () => {
  it("skips optional application agents when there are no unfilled fields", () => {
    const plan = planApplicationWorkflow({
      fields: [field({ value: "ABC-123" })],
      hasBackfillProvider: true,
      orgContextCount: 2,
      hasDocumentStore: true,
      hasMemoryStore: true,
    });

    expect(plan.runBackfill).toBe(false);
    expect(plan.runContextAutoFill).toBe(false);
    expect(plan.documentSearchFields).toEqual([]);
    expect(plan.runBatching).toBe(false);
  });

  it("skips document search without both stores or when fields are mostly low value", () => {
    const lowValueFields = Array.from({ length: 8 }, (_, index) =>
      field({
        id: `field-${index}`,
        label: `Optional detail ${index}`,
        section: "General",
      }),
    );

    expect(planApplicationWorkflow({
      fields: [field()],
      hasBackfillProvider: false,
      orgContextCount: 0,
      hasDocumentStore: true,
      hasMemoryStore: false,
    }).documentSearchFields).toEqual([]);

    expect(planApplicationWorkflow({
      fields: [field(), ...lowValueFields],
      hasBackfillProvider: false,
      orgContextCount: 0,
      hasDocumentStore: true,
      hasMemoryStore: true,
    }).documentSearchFields).toEqual([]);
  });

  it("plans bounded reply actions from classified intent", () => {
    const intent: ReplyIntent = {
      primaryIntent: "mixed",
      hasAnswers: true,
      questionText: "Where do I find this?",
      lookupRequests: [
        {
          type: "policy",
          description: "Use the policy records",
          targetFieldIds: ["field-1"],
        },
      ],
    };

    const plan = planReplyActions({
      intent,
      currentBatchFields: [field({ value: "ABC-123" })],
      nextBatchFields: [field({ id: "field-2", label: "Premium" })],
      hasDocumentStore: true,
    });

    expect(plan).toEqual({
      parseAnswers: true,
      runLookup: true,
      answerQuestion: true,
      advanceBatch: true,
      generateNextEmail: true,
    });
  });
});
