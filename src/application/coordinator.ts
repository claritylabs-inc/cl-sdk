import type { TokenUsage } from "../core/types";
import { pLimit } from "../core/concurrency";
import { safeGenerateObject } from "../core/safe-generate";
import type { ApplicationState, ApplicationField } from "../schemas/application";
import type {
  ApplicationPipelineConfig,
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

export function createApplicationPipeline(config: ApplicationPipelineConfig) {
  const {
    generateText,
    generateObject,
    applicationStore,
    documentStore,
    memoryStore,
    backfillProvider,
    orgContext = [],
    concurrency = 4,
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
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

  /**
   * Process a new application PDF through the full intake pipeline:
   * classify -> extract fields -> backfill -> auto-fill -> batch questions
   */
  async function processApplication(
    input: ProcessApplicationInput,
  ): Promise<ProcessApplicationResult> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    const { pdfBase64, context } = input;
    const id = input.applicationId ?? `app-${Date.now()}`;
    const now = Date.now();

    // Initialize state
    let state: ApplicationState = {
      id,
      pdfBase64: undefined,
      title: undefined,
      applicationType: null,
      fields: [],
      batches: undefined,
      currentBatchIndex: 0,
      status: "classifying",
      createdAt: now,
      updatedAt: now,
    };

    // -- Phase 1: Classify --
    onProgress?.("Classifying document...");
    // Save state before LLM call so crashes preserve last good state
    await applicationStore?.save(state);

    let classifyResult;
    try {
      const { result, usage: classifyUsage } = await classifyApplication(
        pdfBase64.slice(0, 2000),
        generateObject,
        providerOptions,
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
      await applicationStore?.save(state);
      return { state, tokenUsage: totalUsage };
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
        providerOptions,
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
      await applicationStore?.save(state);
      return { state, tokenUsage: totalUsage };
    }

    state.fields = fields;
    state.title = classifyResult.applicationType ?? undefined;
    state.status = "auto_filling";
    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    // -- Phase 3: Backfill + Auto-Fill (parallel) --
    onProgress?.(`Auto-filling ${fields.length} fields...`);

    const fillTasks: Promise<void>[] = [];

    // 3a: Vector-based backfill from prior answers
    if (backfillProvider) {
      fillTasks.push(
        (async () => {
          try {
            const priorAnswers = await backfillFromPriorAnswers(fields, backfillProvider);
            for (const pa of priorAnswers) {
              const field = state.fields.find((f) => f.id === pa.fieldId);
              if (field && !field.value && pa.relevance > 0.8) {
                field.value = pa.value;
                field.source = `backfill: ${pa.source}`;
                field.confidence = "high";
              }
            }
          } catch (e) {
            await log?.(`Backfill failed: ${e}`);
          }
        })(),
      );
    }

    // 3b: Context-based auto-fill (LLM agent)
    if (orgContext.length > 0) {
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
            );
            trackUsage(afUsage);

            for (const match of autoFillResult.matches) {
              const field = state.fields.find((f) => f.id === match.fieldId);
              if (field && !field.value) {
                field.value = match.value;
                field.source = `auto-fill: ${match.contextKey}`;
                field.confidence = match.confidence;
              }
            }
          } catch (e) {
            await log?.(`Auto-fill from context failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }),
      );
    }

    // 3c: Document-based backfill (search policies/quotes for matching data)
    if (documentStore && memoryStore) {
      fillTasks.push(
        (async () => {
          try {
            const unfilledFields = state.fields.filter((f) => !f.value);
            const searchPromises = unfilledFields.slice(0, 10).map((f) =>
              limit(async () => {
                const chunks = await memoryStore.search(f.label, { limit: 3 });
                for (const chunk of chunks) {
                  if (!state.fields.find((sf) => sf.id === f.id)?.value) {
                    // Store as potential match -- don't auto-fill from chunks directly
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
    const unfilledFields = state.fields.filter((f) => !f.value);
    if (unfilledFields.length > 0) {
      onProgress?.(`Batching ${unfilledFields.length} remaining questions...`);
      state.status = "batching";

      try {
        const { result: batchResult, usage: batchUsage } = await batchQuestions(
          unfilledFields,
          generateObject,
          providerOptions,
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

    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    const filledCount = state.fields.filter((f) => f.value).length;
    onProgress?.(`Application processed: ${filledCount}/${state.fields.length} fields filled, ${state.batches?.length ?? 0} batches to collect.`);

    return { state, tokenUsage: totalUsage };
  }

  /**
   * Process a user reply (email, chat message) for an active application.
   * Routes through: intent classification -> answer parsing / lookup / explanation
   */
  async function processReply(input: ProcessReplyInput): Promise<ProcessReplyResult> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    const { applicationId, replyText, context } = input;

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
    const currentBatchFields = state.fields.filter((f) =>
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

    // -- Step 2: Parse answers if present --
    if (intent.hasAnswers) {
      onProgress?.("Parsing answers...");
      try {
        const { result: parseResult, usage: parseUsage } = await parseAnswers(
          currentBatchFields,
          replyText,
          generateObject,
          providerOptions,
        );
        trackUsage(parseUsage);

        for (const answer of parseResult.answers) {
          const field = state.fields.find((f) => f.id === answer.fieldId);
          if (field) {
            field.value = answer.value;
            field.source = "user";
            field.confidence = "confirmed";
            fieldsFilled++;
          }
        }
      } catch (error) {
        await log?.(`Answer parsing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // -- Step 3: Handle lookup requests --
    if (intent.lookupRequests?.length) {
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
          );
          trackUsage(lookupUsage);

          for (const fill of lookupResult.fills) {
            const field = state.fields.find((f) => f.id === fill.fieldId);
            if (field) {
              field.value = fill.value;
              field.source = `lookup: ${fill.source}`;
              field.confidence = "high";
              fieldsFilled++;
            }
          }
        } catch (error) {
          await log?.(`Lookup fill failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // -- Step 4: Handle questions about fields --
    if (intent.primaryIntent === "question" || intent.primaryIntent === "mixed") {
      if (intent.questionText) {
        try {
          const { text, usage } = await generateText({
            prompt: `The user is filling out an insurance application and asked: "${intent.questionText}"\n\nProvide a brief, helpful explanation (2-3 sentences). End with "Just reply with the answer when you're ready and I'll fill it in."`,
            maxTokens: 512,
            providerOptions,
          });
          trackUsage(usage);
          responseText = text;
        } catch (error) {
          await log?.(`Question response generation failed: ${error instanceof Error ? error.message : String(error)}`);
          responseText = `I wasn't able to generate an explanation for your question. Could you rephrase it, or just provide the answer directly?`;
        }
      }
    }

    // -- Step 5: Advance batch if current batch is complete --
    const currentBatchComplete = currentBatchFieldIds.every(
      (fid) => state!.fields.find((f) => f.id === fid)?.value,
    );

    if (currentBatchComplete && state.batches) {
      if (state.currentBatchIndex < state.batches.length - 1) {
        state.currentBatchIndex++;

        const nextBatchFieldIds = state.batches[state.currentBatchIndex];
        const nextBatchFields = state.fields.filter((f) =>
          nextBatchFieldIds.includes(f.id),
        );

        const filledCount = state.fields.filter((f) => f.value).length;

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
          );
          trackUsage(emailUsage);

          if (!responseText) {
            responseText = emailText;
          } else {
            responseText += `\n\n${emailText}`;
          }
        } catch (error) {
          await log?.(`Batch email generation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // All batches complete
        state.status = "confirming";
      }
    }

    state.updatedAt = Date.now();
    await applicationStore?.save(state);

    return {
      state,
      intent: intent.primaryIntent,
      fieldsFilled,
      responseText,
      tokenUsage: totalUsage,
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
    const batchFields = state.fields.filter((f) => batchFieldIds.includes(f.id));
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
    );
    trackUsage(usage);

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

    const { text, usage } = await generateText({
      prompt: `Format these filled insurance application fields as a clean confirmation summary for the user to review. Group by section, show each field as "Label: Value". End with a note asking them to confirm or request changes.\n\nApplication: ${state.title ?? "Insurance Application"}\n\nFields:\n${fieldSummary}`,
      maxTokens: 4096,
      providerOptions,
    });
    trackUsage(usage);

    return { text, tokenUsage: totalUsage };
  }

  return {
    processApplication,
    processReply,
    generateCurrentBatchEmail,
    getConfirmationSummary,
  };
}
