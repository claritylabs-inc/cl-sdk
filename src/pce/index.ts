import { z } from "zod";
import type { GenerateObject, TokenUsage, LogFn } from "../core/types";
import { safeGenerateObject } from "../core/safe-generate";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import { resolveModelBudget } from "../core/model-budget";
import type { SourceRetriever } from "../source";
import {
  type AgenticExecutionMode,
  type CaseCitation,
  type CasePacketArtifact,
  type CaseValidationIssue,
  mergeQuestionAnswers,
  stableCaseId,
  validateQuotedEvidence,
} from "../case";
import {
  type PceCaseState,
  type PceEvidenceSource,
  type PceMissingInfoQuestion,
  type PceNormalizationResult,
  type PceSubmissionPacket,
  type PolicyChangeImpact,
  PceNormalizationResultSchema,
  type PolicyChangeItem,
} from "../schemas/pce";
import { buildPceNormalizePrompt, buildPceReplyPrompt } from "../prompts/pce";

export type PceExecutionModePreference = AgenticExecutionMode | "auto";

export interface PceAgentConfig {
  generateObject?: GenerateObject;
  sourceRetriever?: SourceRetriever;
  retrievalLimit?: number;
  executionMode?: PceExecutionModePreference;
  providerOptions?: Record<string, unknown>;
  modelCapabilities?: ModelCapabilities;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
  onTokenUsage?: (usage: TokenUsage) => void;
  log?: LogFn;
  now?: () => number;
}

export interface ProcessPceChangeRequestInput {
  requestText: string;
  caseId?: string;
  executionMode?: PceExecutionModePreference;
  evidenceSources?: PceEvidenceSource[];
}

export interface ProcessPceChangeRequestResult {
  state: PceCaseState;
  tokenUsage: TokenUsage;
}

export interface ProcessPceReplyInput {
  state: PceCaseState;
  replyText: string;
}

export interface ProcessPceReplyResult {
  state: PceCaseState;
  answersMerged: number;
  tokenUsage: TokenUsage;
}

export interface GeneratePceSubmissionPacketInput {
  state: PceCaseState;
}

const ReplyAnswersSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().optional(),
    fieldPath: z.string().optional(),
    answer: z.string(),
  })),
});

