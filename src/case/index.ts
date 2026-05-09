import { z } from "zod";

export const CaseEvidenceSourceSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  documentId: z.string().optional(),
  page: z.number().optional(),
  fieldPath: z.string().optional(),
  text: z.string().describe("Source text available for span validation and citation"),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type CaseEvidenceSource = z.infer<typeof CaseEvidenceSourceSchema>;

export const CaseCitationSchema = z.object({
  sourceId: z.string(),
  quote: z.string(),
  page: z.number().optional(),
  fieldPath: z.string().optional(),
});
export type CaseCitation = z.infer<typeof CaseCitationSchema>;

export const ValidationIssueSeveritySchema = z.enum(["info", "warning", "blocking"]);
export type ValidationIssueSeverity = z.infer<typeof ValidationIssueSeveritySchema>;

export const CaseValidationIssueSchema = z.object({
  code: z.string(),
  severity: ValidationIssueSeveritySchema,
  message: z.string(),
  itemId: z.string().optional(),
  fieldPath: z.string().optional(),
  sourceId: z.string().optional(),
});
export type CaseValidationIssue = z.infer<typeof CaseValidationIssueSchema>;

export const MissingInfoQuestionSchema = z.object({
  id: z.string(),
  itemId: z.string().optional(),
  fieldPath: z.string().optional(),
  question: z.string(),
  reason: z.string(),
  answer: z.string().optional(),
});
export type MissingInfoQuestion = z.infer<typeof MissingInfoQuestionSchema>;

export const CasePacketArtifactKindSchema = z.enum([
  "underwriter_summary",
  "carrier_email",
  "missing_info_request",
  "json_packet",
  "validation_report",
]);
export type CasePacketArtifactKind = z.infer<typeof CasePacketArtifactKindSchema>;

export const CasePacketArtifactSchema = z.object({
  id: z.string(),
  kind: CasePacketArtifactKindSchema,
  title: z.string(),
  content: z.string(),
  citations: z.array(CaseCitationSchema).default([]),
});
export type CasePacketArtifact = z.infer<typeof CasePacketArtifactSchema>;

export const CaseSubmissionPacketSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  artifacts: z.array(CasePacketArtifactSchema),
  validationIssues: z.array(CaseValidationIssueSchema),
  missingInfoQuestions: z.array(MissingInfoQuestionSchema),
  createdAt: z.number(),
});
export type CaseSubmissionPacket = z.infer<typeof CaseSubmissionPacketSchema>;

export const CaseActionSchema = z.enum([
  "inspect_attachments",
  "retrieve_policy_evidence",
  "retrieve_prior_applications",
  "normalize_requested_change",
  "extract_application_fields",
  "fill_from_org_context",
  "fill_from_source_spans",
  "ask_missing_info_questions",
  "run_validation",
  "generate_packet",
  "answer_field_or_case_question",
]);
export type CaseAction = z.infer<typeof CaseActionSchema>;

export const AgenticExecutionModeSchema = z.enum(["deterministic_tree", "market_eval", "hybrid"]);
export type AgenticExecutionMode = z.infer<typeof AgenticExecutionModeSchema>;

export const CaseProposalScoreSchema = z.object({
  grounding: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1),
  determinism: z.number().min(0).max(1),
  risk: z.number().min(0).max(1),
  cost: z.number().min(0).max(1),
});
export type CaseProposalScore = z.infer<typeof CaseProposalScoreSchema>;

export const CaseProposalSchema = z.object({
  id: z.string(),
  sourceSpanIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  missingInfo: z.array(z.string()).default([]),
  validationIssues: z.array(CaseValidationIssueSchema).default([]),
  estimatedRisk: z.number().min(0).max(1).default(0.5),
  estimatedCost: z.number().min(0).max(1).default(0.5),
  score: CaseProposalScoreSchema.optional(),
});
export type CaseProposal = z.infer<typeof CaseProposalSchema>;

export type CaseEvidence = CaseEvidenceSource;

export interface CaseField {
  id: string;
  label: string;
  fieldPath?: string;
  value?: string;
  sourceSpanIds: string[];
  userSourceSpanIds?: string[];
  status?: "draft" | "needs_info" | "ready" | "blocked";
}

export interface CaseItem {
  id: string;
  label?: string;
  kind?: string;
  fieldPath?: string;
  sourceSpanIds: string[];
  citations?: CaseCitation[];
  validationIssues?: CaseValidationIssue[];
  missingInfo?: MissingInfoQuestion[];
}

export interface CaseWorkflowPlan {
  id: string;
  executionMode: AgenticExecutionMode;
  actions: CaseAction[];
  reason?: string;
  budget?: {
    maxActions?: number;
    maxModelCalls?: number;
    maxTokens?: number;
  };
}

