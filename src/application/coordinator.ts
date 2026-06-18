import type { TokenUsage } from "../core/types";
import type { ModelTaskKind } from "../core/model-budget";
import { resolveModelBudget } from "../core/model-budget";
import { pLimit } from "../core/concurrency";
import type { ApplicationState, ApplicationField } from "../schemas/application";
import type {
  ApplicationPipelineConfig,
  BuildApplicationPacketInput,
  BuildApplicationPacketResult,
  ContextProposalResult,
  CreateApplicationRunInput,
  ApplicationNextQuestions,
  ProcessApplicationInput,
  ProcessApplicationResult,
  ProcessReplyInput,
  ProcessReplyResult,
} from "./types";

import { classifyApplication } from "./agents/classifier";
import { extractFields } from "./agents/field-extractor";
import { autoFillFromContext, backfillFromPriorAnswers } from "./agents/auto-filler";
import { batchQuestions } from "./agents/batcher";
import { classifyReplyIntent } from "./agents/reply-router";
import { parseAnswers } from "./agents/answer-parser";
import { fillFromLookup } from "./agents/lookup-filler";
import { generateBatchEmail } from "./agents/email-generator";
import { buildApplicationQualityReport, reviewBatchEmail } from "./quality";
import { shouldFailQualityGate } from "../core/quality";
import { planApplicationWorkflow, planReplyActions } from "./workflow";
import { buildTextSourceSpans, sourceSpanTextHash } from "../source";
import {
  buildApplicationPacket as buildApplicationPacketFromState,
  createApplicationRun as createApplicationRunFromTemplate,
  planNextApplicationQuestions,
  proposeContextWrites as proposeContextWritesFromState,
  validateApplicationPacket,
} from "./intake";
import { buildQuestionGraphFromFields, getActiveApplicationFields } from "./question-graph";
import type { DocumentChunk } from "../storage/chunk-types";