export function createPceAgent(config: PceAgentConfig = {}) {
  const now = config.now ?? Date.now;
  let tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const cases = new Map<string, PceCaseState>();

  function trackUsage(usage?: TokenUsage) {
    if (!usage) return;
    tokenUsage.inputTokens += usage.inputTokens;
    tokenUsage.outputTokens += usage.outputTokens;
    config.onTokenUsage?.(usage);
  }

  function resolveBudget(taskKind: ModelTaskKind, hintTokens: number) {
    return resolveModelBudget({
      taskKind,
      hintTokens,
      modelCapabilities: config.modelCapabilities,
      constraint: config.modelBudgetConstraints?.[taskKind],
    });
  }

  async function processChangeRequest(
    input: ProcessPceChangeRequestInput,
  ): Promise<ProcessPceChangeRequestResult> {
    tokenUsage = { inputTokens: 0, outputTokens: 0 };
    const evidenceSources = await collectPceEvidenceSources(input, config);
    const fallback: PceNormalizationResult = heuristicNormalize(input.requestText, evidenceSources);
    let normalized = fallback;

    if (config.generateObject) {
      const budget = resolveBudget("pce_impact_analysis", 2500);
      const result = await safeGenerateObject(
        config.generateObject as GenerateObject,
        {
          prompt: buildPceNormalizePrompt({ requestText: input.requestText, evidenceSources }),
          schema: PceNormalizationResultSchema,
          maxTokens: budget.maxTokens,
          providerOptions: config.providerOptions,
        },
        { fallback, maxRetries: 1, log: config.log },
      );
      normalized = PceNormalizationResultSchema.parse(result.object);
      trackUsage(result.usage);
    }

    const createdAt = now();
    const items = normalized.items.map((item) => finalizeItem(item, input.requestText));
    const missingInfoQuestions = normalized.missingInfoQuestions.map((question) => {
      const itemId = question.itemId ?? items.find((item) => item.fieldPath === question.fieldPath)?.id;
      return {
        ...question,
        itemId,
        id: question.id ?? stableCaseId("question", [itemId, question.fieldPath, question.question]),
      };
    });
    const validationIssues = validatePceItems(items, evidenceSources);
    const impacts = buildPolicyChangeImpacts(items, evidenceSources);
    const executionMode = selectPceExecutionMode({
      requestedMode: input.executionMode ?? config.executionMode,
      requestText: input.requestText,
      items,
      impacts,
      evidenceSources,
      validationIssues,
      missingInfoQuestions,
    });

    const state: PceCaseState = {
      id: input.caseId ?? stableCaseId("pce", [input.requestText, evidenceSources.map((source) => source.id)]),
      requestText: input.requestText,
      summary: normalized.summary || summarizeItems(items),
      executionMode,
      items,
      impacts,
      evidenceSources,
      validationIssues,
      missingInfoQuestions,
      createdAt,
      updatedAt: createdAt,
    };
    cases.set(state.id, state);

    return { state, tokenUsage };
  }

  async function processReply(input: ProcessPceReplyInput): Promise<ProcessPceReplyResult> {
    tokenUsage = { inputTokens: 0, outputTokens: 0 };
    let answers: z.infer<typeof ReplyAnswersSchema>["answers"] = heuristicParseAnswers(
      input.replyText,
      input.state.missingInfoQuestions,
    );

    if (config.generateObject && input.state.missingInfoQuestions.some((question) => !question.answer)) {
      const budget = resolveBudget("pce_reply_parse", 1000);
      const result = await safeGenerateObject(
        config.generateObject as GenerateObject<z.infer<typeof ReplyAnswersSchema>>,
        {
          prompt: buildPceReplyPrompt({
            replyText: input.replyText,
            openQuestions: input.state.missingInfoQuestions
              .filter((question) => !question.answer)
              .map(({ id, question, fieldPath }) => ({ id, question, fieldPath })),
          }),
          schema: ReplyAnswersSchema,
          maxTokens: budget.maxTokens,
          providerOptions: config.providerOptions,
        },
        { fallback: { answers }, maxRetries: 1, log: config.log },
      );
      answers = ReplyAnswersSchema.parse(result.object).answers;
      trackUsage(result.usage);
    }

    const merged = mergeQuestionAnswers(input.state.missingInfoQuestions, answers);
    const items = applyMissingInfoAnswers(input.state.items, merged.questions);
    const validationIssues = validatePceItems(items, input.state.evidenceSources);
    const impacts = buildPolicyChangeImpacts(items, input.state.evidenceSources);
    const executionMode = selectPceExecutionMode({
      requestedMode: config.executionMode,
      requestText: input.state.requestText,
      items,
      impacts,
      evidenceSources: input.state.evidenceSources,
      validationIssues,
      missingInfoQuestions: merged.questions,
    });
    const state: PceCaseState = {
      ...input.state,
      executionMode,
      items,
      impacts,
      validationIssues,
      missingInfoQuestions: merged.questions,
      updatedAt: now(),
    };
    cases.set(state.id, state);

    return { state, answersMerged: merged.answeredCount, tokenUsage };
  }

  function generateSubmissionPacket(
    input: GeneratePceSubmissionPacketInput | string,
  ): PceSubmissionPacket {
    const state = typeof input === "string" ? cases.get(input) : input.state;
    if (!state) {
      throw new Error(`Policy change case ${String(input)} not found`);
    }
    return buildPceSubmissionPacket(state, now());
  }

  return { processChangeRequest, processReply, generateSubmissionPacket };
}

function applyMissingInfoAnswers(
  items: PolicyChangeItem[],
  questions: PceMissingInfoQuestion[],
): PolicyChangeItem[] {
  return items.map((item) => {
    const answers = questions.filter((question) =>
      question.answer?.trim() &&
      (question.itemId === item.id || (!question.itemId && question.fieldPath === item.fieldPath)),
    );
    if (answers.length === 0) return item;
    const answer = answers[answers.length - 1].answer!.trim();
    return {
      ...item,
      afterValue: item.afterValue ?? answer,
      requestedValue: item.requestedValue ?? answer,
      status: item.status === "needs_info" ? "ready" : item.status,
      userSourceSpanIds: item.userSourceSpanIds ?? [],
    };
  });
}

