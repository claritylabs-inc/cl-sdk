import type {
  EvidenceItem,
  QueryClassifyResult,
  SubQuestion,
} from "../schemas/query";

export type QueryWorkflowAction =
  | {
      type: "retrieve";
      subQuestions: SubQuestion[];
      reason: string;
    }
  | {
      type: "reason";
      subQuestions: SubQuestion[];
      reason: string;
    }
  | {
      type: "verify";
      reason: string;
    }
  | {
      type: "respond";
      reason: string;
    };

export interface QueryWorkflowPlan {
  actions: QueryWorkflowAction[];
  shouldRetrieve: boolean;
}

export function shouldRetrieveForClassification(classification: QueryClassifyResult): boolean {
  return classification.requiresDocumentLookup || classification.requiresChunkSearch;
}

export function buildInitialQueryWorkflowPlan(params: {
  classification: QueryClassifyResult;
  attachmentEvidence: EvidenceItem[];
}): QueryWorkflowPlan {
  const { classification, attachmentEvidence } = params;
  const actions: QueryWorkflowAction[] = [];
  const shouldRetrieve = shouldRetrieveForClassification(classification);

  if (shouldRetrieve) {
    actions.push({
      type: "retrieve",
      subQuestions: classification.subQuestions,
      reason: "classification requested document or chunk lookup",
    });
  }

  actions.push({
    type: "reason",
    subQuestions: classification.subQuestions,
    reason:
      shouldRetrieve
        ? "answer with retrieved evidence and any attachment evidence"
        : attachmentEvidence.length > 0
          ? "answer with attachment evidence only"
          : "answer without document retrieval",
  });

  actions.push(
    {
      type: "verify",
      reason: "check grounding and request targeted retries when needed",
    },
    {
      type: "respond",
      reason: "compose final response",
    },
  );

  return { actions, shouldRetrieve };
}

export function getWorkflowAction<T extends QueryWorkflowAction["type"]>(
  plan: QueryWorkflowPlan,
  type: T,
): Extract<QueryWorkflowAction, { type: T }> | undefined {
  return plan.actions.find((action): action is Extract<QueryWorkflowAction, { type: T }> => action.type === type);
}
