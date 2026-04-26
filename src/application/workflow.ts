import type { ApplicationField, ReplyIntent } from "../schemas/application";

const MAX_DOCUMENT_SEARCH_FIELDS = 5;
const LOW_VALUE_FIELD_RATIO_LIMIT = 0.6;

export interface ApplicationWorkflowPlan {
  runBackfill: boolean;
  runContextAutoFill: boolean;
  documentSearchFields: ApplicationField[];
  runBatching: boolean;
  unfilledFields: ApplicationField[];
}

export interface ApplicationWorkflowPlanInput {
  fields: ApplicationField[];
  hasBackfillProvider: boolean;
  orgContextCount: number;
  hasDocumentStore: boolean;
  hasMemoryStore: boolean;
}

export interface ReplyActionPlan {
  parseAnswers: boolean;
  runLookup: boolean;
  answerQuestion: boolean;
  advanceBatch: boolean;
  generateNextEmail: boolean;
}

export interface ReplyActionPlanInput {
  intent: ReplyIntent;
  currentBatchFields: ApplicationField[];
  nextBatchFields?: ApplicationField[];
  hasDocumentStore: boolean;
}

export function planApplicationWorkflow(input: ApplicationWorkflowPlanInput): ApplicationWorkflowPlan {
  const unfilledFields = input.fields.filter(isUnfilled);
  const documentSearchFields = planDocumentSearchFields(
    unfilledFields,
    input.hasDocumentStore && input.hasMemoryStore,
  );

  return {
    runBackfill: input.hasBackfillProvider && unfilledFields.length > 0,
    runContextAutoFill: input.orgContextCount > 0 && unfilledFields.length > 0,
    documentSearchFields,
    runBatching: unfilledFields.length > 0,
    unfilledFields,
  };
}

export function planReplyActions(input: ReplyActionPlanInput): ReplyActionPlan {
  const hasCurrentFields = input.currentBatchFields.length > 0;
  const nextBatchNeedsAnswers = (input.nextBatchFields ?? []).some(isUnfilled);
  const hasLookupRequests = (input.intent.lookupRequests?.length ?? 0) > 0;

  return {
    parseAnswers: input.intent.hasAnswers && hasCurrentFields,
    runLookup: hasLookupRequests && input.hasDocumentStore,
    answerQuestion: Boolean(input.intent.questionText)
      && (input.intent.primaryIntent === "question" || input.intent.primaryIntent === "mixed"),
    advanceBatch: hasCurrentFields && input.currentBatchFields.every((field) => !isUnfilled(field)),
    generateNextEmail: nextBatchNeedsAnswers,
  };
}

function planDocumentSearchFields(
  unfilledFields: ApplicationField[],
  hasStores: boolean,
): ApplicationField[] {
  if (!hasStores || unfilledFields.length === 0) return [];

  const searchableFields = unfilledFields.filter(isHighValueLookupField);
  if (searchableFields.length === 0) return [];

  const lowValueRatio = 1 - searchableFields.length / unfilledFields.length;
  if (unfilledFields.length > MAX_DOCUMENT_SEARCH_FIELDS && lowValueRatio > LOW_VALUE_FIELD_RATIO_LIMIT) {
    return [];
  }

  return searchableFields.slice(0, MAX_DOCUMENT_SEARCH_FIELDS);
}

function isUnfilled(field: ApplicationField): boolean {
  return field.value === undefined || field.value.trim() === "";
}

function isHighValueLookupField(field: ApplicationField): boolean {
  const text = `${field.section} ${field.label}`.toLowerCase();

  if (field.required) return true;

  return [
    "carrier",
    "policy",
    "premium",
    "limit",
    "deductible",
    "insured",
    "address",
    "revenue",
    "payroll",
    "effective",
    "expiration",
    "coverage",
    "class code",
    "fein",
    "entity",
  ].some((term) => text.includes(term));
}
