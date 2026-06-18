import type {
  ApplicationContextProposal,
  ApplicationField,
  ApplicationPacket,
  ApplicationQuestionGraph,
  ApplicationState,
  ApplicationTemplate,
} from "../schemas/application";
import { buildApplicationQualityReport, type ApplicationQualityReport } from "./quality";
import {
  buildQuestionGraphFromFields,
  flattenQuestionGraph,
  getActiveApplicationFields,
  getNextApplicationQuestions,
  normalizeApplicationQuestionGraph,
} from "./question-graph";

export interface CreateApplicationRunParams {
  applicationId: string;
  template: ApplicationTemplate;
  now?: number;
}

export interface ApplyApplicationAnswer {
  fieldId: string;
  value: string;
  source?: string;
  confidence?: ApplicationField["confidence"];
  sourceSpanIds?: string[];
  userSourceSpanIds?: string[];
}

export function extractQuestionGraphFromFields(
  fields: ApplicationField[],
  options: {
    id: string;
    version?: string;
    title?: string;
    applicationType?: string | null;
    source?: ApplicationQuestionGraph["source"];
  },
): ApplicationQuestionGraph {
  return buildQuestionGraphFromFields(fields, options);
}

export function createApplicationRun(params: CreateApplicationRunParams): ApplicationState {
  const now = params.now ?? Date.now();
  const graph = normalizeApplicationQuestionGraph(params.template.questionGraph);
  const fields = params.template.fields?.length
    ? params.template.fields
    : flattenQuestionGraph(graph);

  return {
    id: params.applicationId,
    templateId: params.template.id,
    templateVersion: params.template.version,
    templateSnapshot: params.template,
    title: params.template.title,
    applicationType: params.template.applicationType,
    questionGraph: graph,
    fields,
    currentBatchIndex: 0,
    status: "collecting",
    createdAt: now,
    updatedAt: now,
  };
}

export function planNextApplicationQuestions(
  state: Pick<ApplicationState, "fields" | "questionGraph" | "batches" | "currentBatchIndex">,
  limit?: number,
): { status: "complete" | "needs_answers"; fieldIds: string[]; fields: ApplicationField[] } {
  const fields = getNextApplicationQuestions(state, limit);
  return {
    status: fields.length === 0 ? "complete" : "needs_answers",
    fieldIds: fields.map((field) => field.id),
    fields,
  };
}

export function applyApplicationAnswers(
  state: ApplicationState,
  answers: ApplyApplicationAnswer[],
  now = Date.now(),
): ApplicationState {
  const answerByFieldId = new Map(answers.map((answer) => [answer.fieldId, answer]));
  const fields = state.fields.map((field) => {
    const answer = answerByFieldId.get(field.id);
    if (!answer) return field;
    return {
      ...field,
      value: answer.value,
      source: answer.source ?? "user",
      confidence: answer.confidence ?? "confirmed",
      sourceSpanIds: answer.sourceSpanIds ?? field.sourceSpanIds,
      userSourceSpanIds: answer.userSourceSpanIds ?? field.userSourceSpanIds,
      validationStatus: "valid" as const,
    };
  });

  const nextState: ApplicationState = {
    ...state,
    fields,
    updatedAt: now,
  };

  const nextQuestions = planNextApplicationQuestions(nextState);
  return {
    ...nextState,
    status: nextQuestions.status === "complete" ? "confirming" : nextState.status,
    qualityReport: buildApplicationQualityReport(nextState),
  };
}

export function proposeContextWrites(state: ApplicationState): ApplicationContextProposal[] {
  return getActiveApplicationFields(state)
    .filter((field) => field.value && field.confidence && field.confidence !== "low")
    .map((field) => ({
      id: `${state.id}:${field.id}:context`,
      fieldId: field.id,
      key: stableContextKey(field),
      value: field.value ?? "",
      category: field.section,
      source: field.source?.startsWith("lookup:") ? "lookup" : "application",
      confidence: field.confidence ?? "medium",
      sourceSpanIds: field.sourceSpanIds,
      userSourceSpanIds: field.userSourceSpanIds,
    }));
}

export function buildApplicationPacket(
  state: ApplicationState,
  options: { submissionNotes?: string; now?: number } = {},
): ApplicationPacket {
  const qualityReport = buildApplicationQualityReport(state);
  const activeFields = getActiveApplicationFields(state);
  const answers = activeFields
    .filter((field) => field.value)
    .map((field) => ({
      fieldId: field.id,
      label: field.label,
      section: field.section,
      value: field.value ?? "",
      source: field.source ?? "unknown",
      confidence: field.confidence,
      sourceSpanIds: field.sourceSpanIds,
      userSourceSpanIds: field.userSourceSpanIds,
    }));

  const missingFieldIds = activeFields
    .filter((field) => field.required && !field.value)
    .map((field) => field.id);

  return {
    id: `${state.id}:packet`,
    applicationId: state.id,
    title: state.title ?? state.applicationType ?? "Insurance Application",
    status: qualityReport.qualityGateStatus === "failed" || missingFieldIds.length > 0 ? "draft" : "broker_ready",
    answers,
    missingFieldIds,
    qualityReport,
    submissionNotes: options.submissionNotes,
    createdAt: options.now ?? Date.now(),
  };
}

export function validateApplicationPacket(packet: ApplicationPacket): ApplicationQualityReport {
  const issues = [...packet.qualityReport.issues];

  if (packet.missingFieldIds.length > 0) {
    issues.push({
      code: "packet_missing_required_answers",
      severity: "blocking",
      message: "Packet still has required unanswered application fields.",
    });
  }

  return {
    ...packet.qualityReport,
    issues,
    qualityGateStatus: issues.some((issue) => issue.severity === "blocking")
      ? "failed"
      : packet.qualityReport.qualityGateStatus,
  };
}

function stableContextKey(field: ApplicationField): string {
  return `${field.section}.${field.label}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
