export type ModelTaskKind =
  | "extraction_classify"
  | "extraction_form_inventory"
  | "extraction_page_map"
  | "extraction_focused"
  | "extraction_long_list"
  | "extraction_referential_lookup"
  | "extraction_review"
  | "extraction_summary"
  | "extraction_format"
  | "query_attachment"
  | "query_classify"
  | "query_reason"
  | "query_verify"
  | "query_respond"
  | "application_classify"
  | "application_extract_fields"
  | "application_auto_fill"
  | "application_lookup"
  | "application_parse_answers"
  | "application_batch"
  | "application_email"
  | "application_pdf_mapping"
  | "pce_impact_analysis"
  | "pce_reply_parse"
  | "pce_packet_generation";

export interface ModelCapabilities {
  /** Human-readable model identifier for diagnostics. */
  model?: string;
  modelName?: string;
  /** Provider/model input context limit for diagnostics. */
  maxInputTokens?: number;
  /** Provider/model hard output limit. Resolved budgets will not exceed this. */
  maxOutputTokens?: number;
  /** Default preferred budget when a task has no specific capability hint. */
  defaultOutputTokens?: number;
  /** Preferred budget for long list extraction tasks such as schedules and sections. */
  longListOutputTokens?: number;
  /** Preferred budgets for individual task kinds. */
  taskOutputTokens?: Partial<Record<ModelTaskKind, number>>;
}

export interface ModelBudgetConstraint {
  /** Preferred budget for this call. */
  outputTokens?: number;
  /** Explicit hard limit for this call, useful for keeping small calls small. */
  maxOutputTokens?: number;
  /** Lower bound after all other preferences are applied. */
  minOutputTokens?: number;
}

export interface ResolveModelBudgetParams {
  taskKind: ModelTaskKind;
  /** Existing per-task constant, now treated as a compatibility hint. */
  hintTokens: number;
  modelCapabilities?: ModelCapabilities;
  constraint?: ModelBudgetConstraint;
  schemaSizeBytes?: number;
  expectedListLength?: number;
  inputContextBytes?: number;
  providerMaxOutputTokens?: number;
}

export interface ModelBudgetResolution {
  taskKind: ModelTaskKind;
  maxTokens: number;
  hintTokens: number;
  modelMaxOutputTokens?: number;
  hardMaxOutputTokens?: number;
  estimatedInputTokens?: number;
  outputTruncationRisk: "low" | "medium" | "high";
  warnings: string[];
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

export function resolveModelBudget(params: ResolveModelBudgetParams): ModelBudgetResolution {
  const { taskKind, modelCapabilities, constraint } = params;
  const hintTokens = positiveInteger(params.hintTokens) ?? 4096;
  const taskCapability = positiveInteger(modelCapabilities?.taskOutputTokens?.[taskKind]);
  const longListCapability = taskKind === "extraction_long_list"
    ? positiveInteger(modelCapabilities?.longListOutputTokens)
    : undefined;
  const defaultCapability = positiveInteger(modelCapabilities?.defaultOutputTokens);
  const constrainedPreference = positiveInteger(constraint?.outputTokens);
  const minOutputTokens = positiveInteger(constraint?.minOutputTokens);
  const modelMaxOutputTokens = positiveInteger(modelCapabilities?.maxOutputTokens);
  const providerMaxOutputTokens = positiveInteger(params.providerMaxOutputTokens);
  const hardMaxOutputTokens = positiveInteger(constraint?.maxOutputTokens) ?? providerMaxOutputTokens;
  const estimatedInputTokens = estimateTokens(params.inputContextBytes);
  const schemaTokens = estimateTokens(params.schemaSizeBytes) ?? 0;
  const expectedListLength = positiveInteger(params.expectedListLength) ?? 0;
  const warnings: string[] = [];

  let maxTokens =
    constrainedPreference
    ?? taskCapability
    ?? longListCapability
    ?? defaultCapability
    ?? hintTokens;

  if (minOutputTokens) {
    maxTokens = Math.max(maxTokens, minOutputTokens);
  }

  if (modelMaxOutputTokens) {
    if (maxTokens > modelMaxOutputTokens) {
      warnings.push(`Resolved ${taskKind} budget was capped by model max output tokens.`);
    }
    maxTokens = Math.min(maxTokens, modelMaxOutputTokens);
  }

  if (hardMaxOutputTokens) {
    if (maxTokens > hardMaxOutputTokens) {
      warnings.push(`Resolved ${taskKind} budget was capped by an explicit hard max output token constraint.`);
    }
    maxTokens = Math.min(maxTokens, hardMaxOutputTokens);
  }

  const expectedOutputFloor = expectedOutputTokensFloor(taskKind, schemaTokens, expectedListLength, hintTokens);
  const outputTruncationRisk = maxTokens < expectedOutputFloor * 0.65
    ? "high"
    : maxTokens < expectedOutputFloor
      ? "medium"
      : "low";

  if (outputTruncationRisk !== "low") {
    warnings.push(`Resolved ${taskKind} budget may be under-sized for the expected output shape.`);
  }

  const maxInputTokens = positiveInteger(modelCapabilities?.maxInputTokens);
  if (estimatedInputTokens && maxInputTokens && estimatedInputTokens > maxInputTokens * 0.9) {
    warnings.push(`Estimated ${taskKind} input context is close to or above the configured model input limit.`);
  }

  return {
    taskKind,
    maxTokens,
    hintTokens,
    modelMaxOutputTokens,
    hardMaxOutputTokens,
    estimatedInputTokens,
    outputTruncationRisk,
    warnings,
  };
}

function estimateTokens(bytes: number | undefined): number | undefined {
  const positive = positiveInteger(bytes);
  if (!positive) return undefined;
  return Math.ceil(positive / 4);
}

function expectedOutputTokensFloor(
  taskKind: ModelTaskKind,
  schemaTokens: number,
  expectedListLength: number,
  hintTokens: number,
): number {
  const listMultiplier = taskKind === "extraction_long_list" ? 90 : 45;
  const listFloor = expectedListLength > 0 ? expectedListLength * listMultiplier : 0;
  return Math.max(Math.ceil(schemaTokens * 1.5), listFloor, Math.floor(hintTokens * 0.75));
}