export async function collectPceEvidenceSources(
  input: ProcessPceChangeRequestInput,
  config?: Pick<PceAgentConfig, "sourceRetriever" | "retrievalLimit" | "log">,
): Promise<PceEvidenceSource[]> {
  const provided = input.evidenceSources ?? [];
  if (!config?.sourceRetriever) return provided;

  try {
    const results = await config.sourceRetriever.searchSourceSpans({
      question: input.requestText,
      limit: config.retrievalLimit ?? 8,
      mode: "hybrid",
    });
    const retrieved = results.map((result): PceEvidenceSource => ({
      id: result.span.id,
      label: result.span.formNumber ?? result.span.sectionId ?? result.span.sourceKind,
      documentId: result.span.documentId,
      page: result.span.pageStart ?? result.span.location?.page,
      fieldPath: result.span.sectionId ?? result.span.location?.fieldPath,
      text: result.span.text,
      metadata: {
        ...result.span.metadata,
        relevance: String(result.relevance),
        sourceKind: result.span.sourceKind ?? result.span.kind,
      },
    }));
    return dedupeEvidenceSources([...provided, ...retrieved]);
  } catch (error) {
    await config.log?.(`PCE source evidence retrieval failed: ${error}`);
    return provided;
  }
}

export function stablePolicyChangeItemId(item: Pick<PolicyChangeItem, "kind" | "affectedPolicyId" | "fieldPath" | "afterValue" | "requestedValue" | "sourceSpanIds">): string {
  return stableCaseId("pci", [
    item.affectedPolicyId,
    item.kind,
    item.fieldPath,
    item.afterValue ?? item.requestedValue ?? "",
    item.sourceSpanIds?.join("|") ?? "",
  ]);
}

export function validatePceItems(items: PolicyChangeItem[], sources: PceEvidenceSource[]): CaseValidationIssue[] {
  return items.flatMap((item) => {
    const issues: CaseValidationIssue[] = [];
    const citation = firstCitationForValue(item.citations, item.beforeValue);
    issues.push(...validateQuotedEvidence({
      itemId: item.id,
      fieldPath: `${item.fieldPath}.beforeValue`,
      quote: item.beforeValue,
      citation,
      sources,
    }));

    if (item.beforeValue?.trim() && item.sourceSpanIds.length === 0 && item.sourceIds.length === 0) {
      issues.push({
        code: "existing_value_missing_source_span",
        severity: "blocking",
        message: `Existing value for ${item.fieldPath} is missing source span evidence.`,
        itemId: item.id,
        fieldPath: item.fieldPath,
      });
    }

    if (item.status === "needs_info" || (!item.afterValue?.trim() && !item.requestedValue?.trim() && item.action !== "remove")) {
      issues.push({
        code: "required_value_missing",
        severity: "blocking",
        message: `Requested value for ${item.fieldPath} is missing.`,
        itemId: item.id,
        fieldPath: item.fieldPath,
      });
    }

    if (
      item.kind === "coverage_change" &&
      item.action !== "add" &&
      item.sourceSpanIds.length === 0 &&
      item.sourceIds.length === 0
    ) {
      issues.push({
        code: "coverage_source_missing",
        severity: "blocking",
        message: `Coverage change for ${item.fieldPath} is not linked to existing coverage evidence.`,
        itemId: item.id,
        fieldPath: item.fieldPath,
      });
    }

    const effectiveDateIssue = validateEffectiveDate(item, sources);
    if (effectiveDateIssue) issues.push(effectiveDateIssue);

    const endorsementConflict = findEndorsementConflict(item, sources);
    if (endorsementConflict) issues.push(endorsementConflict);

    if ((item.kind === "cancellation" || item.kind === "nonrenewal") && (!item.effectiveDate || item.sourceSpanIds.length === 0)) {
      issues.push({
        code: "notice_rule_ambiguous",
        severity: "blocking",
        message: `${item.kind} request needs an effective date and source-backed notice/timing terms.`,
        itemId: item.id,
        fieldPath: item.fieldPath,
      });
    }

    if (item.kind === "certificate_endorsement_request" && !hasCertificateRequirementDetails(item)) {
      issues.push({
        code: "certificate_details_missing",
        severity: "blocking",
        message: "Certificate-driven endorsement request is missing holder or requirement details.",
        itemId: item.id,
        fieldPath: item.fieldPath,
      });
    }

    return dedupeValidationIssues(issues);
  });
}

