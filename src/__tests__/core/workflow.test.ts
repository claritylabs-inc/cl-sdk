import { describe, expect, it } from "vitest";
import { createWorkflowBudget, type WorkflowAction } from "../../core/workflow";

describe("createWorkflowBudget", () => {
  it("tracks maxRounds independently from actions", () => {
    const budget = createWorkflowBudget({ maxRounds: 2 });

    expect(budget.startRound()).toEqual({ shouldRun: true });
    expect(budget.startRound()).toEqual({ shouldRun: true });
    expect(budget.roundsStarted).toBe(2);
    expect(budget.remainingRounds()).toBe(0);
    expect(budget.startRound()).toEqual({
      shouldRun: false,
      reason: "maxRounds budget exhausted (2)",
    });
  });

  it("allows actions up to maxActions using estimated cost", () => {
    const budget = createWorkflowBudget({ maxActions: 3 });
    const cheapAction: WorkflowAction<"lookup"> = {
      name: "lookup",
      reason: "Need more context",
      estimatedCost: 2,
    };
    const expensiveAction: WorkflowAction<"verify"> = {
      name: "verify",
      reason: "Check groundedness",
      estimatedCost: 2,
    };

    expect(budget.evaluateAction(cheapAction)).toEqual({ shouldRun: true });
    budget.recordAction(cheapAction);

    expect(budget.actionsUsed).toBe(2);
    expect(budget.remainingActions()).toBe(1);
    expect(budget.evaluateAction(expensiveAction)).toEqual({
      shouldRun: false,
      reason: "verify exceeds maxActions budget (2 + 2 > 3)",
    });
  });

  it("uses one budget unit for actions without estimated cost", () => {
    const budget = createWorkflowBudget({ maxActions: 1 });
    const action: WorkflowAction = {
      name: "review",
      reason: "Confirm result quality",
    };

    expect(budget.canRunAction(action)).toBe(true);
    budget.recordAction(action);

    expect(budget.canRunAction(action)).toBe(false);
  });

  it("respects action-level shouldRun gates before budget checks", () => {
    const budget = createWorkflowBudget({ maxActions: 10 });
    const action: WorkflowAction = {
      name: "follow-up",
      reason: "Optional refinement",
      estimatedCost: 1,
      shouldRun: false,
    };

    expect(budget.canRunAction(action)).toBe(false);
    expect(budget.evaluateAction(action)).toEqual({
      shouldRun: false,
      reason: "follow-up skipped by action gate",
    });
    expect(budget.actionsUsed).toBe(0);
  });

  it("leaves remaining values undefined for unbounded budgets", () => {
    const budget = createWorkflowBudget();

    expect(budget.remainingRounds()).toBeUndefined();
    expect(budget.remainingActions()).toBeUndefined();
    expect(budget.canStartRound()).toBe(true);
    expect(budget.canRunAction()).toBe(true);
  });

  it("rejects invalid budget limits", () => {
    expect(() => createWorkflowBudget({ maxRounds: -1 })).toThrow("maxRounds must be a non-negative finite number");
    expect(() => createWorkflowBudget({ maxActions: Number.POSITIVE_INFINITY })).toThrow(
      "maxActions must be a non-negative finite number",
    );
  });

  it("rounds positive fractional action costs up and clamps negative costs to zero", () => {
    const budget = createWorkflowBudget({ maxActions: 2 });

    budget.recordAction({ estimatedCost: 0.2 });
    budget.recordAction({ estimatedCost: -5 });

    expect(budget.actionsUsed).toBe(1);
    expect(budget.canRunAction({ estimatedCost: 1.1 })).toBe(false);
  });
});

