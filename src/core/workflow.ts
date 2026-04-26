export interface WorkflowAction<TName extends string = string> {
  /** Stable action identifier for logs, prompts, and switch statements. */
  name: TName;
  /** Short explanation for why this action is being considered. */
  reason: string;
  /** Budget units expected to be consumed. Defaults to 1 when omitted. */
  estimatedCost?: number;
  /** Optional caller-level gate before budget checks are applied. */
  shouldRun?: boolean;
}

export interface WorkflowBudgetOptions {
  /** Maximum workflow rounds. Omit for no round limit. */
  maxRounds?: number;
  /** Maximum action budget units. Omit for no action limit. */
  maxActions?: number;
}

export interface WorkflowBudgetState {
  /** Number of rounds that have been started. */
  roundsStarted: number;
  /** Action budget units consumed so far. */
  actionsUsed: number;
}

export interface WorkflowActionDecision {
  shouldRun: boolean;
  reason?: string;
}

export interface WorkflowBudget extends WorkflowBudgetState {
  canStartRound(): boolean;
  startRound(): WorkflowActionDecision;
  canRunAction(action?: Pick<WorkflowAction, "estimatedCost" | "shouldRun">): boolean;
  evaluateAction(action: WorkflowAction): WorkflowActionDecision;
  recordAction(action?: Pick<WorkflowAction, "estimatedCost">): void;
  remainingRounds(): number | undefined;
  remainingActions(): number | undefined;
}

function actionCost(action?: Pick<WorkflowAction, "estimatedCost">): number {
  return Math.max(0, Math.ceil(action?.estimatedCost ?? 1));
}

function validateLimit(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

export function createWorkflowBudget(options: WorkflowBudgetOptions = {}): WorkflowBudget {
  validateLimit("maxRounds", options.maxRounds);
  validateLimit("maxActions", options.maxActions);

  const budget: WorkflowBudget = {
    roundsStarted: 0,
    actionsUsed: 0,

    canStartRound() {
      return options.maxRounds === undefined || budget.roundsStarted < options.maxRounds;
    },

    startRound() {
      if (!budget.canStartRound()) {
        return {
          shouldRun: false,
          reason: `maxRounds budget exhausted (${options.maxRounds})`,
        };
      }

      budget.roundsStarted += 1;
      return { shouldRun: true };
    },

    canRunAction(action) {
      if (action?.shouldRun === false) return false;
      return options.maxActions === undefined || budget.actionsUsed + actionCost(action) <= options.maxActions;
    },

    evaluateAction(action) {
      if (action.shouldRun === false) {
        return {
          shouldRun: false,
          reason: `${action.name} skipped by action gate`,
        };
      }

      if (!budget.canRunAction(action)) {
        return {
          shouldRun: false,
          reason: `${action.name} exceeds maxActions budget (${budget.actionsUsed} + ${actionCost(action)} > ${options.maxActions})`,
        };
      }

      return { shouldRun: true };
    },

    recordAction(action) {
      budget.actionsUsed += actionCost(action);
    },

    remainingRounds() {
      return options.maxRounds === undefined ? undefined : Math.max(0, options.maxRounds - budget.roundsStarted);
    },

    remainingActions() {
      return options.maxActions === undefined ? undefined : Math.max(0, options.maxActions - budget.actionsUsed);
    },
  };

  return budget;
}