export function buildPolicyChangeImpacts(
  items: PolicyChangeItem[],
  sources: PceEvidenceSource[],
): PolicyChangeImpact[] {
  return items.map((item) => {
    const citedSources = sources.filter((source) => item.sourceSpanIds.includes(source.id) || item.sourceIds.includes(source.id));
    return {
      itemId: item.id,
      beforeValue: item.beforeValue,
      requestedValue: item.requestedValue ?? item.afterValue,
      likelyEndorsementRequired: item.kind !== "renewal_submission_update",
      carrierApprovalLikelyRequired: item.kind !== "certificate_endorsement_request",
      affectedCoverageForms: Array.from(new Set(
        citedSources
          .map((source) => source.metadata?.formNumber ?? source.label)
          .filter((value): value is string => !!value),
      )).sort(),
      sourceSpanIds: Array.from(new Set([...item.sourceSpanIds, ...item.sourceIds])).sort(),
    };
  });
}

export function selectPceExecutionMode(params: {
  requestedMode?: PceExecutionModePreference;
  requestText: string;
  items: PolicyChangeItem[];
  impacts: PolicyChangeImpact[];
  evidenceSources: PceEvidenceSource[];
  validationIssues: Array<{ severity: string }>;
  missingInfoQuestions?: PceMissingInfoQuestion[];
}): AgenticExecutionMode {
  if (params.requestedMode && params.requestedMode !== "auto") {
    return params.requestedMode;
  }

  if (params.validationIssues.some((issue) => issue.severity === "blocking")) {
    return "hybrid";
  }
  if (hasConflictingEvidence(params.evidenceSources)) {
    return "hybrid";
  }
  if (hasAmbiguousCancellationOrNonrenewal(params.requestText, params.items)) {
    return "hybrid";
  }
  if (hasUnclearCertificateRequest(params.items, params.missingInfoQuestions ?? [])) {
    return "hybrid";
  }
  if (hasMultiFormFinancialChange(params.items, params.impacts)) {
    return "market_eval";
  }

  return "deterministic_tree";
}

function finalizeItem(
  item: Omit<PolicyChangeItem, "id" | "status"> & { id?: string; status?: PolicyChangeItem["status"] },
  requestText: string,
): PolicyChangeItem {
  const status = item.status ?? (!item.afterValue && item.action !== "remove" ? "needs_info" : "ready");
  const citations = item.citations ?? [];
  const sourceSpanIds = item.sourceSpanIds?.length ? item.sourceSpanIds : inferSourceIds(citations);
  const afterValue = item.afterValue ?? item.requestedValue;
  return {
    ...item,
    kind: item.kind ?? inferChangeKind(item.fieldPath, requestText),
    affectedPolicyId: item.affectedPolicyId ?? "unknown",
    afterValue,
    requestedValue: item.requestedValue ?? afterValue,
    sourceSpanIds,
    userSourceSpanIds: item.userSourceSpanIds ?? [],
    id: item.id ?? stablePolicyChangeItemId({
      ...item,
      kind: item.kind ?? inferChangeKind(item.fieldPath, requestText),
      affectedPolicyId: item.affectedPolicyId ?? "unknown",
      afterValue,
      requestedValue: item.requestedValue ?? afterValue,
      sourceSpanIds,
    }),
    label: item.label || item.fieldPath,
    sourceIds: item.sourceIds ?? sourceSpanIds,
    citations,
    confidence: item.confidence ?? (requestText.length > 0 ? "medium" : "low"),
    confidenceScore: item.confidenceScore ?? (requestText.length > 0 ? 0.6 : 0.3),
    status,
  };
}

function firstCitationForValue(citations: CaseCitation[], value?: string): CaseCitation | undefined {
  if (!value) return undefined;
  return citations.find((citation) => citation.quote.trim() === value.trim()) ?? citations[0];
}

function inferSourceIds(citations: CaseCitation[]): string[] {
  return Array.from(new Set(citations.map((citation) => citation.sourceId))).sort();
}