export interface CaseState<TItem extends CaseItem = CaseItem> {
  id: string;
  summary?: string;
  executionMode: AgenticExecutionMode;
  items: TItem[];
  evidenceSources: CaseEvidence[];
  validationIssues: CaseValidationIssue[];
  missingInfoQuestions: MissingInfoQuestion[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string>;
}

export interface AnswerMergeResult<TQuestion extends MissingInfoQuestion = MissingInfoQuestion> {
  questions: TQuestion[];
  answeredCount: number;
}

export function stableCaseId(prefix: string, parts: unknown[]): string {
  return `${prefix}-${stableHash(stableStringify(parts)).slice(0, 12)}`;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableHash(input: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < input.length; index++) {
    const char = input.charCodeAt(index);
    hashA ^= char;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= char + index;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, "0")}${(hashB >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function evidenceContainsQuote(source: CaseEvidenceSource | undefined, quote: string): boolean {
  if (!source || !quote.trim()) return false;
  return normalizeForMatch(source.text).includes(normalizeForMatch(quote));
}

export function validateQuotedEvidence(params: {
  itemId?: string;
  fieldPath: string;
  quote?: string;
  citation?: CaseCitation;
  sources: CaseEvidenceSource[];
  severity?: ValidationIssueSeverity;
}): CaseValidationIssue[] {
  const quote = params.quote?.trim();
  if (!quote) return [];

  const citation = params.citation;
  if (!citation) {
    return [{
      code: "missing_citation",
      severity: params.severity ?? "blocking",
      message: `Quoted value for ${params.fieldPath} is missing a citation.`,
      itemId: params.itemId,
      fieldPath: params.fieldPath,
    }];
  }

  const source = params.sources.find((candidate) => candidate.id === citation.sourceId);
  if (!source) {
    return [{
      code: "unknown_source",
      severity: params.severity ?? "blocking",
      message: `Citation source ${citation.sourceId} was not provided for ${params.fieldPath}.`,
      itemId: params.itemId,
      fieldPath: params.fieldPath,
      sourceId: citation.sourceId,
    }];
  }

  const citedQuote = citation.quote.trim() || quote;
  if (!evidenceContainsQuote(source, citedQuote) || !evidenceContainsQuote(source, quote)) {
    return [{
      code: "quote_not_found",
      severity: params.severity ?? "blocking",
      message: `Quoted value for ${params.fieldPath} was not found in source ${source.id}.`,
      itemId: params.itemId,
      fieldPath: params.fieldPath,
      sourceId: source.id,
    }];
  }

  return [];
}

export const validateEvidence = validateQuotedEvidence;

export function mergeQuestionAnswers<TQuestion extends MissingInfoQuestion>(
  questions: TQuestion[],
  answers: Array<{ questionId?: string; fieldPath?: string; answer: string }>,
): AnswerMergeResult<TQuestion> {
  let answeredCount = 0;
  const merged = questions.map((question) => {
    const answer = answers.find((candidate) =>
      (candidate.questionId && candidate.questionId === question.id) ||
      (candidate.fieldPath && candidate.fieldPath === question.fieldPath),
    );
    if (!answer?.answer.trim()) return question;
    answeredCount += question.answer === answer.answer ? 0 : 1;
    return { ...question, answer: answer.answer } as TQuestion;
  });

  return { questions: merged, answeredCount };
}

export const processReply = mergeQuestionAnswers;

export function generateNextMessage(questions: MissingInfoQuestion[]): string {
  const openQuestions = questions.filter((question) => !question.answer?.trim());
  if (openQuestions.length === 0) return "No missing information questions are open.";
  return openQuestions.map((question) => question.question).join("\n");
}

export function scoreCaseProposal(proposal: CaseProposal): CaseProposalScore {
  if (proposal.score) return proposal.score;
  const hasBlockingIssue = proposal.validationIssues.some((issue) => issue.severity === "blocking");
  const grounding = proposal.sourceSpanIds.length > 0 ? 1 : 0;
  return {
    grounding,
    completeness: proposal.missingInfo.length === 0 ? 1 : 0.4,
    consistency: hasBlockingIssue ? 0 : 1,
    determinism: proposal.id.trim().length > 0 ? 1 : 0,
    risk: 1 - proposal.estimatedRisk,
    cost: 1 - proposal.estimatedCost,
  };
}

export function evaluateCaseProposals(proposals: CaseProposal[]): CaseProposal | undefined {
  return proposals
    .filter((proposal) => !proposal.validationIssues.some((issue) =>
      issue.severity === "blocking" && (issue.code === "missing_citation" || issue.code === "unknown_source" || issue.code === "quote_not_found"),
    ))
    .map((proposal) => ({ proposal, score: scoreCaseProposal(proposal) }))
    .sort((left, right) => {
      const leftTotal = totalProposalScore(left.score);
      const rightTotal = totalProposalScore(right.score);
      if (rightTotal !== leftTotal) return rightTotal - leftTotal;
      return left.proposal.id.localeCompare(right.proposal.id);
    })[0]?.proposal;
}

function totalProposalScore(score: CaseProposalScore): number {
  return score.grounding * 3
    + score.completeness * 2
    + score.consistency * 3
    + score.determinism
    + score.risk
    + score.cost;
}