export function createApplicationPipeline(config: ApplicationPipelineConfig) {
  const {
    generateText,
    generateObject,
    applicationStore,
    templateStore,
    documentStore,
    memoryStore,
    backfillProvider,
    orgContext = [],
    concurrency = 4,
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
    qualityGate = "warn",
    modelCapabilities,
    modelBudgetConstraints,
  } = config;

  const limit = pLimit(concurrency);
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  function trackUsage(usage?: TokenUsage) {
    if (usage) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      onTokenUsage?.(usage);
    }
  }

  function resolveBudget(taskKind: ModelTaskKind, hintTokens: number) {
    return resolveModelBudget({
      taskKind,
      hintTokens,
      modelCapabilities,
      constraint: modelBudgetConstraints?.[taskKind],
    });
  }

  /**
   * Process a new application PDF through the full intake pipeline:
   * classify -> extract fields -> backfill -> auto-fill -> batch questions
   */
  async function processApplication(
    input: ProcessApplicationInput,
  ): Promise<ProcessApplicationResult> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    const { pdfBase64, context } = input;
    const applicationProviderOptions = input.sourceSpans?.length
      ? { ...providerOptions, sourceSpans: input.sourceSpans }
      : providerOptions;
    const id = input.applicationId ?? `app-${Date.now()}`;
    const now = Date.now();
    if (input.template) {
      await templateStore?.saveTemplate(input.template);
    }

    let state: ApplicationState = {
      id,
      templateId: input.template?.id,
      templateVersion: input.template?.version,
      templateSnapshot: input.template,
      pdfBase64: undefined,
      title: undefined,
      applicationType: null,
      questionGraph: input.questionGraph ?? input.template?.questionGraph,
      fields: [],
      qualityReport: undefined,
      batches: undefined,
      currentBatchIndex: 0,
      status: "classifying",
      createdAt: now,
      updatedAt: now,
    };

    onProgress?.("Classifying document...");
    await applicationStore?.save(state);

    let classifyResult;
    try {
      const { result, usage: classifyUsage } = await classifyApplication(
        pdfBase64,
        generateObject,
        applicationProviderOptions,
        resolveBudget("application_classify", 512).maxTokens,
      );
      trackUsage(classifyUsage);
      classifyResult = result;
    } catch (error) {
      await log?.(`Classification failed, treating as non-application: ${error instanceof Error ? error.message : String(error)}`);
      classifyResult = { isApplication: false, confidence: 0, applicationType: null };
    }

    if (!classifyResult.isApplication) {
      state.status = "complete";
      state.updatedAt = Date.now();
      state.qualityReport = buildApplicationQualityReport(state);
      await applicationStore?.save(state);
      return { state, tokenUsage: totalUsage, reviewReport: state.qualityReport };
    }

    state.applicationType = classifyResult.applicationType;
    state.status = "extracting";
    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    // -- Phase 2: Extract Fields --
    onProgress?.("Extracting form fields...");
    let fields: ApplicationField[];
    try {
      const { fields: extractedFields, usage: extractUsage } = await extractFields(
        pdfBase64,
        generateObject,
        applicationProviderOptions,
        resolveBudget("application_extract_fields", 8192).maxTokens,
      );
      trackUsage(extractUsage);
      fields = extractedFields;
    } catch (error) {
      await log?.(`Field extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      fields = [];
    }

    if (fields.length === 0) {
      // No fields extracted — complete gracefully rather than crashing
      await log?.("No fields extracted, completing pipeline with empty result");
      state.status = "complete";
      state.updatedAt = Date.now();
      state.qualityReport = buildApplicationQualityReport(state);
      await applicationStore?.save(state);
      return { state, tokenUsage: totalUsage, reviewReport: state.qualityReport };
    }

    state.fields = fields;
    state.questionGraph = input.questionGraph
      ?? input.template?.questionGraph
      ?? buildQuestionGraphFromFields(fields, {
        id: `${id}:graph`,
        title: classifyResult.applicationType ?? undefined,
        applicationType: classifyResult.applicationType,
        source: "pdf",
      });
    state.title = classifyResult.applicationType ?? undefined;
    state.status = "auto_filling";
    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    // -- Phase 3: Backfill + Auto-Fill --
    onProgress?.(`Auto-filling ${fields.length} fields...`);

    let workflowPlan = planApplicationWorkflow({
      fields: state.fields,
      hasBackfillProvider: Boolean(backfillProvider),
      orgContextCount: orgContext.length,
      hasDocumentStore: Boolean(documentStore),
      hasMemoryStore: Boolean(memoryStore),
    });

    // 3a: Vector-based backfill from prior answers
    if (workflowPlan.runBackfill && backfillProvider) {
      try {
        const priorAnswers = await backfillFromPriorAnswers(state.fields, backfillProvider);
        for (const pa of priorAnswers) {
          const field = state.fields.find((f) => f.id === pa.fieldId);
          if (field && !field.value && pa.relevance > 0.8) {
            field.value = pa.value;
            field.source = `backfill: ${pa.source}`;
            field.confidence = pa.confidence ?? "high";
            field.validationStatus = pa.sourceSpanIds?.length ? "valid" : "needs_review";
            field.sourceSpanIds = pa.sourceSpanIds;
            field.userSourceSpanIds = pa.userSourceSpanIds;
          }
        }
      } catch (e) {
        await log?.(`Backfill failed: ${e}`);
      }
    }

    workflowPlan = planApplicationWorkflow({
      fields: state.fields,
      hasBackfillProvider: false,
      orgContextCount: orgContext.length,
      hasDocumentStore: Boolean(documentStore),
      hasMemoryStore: Boolean(memoryStore),
    });

    const fillTasks: Promise<void>[] = [];

    // 3b: Context-based auto-fill (LLM agent)
    if (workflowPlan.runContextAutoFill) {
      fillTasks.push(
        limit(async () => {
          const unfilledFields = state.fields.filter((f) => !f.value);
          if (unfilledFields.length === 0) return;

          try {
            const { result: autoFillResult, usage: afUsage } = await autoFillFromContext(
              unfilledFields,
              orgContext,
              generateObject,
              providerOptions,
              resolveBudget("application_auto_fill", 4096).maxTokens,
            );
            trackUsage(afUsage);

            for (const match of autoFillResult.matches) {
              const field = state.fields.find((f) => f.id === match.fieldId);
              if (field && !field.value) {
                field.value = match.value;
                field.source = `auto-fill: ${match.contextKey}`;
                field.confidence = match.confidence;
                field.validationStatus = "valid";
              }
            }
          } catch (e) {
            await log?.(`Auto-fill from context failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }),
      );
    }

    // 3c: Document-based backfill (search policies/quotes for matching data)
    if (workflowPlan.documentSearchFields.length > 0 && memoryStore) {
      fillTasks.push(
        (async () => {
          try {
            const searchPromises = workflowPlan.documentSearchFields.map((f) =>
              limit(async () => {
                const chunks = await memoryStore.search(`${f.section} ${f.label}`, { limit: 3 });
                const match = selectMemoryBackfillMatch(f, chunks);
                if (match) {
                  const field = state.fields.find((candidate) => candidate.id === f.id);
                  if (field && !field.value) {
                    field.value = match.value;
                    field.source = match.source;
                    field.confidence = match.confidence;
                    field.validationStatus = match.sourceSpanIds.length > 0 ? "valid" : "needs_review";
                    field.sourceSpanIds = match.sourceSpanIds.length > 0 ? match.sourceSpanIds : undefined;
                  }
                }
              }),
            );
            await Promise.all(searchPromises);
          } catch (e) {
            await log?.(`Document backfill search failed: ${e}`);
          }
        })(),
      );
    }

    await Promise.all(fillTasks);

    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    // -- Phase 4: Batch remaining questions --
    workflowPlan = planApplicationWorkflow({
      fields: state.fields,
      hasBackfillProvider: false,
      orgContextCount: 0,
      hasDocumentStore: false,
      hasMemoryStore: false,
    });
    const unfilledFields = getActiveApplicationFields(state).filter((field) => !field.value);
    if (workflowPlan.runBatching) {
      onProgress?.(`Batching ${unfilledFields.length} remaining questions...`);
      state.status = "batching";

      try {
        const { result: batchResult, usage: batchUsage } = await batchQuestions(
          unfilledFields,
          generateObject,
          providerOptions,
          resolveBudget("application_batch", 2048).maxTokens,
        );
        trackUsage(batchUsage);
        state.batches = batchResult.batches;
      } catch (error) {
        await log?.(`Batching failed, using single-batch fallback: ${error instanceof Error ? error.message : String(error)}`);
        // Fallback: put all unfilled field IDs into a single batch
        state.batches = [unfilledFields.map((f) => f.id)];
      }

      state.currentBatchIndex = 0;
      state.status = "collecting";
    } else {
      state.status = "confirming";
    }

    state.contextProposals = proposeContextWritesFromState(state);
    state.qualityReport = buildApplicationQualityReport(state);

    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    if (shouldFailQualityGate(qualityGate, state.qualityReport.qualityGateStatus)) {
      throw new Error("Application quality gate failed. See state.qualityReport for blocking issues.");
    }

    const filledCount = state.fields.filter((f) => f.value).length;
    onProgress?.(`Application processed: ${filledCount}/${state.fields.length} fields filled, ${state.batches?.length ?? 0} batches to collect.`);

    return { state, tokenUsage: totalUsage, reviewReport: state.qualityReport };
  }

  /**
   * Process a user reply (email, chat message) for an active application.
   * Routes through: intent classification -> answer parsing / lookup / explanation
   */
  async function processReply(input: ProcessReplyInput): Promise<ProcessReplyResult> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    const { applicationId, replyText, context } = input;
    const replySourceSpanIds = input.replySourceSpanIds?.length
      ? input.replySourceSpanIds
      : buildTextSourceSpans({
          documentId: `${applicationId}:reply:${sourceSpanTextHash(replyText).slice(0, 12)}`,
          sourceKind: "email",
          text: replyText,
          metadata: { applicationId },
        }).map((span) => span.id);

    // Load state
    let state: ApplicationState | null = null;
    if (applicationStore) {
      state = await applicationStore.get(applicationId);
    }
    if (!state) {
      throw new Error(`Application ${applicationId} not found`);
    }

    // Get current batch fields
    const currentBatchFieldIds = state.batches?.[state.currentBatchIndex] ?? [];
    const activeFields = getActiveApplicationFields(state);
    const currentBatchFields = activeFields.filter((f) =>
      currentBatchFieldIds.includes(f.id),
    );

    // -- Step 1: Classify reply intent --
    onProgress?.("Classifying reply...");
    let intent;
    try {
      const { intent: classifiedIntent, usage: intentUsage } = await classifyReplyIntent(
        currentBatchFields,
        replyText,
        generateObject,
        providerOptions,
        resolveBudget("application_classify", 1024).maxTokens,
      );
      trackUsage(intentUsage);
      intent = classifiedIntent;
    } catch (error) {
      await log?.(`Reply intent classification failed, defaulting to answers_only: ${error instanceof Error ? error.message : String(error)}`);
      intent = {
        primaryIntent: "answers_only" as const,
        hasAnswers: true,
        questionText: undefined,
        questionFieldIds: undefined,
        lookupRequests: undefined,
      };
    }

    let fieldsFilled = 0;
    let responseText: string | undefined;

    let replyPlan = planReplyActions({
      intent,
      currentBatchFields,
      hasDocumentStore: Boolean(documentStore),
    });

    // -- Step 2: Parse answers if present --
    if (replyPlan.parseAnswers) {
      onProgress?.("Parsing answers...");
      try {
        const { result: parseResult, usage: parseUsage } = await parseAnswers(
          currentBatchFields,
          replyText,
          generateObject,
          providerOptions,
          resolveBudget("application_parse_answers", 4096).maxTokens,
        );
        trackUsage(parseUsage);

        for (const answer of parseResult.answers) {
          const field = state.fields.find((f) => f.id === answer.fieldId);
          if (field) {
            field.value = answer.value;
            field.source = "user";
            field.confidence = "confirmed";
            field.userSourceSpanIds = replySourceSpanIds;
            field.validationStatus = "valid";
            fieldsFilled++;
          }
        }
      } catch (error) {
        await log?.(`Answer parsing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // -- Step 3: Handle lookup requests --
    if (replyPlan.runLookup && intent.lookupRequests?.length) {
      onProgress?.("Processing lookup requests...");
      let availableData = "";
      if (documentStore) {
        try {
          const docs = await documentStore.query({});
          availableData = docs
            .map((d) => {
              const doc = d as Record<string, unknown>;
              return `Document ${doc.id}: ${doc.type} - ${doc.carrier ?? "unknown carrier"} - ${doc.insuredName ?? ""}`;
            })
            .join("\n");
        } catch (e) {
          await log?.(`Document query for lookup failed: ${e}`);
        }
      }

      if (availableData) {
        const targetFields = state.fields.filter((f) =>
          intent.lookupRequests!.some((lr) => lr.targetFieldIds.includes(f.id)),
        );

        try {
          const { result: lookupResult, usage: lookupUsage } = await fillFromLookup(
            intent.lookupRequests,
            targetFields,
            availableData,
            generateObject,
            providerOptions,
            resolveBudget("application_lookup", 4096).maxTokens,
          );
          trackUsage(lookupUsage);

          for (const fill of lookupResult.fills) {
            const field = state.fields.find((f) => f.id === fill.fieldId);
            if (field) {
              field.value = fill.value;
              field.source = `lookup: ${fill.source}`;
              field.confidence = "high";
              field.validationStatus = fill.sourceSpanIds?.length ? "valid" : "needs_review";
              if (fill.sourceSpanIds?.length) {
                field.sourceSpanIds = fill.sourceSpanIds;
              }
              fieldsFilled++;
            }
          }
        } catch (error) {
          await log?.(`Lookup fill failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // -- Step 4: Handle questions about fields --
    if (replyPlan.answerQuestion && intent.questionText) {
      try {
        const budget = resolveBudget("application_email", 512);
        const { text, usage } = await generateText({
          prompt: `The user is filling out an insurance application and asked: "${intent.questionText}"\n\nProvide a brief, helpful explanation (2-3 sentences). End with "Just reply with the answer when you're ready and I'll fill it in."`,
          maxTokens: budget.maxTokens,
          taskKind: "application_email",
          budgetDiagnostics: budget,
          providerOptions,
        });
        trackUsage(usage);
        responseText = text;
      } catch (error) {
        await log?.(`Question response generation failed: ${error instanceof Error ? error.message : String(error)}`);
        responseText = `I wasn't able to generate an explanation for your question. Could you rephrase it, or just provide the answer directly?`;
      }
    }

    // -- Step 5: Advance batch if current batch is complete --
    const activeCurrentBatchFieldIds = currentBatchFields.map((field) => field.id);
    const currentBatchComplete = activeCurrentBatchFieldIds.every(
      (fid) => state!.fields.find((f) => f.id === fid)?.value,
    );

    let nextBatchIndex: number | undefined;
    let nextBatchFields: ApplicationField[] | undefined;
    if (state.batches) {
      for (let index = state.currentBatchIndex + 1; index < state.batches.length; index++) {
        const activeCandidateFields = getActiveApplicationFields(state);
        const candidateFields = activeCandidateFields.filter((f) => state.batches![index].includes(f.id));
        if (candidateFields.some((f) => !f.value)) {
          nextBatchIndex = index;
          nextBatchFields = candidateFields;
          break;
        }
      }
    }

    replyPlan = planReplyActions({
      intent,
      currentBatchFields,
      nextBatchFields,
      hasDocumentStore: Boolean(documentStore),
    });

    if (currentBatchComplete && replyPlan.advanceBatch && state.batches) {
      if (nextBatchIndex !== undefined && nextBatchFields) {
        state.currentBatchIndex = nextBatchIndex;

        const filledCount = state.fields.filter((f) => f.value).length;

        if (replyPlan.generateNextEmail) {
          try {
            const { text: emailText, usage: emailUsage } = await generateBatchEmail(
              nextBatchFields,
              state.currentBatchIndex,
              state.batches.length,
              {
                appTitle: state.title,
                totalFieldCount: state.fields.length,
                filledFieldCount: filledCount,
                companyName: context?.companyName,
              },
              generateText,
              providerOptions,
              resolveBudget("application_email", 2048).maxTokens,
            );
            trackUsage(emailUsage);
            const emailReview = reviewBatchEmail(emailText, nextBatchFields);
            state.qualityReport = {
              ...(buildApplicationQualityReport(state)),
              emailReview,
            };

            if (!responseText) {
              responseText = emailText;
            } else {
              responseText += `\n\n${emailText}`;
            }
          } catch (error) {
            await log?.(`Batch email generation failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        // All batches complete
        state.status = "confirming";
      }
    }

    state.updatedAt = Date.now();
    state.contextProposals = proposeContextWritesFromState(state);
    state.qualityReport = buildApplicationQualityReport(state);
    await applicationStore?.save(state);

    if (shouldFailQualityGate(qualityGate, state.qualityReport.qualityGateStatus)) {
      throw new Error("Application quality gate failed. See state.qualityReport for blocking issues.");
    }

    return {
      state,
      intent: intent.primaryIntent,
      fieldsFilled,
      responseText,
      tokenUsage: totalUsage,
      reviewReport: state.qualityReport,
    };
  }

  /**
   * Generate the email for the current batch of questions.
   */
  async function generateCurrentBatchEmail(
    applicationId: string,
    opts?: { companyName?: string; previousBatchSummary?: string },
  ): Promise<{ text: string; tokenUsage: TokenUsage }> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };

    const state = await applicationStore?.get(applicationId);
    if (!state) throw new Error(`Application ${applicationId} not found`);
    if (!state.batches?.length) throw new Error("No batches available");

    const batchFieldIds = state.batches[state.currentBatchIndex];
    const batchFields = getActiveApplicationFields(state).filter((f) => batchFieldIds.includes(f.id));
    const filledCount = state.fields.filter((f) => f.value).length;

    const { text, usage } = await generateBatchEmail(
      batchFields,
      state.currentBatchIndex,
      state.batches.length,
      {
        appTitle: state.title,
        totalFieldCount: state.fields.length,
        filledFieldCount: filledCount,
        companyName: opts?.companyName,
        previousBatchSummary: opts?.previousBatchSummary,
      },
      generateText,
      providerOptions,
      resolveBudget("application_email", 2048).maxTokens,
    );
    trackUsage(usage);

    const emailReview = reviewBatchEmail(text, batchFields);
    state.qualityReport = {
      ...(buildApplicationQualityReport(state)),
      emailReview,
    };
    await applicationStore?.save(state);

    return { text, tokenUsage: totalUsage };
  }

  /**
   * Get a summary of the current application state for confirmation.
   */
  async function getConfirmationSummary(
    applicationId: string,
  ): Promise<{ text: string; tokenUsage: TokenUsage }> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };

    const state = await applicationStore?.get(applicationId);
    if (!state) throw new Error(`Application ${applicationId} not found`);

    const filledFields = state.fields.filter((f) => f.value);
    const fieldSummary = filledFields
      .map((f) => `${f.section} > ${f.label}: ${f.value} (source: ${f.source ?? "unknown"})`)
      .join("\n");

    const budget = resolveBudget("application_email", 4096);
    const { text, usage } = await generateText({
      prompt: `Format these filled insurance application fields as a clean confirmation summary for the user to review. Group by section, show each field as "Label: Value". End with a note asking them to confirm or request changes.\n\nApplication: ${state.title ?? "Insurance Application"}\n\nFields:\n${fieldSummary}`,
      maxTokens: budget.maxTokens,
      taskKind: "application_email",
      budgetDiagnostics: budget,
      providerOptions,
    });
    trackUsage(usage);

    return { text, tokenUsage: totalUsage };
  }

  async function createApplicationRun(input: CreateApplicationRunInput): Promise<ApplicationState> {
    const state = createApplicationRunFromTemplate(input);
    await applicationStore?.save(state);
    return state;
  }

  async function planNextQuestions(applicationId: string, limit?: number): Promise<ApplicationNextQuestions> {
    const state = await applicationStore?.get(applicationId);
    if (!state) throw new Error(`Application ${applicationId} not found`);
    return planNextApplicationQuestions(state, limit);
  }

  async function proposeContextWrites(applicationId: string): Promise<ContextProposalResult> {
    const state = await applicationStore?.get(applicationId);
    if (!state) throw new Error(`Application ${applicationId} not found`);
    const proposals = proposeContextWritesFromState(state);
    await applicationStore?.save({
      ...state,
      contextProposals: proposals,
      updatedAt: Date.now(),
    });
    return { proposals };
  }

  async function buildApplicationPacket(input: BuildApplicationPacketInput): Promise<BuildApplicationPacketResult> {
    const state = await applicationStore?.get(input.applicationId);
    if (!state) throw new Error(`Application ${input.applicationId} not found`);
    const packet = buildApplicationPacketFromState(state, {
      submissionNotes: input.submissionNotes,
      now: input.now,
    });
    const reviewReport = validateApplicationPacket(packet);
    await applicationStore?.save({
      ...state,
      packet: { ...packet, qualityReport: reviewReport },
      status: reviewReport.qualityGateStatus === "failed" ? "broker_review" : "packet_ready",
      qualityReport: reviewReport,
      updatedAt: Date.now(),
    });
    return { packet: { ...packet, qualityReport: reviewReport }, reviewReport };
  }

  return {
    processApplication,
    processReply,
    generateCurrentBatchEmail,
    getConfirmationSummary,
    createApplicationRun,
    planNextQuestions,
    proposeContextWrites,
    buildApplicationPacket,
  };
}

function selectMemoryBackfillMatch(
  field: ApplicationField,
  chunks: DocumentChunk[],
): { value: string; source: string; confidence: "high" | "medium"; sourceSpanIds: string[] } | null {
  for (const chunk of chunks) {
    const value = chunk.metadata.value
      ?? chunk.metadata.answer
      ?? chunk.metadata.fieldValue;
    if (!value) continue;

    const metadataFieldId = chunk.metadata.fieldId ?? chunk.metadata.applicationFieldId;
    const metadataLabel = chunk.metadata.fieldLabel?.toLowerCase();
    const labelMatches = metadataLabel === field.label.toLowerCase();
    if (metadataFieldId && metadataFieldId !== field.id && !labelMatches) continue;

    return {
      value,
      source: chunk.metadata.source ?? `memory: ${chunk.documentId}`,
      confidence: metadataFieldId === field.id || labelMatches ? "high" : "medium",
      sourceSpanIds: parseSourceSpanIds(chunk.metadata.sourceSpanIds),
    };
  }

  return null;
}

function parseSourceSpanIds(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}
