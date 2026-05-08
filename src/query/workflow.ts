import type {
  EvidenceItem,
  QueryClassifyResult,
  QueryRetrievalMode,
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
  retrievalMode: QueryRetrievalMode;
}

export function shouldRetrieveForClassification(classification: QueryClassifyResult): boolean {
  return classification.requiresDocumentLookup || classification.requiresChunkSearch;
}

export function resolveQueryRetrievalMode(params: {
  inputMode?: QueryRetrievalMode;
  configMode?: QueryRetrievalMode;
  classificationMode?: QueryRetrievalMode;
  supportsSourceRetrieval: boolean;
}): QueryRetrievalMode {
  const requestedMode = params.inputMode ?? params.configMode ?? params.classificationMode;
  if (requestedMode) return requestedMode;
  return params.supportsSourceRetrieval ? "hybrid" : "graph_only";
}

export function buildInitialQueryWorkflowPlan(params: {
  classification: QueryClassifyResult;
  attachmentEvidence: EvidenceItem[];
  retrievalMode?: QueryRetrievalMode;
  supportsSourceRetrieval?: boolean;
}): QueryWorkflowPlan {
  const { classification, attachmentEvidence } = params;
  const actions: QueryWorkflowAction[] = [];
  const shouldRetrieve = shouldRetrieveForClassification(classification);
  const retrievalMode = params.retrievalMode ?? resolveQueryRetrievalMode({
    classificationMode: classification.retrievalMode,
    supportsSourceRetrieval: !!params.supportsSourceRetrieval,
  });

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

  return { actions, shouldRetrieve, retrievalMode };
}

export function getWorkflowAction<T extends QueryWorkflowAction["type"]>(
  plan: QueryWorkflowPlan,
  type: T,
): Extract<QueryWorkflowAction, { type: T }> | undefined {
  return plan.actions.find((action): action is Extract<QueryWorkflowAction, { type: T }> => action.type === type);
}