function dedupeEvidenceSources(sources: PceEvidenceSource[]): PceEvidenceSource[] {
  const byId = new Map<string, PceEvidenceSource>();
  for (const source of sources) {
    byId.set(source.id, source);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function hasConflictingEvidence(sources: PceEvidenceSource[]): boolean {
  const signaturesByKey = new Map<string, Set<string>>();
  for (const source of sources) {
    const key = normalizeEvidenceConflictKey(source);
    if (!key) continue;
    const values = extractComparableEvidenceValues(source.text);
    if (values.length === 0) continue;
    const existing = signaturesByKey.get(key) ?? new Set<string>();
    existing.add(values.sort().join("|"));
    signaturesByKey.set(key, existing);
    if (existing.size > 1) return true;
  }
  return false;
}

function normalizeEvidenceConflictKey(source: PceEvidenceSource): string | undefined {
  const fieldPath = source.fieldPath ?? source.metadata?.fieldPath;
  const formNumber = source.metadata?.formNumber;
  const key = fieldPath
    ? `${fieldPath}:${formNumber ?? "default"}`
    : source.label;
  return key?.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractComparableEvidenceValues(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(/\$?\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b%?/g)) {
    values.add(match[0].replace(/[$,%\s]/g, ""));
  }
  for (const match of text.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g)) {
    values.add(match[0]);
  }
  return [...values].filter((value) => value.length > 0);
}

function hasAmbiguousCancellationOrNonrenewal(requestText: string, items: PolicyChangeItem[]): boolean {
  const hasCancellationAction = items.some((item) => item.kind === "cancellation" || item.kind === "nonrenewal");
  if (!hasCancellationAction) return false;
  return /\b(if|unless|maybe|possibly|unsure|unclear|or|pending|conditional)\b/i.test(requestText);
}

function hasUnclearCertificateRequest(
  items: PolicyChangeItem[],
  missingInfoQuestions: PceMissingInfoQuestion[],
): boolean {
  return items.some((item) =>
    item.kind === "certificate_endorsement_request" &&
    (item.status === "needs_info" ||
      !item.afterValue?.trim() ||
      item.confidence === "low" ||
      item.sourceSpanIds.length === 0 ||
      missingInfoQuestions.some((question) => question.itemId === item.id || question.fieldPath === item.fieldPath)),
  );
}

function hasMultiFormFinancialChange(
  items: PolicyChangeItem[],
  impacts: PolicyChangeImpact[],
): boolean {
  const financialItemIds = new Set(items
    .filter((item) => item.kind === "limit_change" || item.kind === "deductible_change")
    .map((item) => item.id));
  return impacts.some((impact) =>
    financialItemIds.has(impact.itemId) &&
    (impact.affectedCoverageForms.length > 1 || impact.sourceSpanIds.length > 1),
  );
}

function validateEffectiveDate(
  item: PolicyChangeItem,
  sources: PceEvidenceSource[],
): CaseValidationIssue | undefined {
  if (!item.effectiveDate) return undefined;
  const requestedDate = parseDateValue(item.effectiveDate);
  if (!requestedDate) {
    return {
      code: "effective_date_unparseable",
      severity: "warning",
      message: `Requested effective date ${item.effectiveDate} could not be parsed.`,
      itemId: item.id,
      fieldPath: "effectiveDate",
    };
  }

  const period = findPolicyPeriod(sources);
  if (!period) return undefined;
  if (requestedDate < period.start || requestedDate > period.end) {
    return {
      code: "effective_date_outside_policy_period",
      severity: "blocking",
      message: `Requested effective date ${item.effectiveDate} is outside the cited policy period.`,
      itemId: item.id,
      fieldPath: "effectiveDate",
      sourceId: period.sourceId,
    };
  }
  return undefined;
}

function findPolicyPeriod(sources: PceEvidenceSource[]): { start: number; end: number; sourceId: string } | undefined {
  for (const source of sources) {
    const metadataStart = source.metadata?.policyEffectiveDate ?? source.metadata?.policyStartDate;
    const metadataEnd = source.metadata?.policyExpirationDate ?? source.metadata?.policyEndDate;
    const start = metadataStart ? parseDateValue(metadataStart) : undefined;
    const end = metadataEnd ? parseDateValue(metadataEnd) : undefined;
    if (start && end) return { start, end, sourceId: source.id };

    const textPeriod = source.text.match(/\b(?:policy\s+period|effective)\b[^.\n]*?(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|-|through)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
    const textStart = textPeriod?.[1] ? parseDateValue(textPeriod[1]) : undefined;
    const textEnd = textPeriod?.[2] ? parseDateValue(textPeriod[2]) : undefined;
    if (textStart && textEnd) return { start: textStart, end: textEnd, sourceId: source.id };
  }
  return undefined;
}

function parseDateValue(value: string): number | undefined {
  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!numeric) return undefined;
  const month = Number(numeric[1]);
  const day = Number(numeric[2]);
  const rawYear = Number(numeric[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return Date.UTC(year, month - 1, day);
}

function findEndorsementConflict(
  item: PolicyChangeItem,
  sources: PceEvidenceSource[],
): CaseValidationIssue | undefined {
  const linkedSources = sources.filter((source) => item.sourceSpanIds.includes(source.id) || item.sourceIds.includes(source.id));
  const conflictSource = linkedSources.find((source) =>
    /\bendorsement\b/i.test(`${source.label ?? ""} ${source.text}`) &&
    /\b(excludes|exclusion|prohibits|not\s+covered|no\s+coverage|must\s+not)\b/i.test(source.text),
  );
  if (!conflictSource) return undefined;
  return {
    code: "endorsement_conflict",
    severity: "blocking",
    message: `Existing endorsement source ${conflictSource.id} may conflict with the requested change.`,
    itemId: item.id,
    fieldPath: item.fieldPath,
    sourceId: conflictSource.id,
  };
}

function hasCertificateRequirementDetails(item: PolicyChangeItem): boolean {
  const text = `${item.label} ${item.afterValue ?? ""} ${item.requestedValue ?? ""} ${item.reason ?? ""}`.toLowerCase();
  const hasHolder = /\b(holder|certificate holder|additional insured|loss payee|lender|landlord)\b/.test(text);
  const hasRequirement = /\b(primary|non[- ]?contributory|waiver|subrogation|notice|endorsement|requirement|wording)\b/.test(text);
  return hasHolder && hasRequirement;
}

function dedupeValidationIssues(issues: CaseValidationIssue[]): CaseValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.itemId ?? ""}:${issue.fieldPath ?? ""}:${issue.sourceId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function heuristicNormalize(requestText: string, evidenceSources: PceEvidenceSource[]): PceNormalizationResult {
  const lower = requestText.toLowerCase();
  const action = lower.includes("remove") || lower.includes("delete")
    ? "remove"
    : lower.includes("add")
      ? "add"
      : "update";
  const effectiveDate = requestText.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/)?.[0];
  const label = requestText.split(/[.;\n]/)[0]?.trim() || "Policy change";
  const quoted = Array.from(requestText.matchAll(/"([^"]+)"/g)).map((match) => match[1]);
  const beforeValue = quoted.find((quote) =>
    evidenceSources.some((source) => source.text.toLowerCase().includes(quote.toLowerCase())),
  );
  const citationSource = beforeValue
    ? evidenceSources.find((source) => source.text.toLowerCase().includes(beforeValue.toLowerCase()))
    : undefined;

  const result: PceNormalizationResult = {
    summary: label,
    items: [{
      action,
      kind: inferChangeKind(inferFieldPath(requestText), requestText),
      affectedPolicyId: evidenceSources.find((source) => source.documentId)?.documentId ?? "unknown",
      fieldPath: inferFieldPath(requestText),
      label,
      beforeValue,
      afterValue: inferAfterValue(requestText, beforeValue),
      requestedValue: inferAfterValue(requestText, beforeValue),
      effectiveDate,
      reason: undefined,
      sourceIds: citationSource ? [citationSource.id] : [],
      sourceSpanIds: citationSource ? [citationSource.id] : [],
      citations: beforeValue && citationSource ? [{
        sourceId: citationSource.id,
        quote: beforeValue,
        page: citationSource.page,
        fieldPath: citationSource.fieldPath,
      }] : [],
      confidence: "low",
      confidenceScore: 0.45,
    }],
    missingInfoQuestions: inferAfterValue(requestText, beforeValue) ? [] : [{
      fieldPath: inferFieldPath(requestText),
      question: "What new value should the carrier endorse for this change?",
      reason: "The request did not include a clear target value.",
    }],
  };
  return result;
}

function inferChangeKind(fieldPath: string, requestText: string): PolicyChangeItem["kind"] {
  const lower = `${fieldPath} ${requestText}`.toLowerCase();
  if (lower.includes("additional insured")) return "additional_insured_change";
  if (lower.includes("named insured")) return "named_insured_change";
  if (lower.includes("limit")) return "limit_change";
  if (lower.includes("deductible")) return "deductible_change";
  if (lower.includes("location") || lower.includes("address")) return "location_change";
  if (lower.includes("vehicle") || lower.includes("auto")) return "vehicle_change";
  if (lower.includes("certificate") || lower.includes("holder")) return "certificate_endorsement_request";
  if (lower.includes("cancel")) return "cancellation";
  if (lower.includes("nonrenew")) return "nonrenewal";
  if (lower.includes("renewal") || lower.includes("submission")) return "renewal_submission_update";
  if (lower.includes("coverage")) return "coverage_change";
  return "general_endorsement";
}

function inferFieldPath(requestText: string): string {
  const lower = requestText.toLowerCase();
  if (lower.includes("address")) return "insured.address";
  if (lower.includes("vehicle")) return "auto.vehicles";
  if (lower.includes("driver")) return "auto.drivers";
  if (lower.includes("limit")) return "coverage.limit";
  if (lower.includes("deductible")) return "coverage.deductible";
  return "policy.change";
}

function inferAfterValue(requestText: string, beforeValue?: string): string | undefined {
  const toMatch = requestText.match(/\bto\s+([^.;\n]+)/i)?.[1]?.trim();
  if (toMatch && toMatch !== beforeValue) return toMatch.replace(/^"|"$/g, "");
  const fromToMatch = requestText.match(/\bfrom\s+(.+?)\s+to\s+([^.;\n]+)/i)?.[2]?.trim();
  return fromToMatch?.replace(/^"|"$/g, "");
}

function heuristicParseAnswers(replyText: string, questions: PceMissingInfoQuestion[]) {
  const unanswered = questions.filter((question) => !question.answer);
  if (unanswered.length !== 1 || !replyText.trim()) return [];
  return [{ questionId: unanswered[0].id, answer: replyText.trim() }];
}

function summarizeItems(items: PolicyChangeItem[]): string {
  return items.map((item) => `${item.action} ${item.label}`).join("; ");
}

export function buildPceSubmissionPacket(state: PceCaseState, createdAt: number): PceSubmissionPacket {
  const citations = uniqueCitations(state.items.flatMap((item) => item.citations));
  const readyItems = state.items.filter((item) => item.status === "ready");
  const openQuestions = state.missingInfoQuestions.filter((question) => !question.answer);
  const artifacts: CasePacketArtifact[] = [
    {
      id: stableCaseId("artifact", [state.id, "underwriter_summary"]),
      kind: "underwriter_summary",
      title: "Underwriter summary",
      content: [
        state.summary,
        "",
        ...state.items.map((item) => `- ${item.action.toUpperCase()} ${item.label}: ${item.beforeValue ?? "(not cited)"} -> ${item.afterValue ?? "(pending)"}`),
        "",
        "Impact analysis:",
        ...state.impacts.map((impact) => `- ${impact.itemId}: endorsement=${impact.likelyEndorsementRequired ? "likely" : "not expected"}, carrierApproval=${impact.carrierApprovalLikelyRequired ? "likely" : "not expected"}`),
      ].join("\n"),
      citations,
    },
    {
      id: stableCaseId("artifact", [state.id, "carrier_email"]),
      kind: "carrier_email",
      title: "Carrier email",
      content: [
        "Please process the following policy change endorsement request:",
        "",
        ...readyItems.map((item) => `- ${item.label}: ${item.afterValue ?? item.action}`),
      ].join("\n"),
      citations,
    },
    {
      id: stableCaseId("artifact", [state.id, "missing_info_request"]),
      kind: "missing_info_request",
      title: "Missing information request",
      content: openQuestions.length
        ? openQuestions.map((question) => `- ${question.question}`).join("\n")
        : "No missing information questions are open.",
      citations: [],
    },
    {
      id: stableCaseId("artifact", [state.id, "json_packet"]),
      kind: "json_packet",
      title: "JSON packet",
      content: JSON.stringify({ caseId: state.id, items: state.items, impacts: state.impacts, evidenceSourceIds: state.evidenceSources.map((source) => source.id) }, null, 2),
      citations,
    },
    {
      id: stableCaseId("artifact", [state.id, "validation_report"]),
      kind: "validation_report",
      title: "Validation report",
      content: state.validationIssues.length
        ? state.validationIssues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`).join("\n")
        : "No validation issues.",
      citations: [],
    },
  ];

  return {
    id: stableCaseId("packet", [state.id, state.updatedAt, state.items.map((item) => item.id)]),
    caseId: state.id,
    pceCase: state,
    artifacts,
    validationIssues: state.validationIssues,
    missingInfoQuestions: state.missingInfoQuestions,
    createdAt,
  };
}

function uniqueCitations(citations: CaseCitation[]): CaseCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.sourceId}:${citation.quote}:${citation.page ?? ""}:${citation.fieldPath ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
