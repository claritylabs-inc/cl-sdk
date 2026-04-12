import type { GenerateText, GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn } from "../core/types";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import { pLimit } from "../core/concurrency";
import { withRetry } from "../core/retry";
import { safeGenerateObject } from "../core/safe-generate";
import { createPipelineContext, type PipelineCheckpoint, type PipelineContextOptions } from "../core/pipeline";
import { getPdfPageCount } from "./pdf";
import { runExtractor } from "./extractor";
import { assembleDocument } from "./assembler";
import { formatDocumentContent } from "./formatter";
import { chunkDocument } from "./chunking";
import { getTemplate } from "../prompts/templates/index";
import { buildClassifyPrompt, ClassifyResultSchema, type ClassifyResult } from "../prompts/coordinator/classify";
import { buildPlanPrompt, ExtractionPlanSchema, type ExtractionPlan } from "../prompts/coordinator/plan";
import { buildReviewPrompt, ReviewResultSchema, type ReviewResult } from "../prompts/coordinator/review";
import { getExtractor } from "../prompts/extractors/index";

/** Internal state checkpointed between extraction phases. */
export interface ExtractionState {
  id: string;
  pageCount: number;
  classifyResult?: ClassifyResult;
  plan?: ExtractionPlan;
  memory: Record<string, unknown>;
  document?: InsuranceDocument;
}

export interface ExtractorConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;
  convertPdfToImages?: ConvertPdfToImagesFn;
  concurrency?: number;
  maxReviewRounds?: number;
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
  /** Optional checkpoint persistence callback. */
  onCheckpointSave?: (checkpoint: PipelineCheckpoint<ExtractionState>) => Promise<void>;
}

export interface ExtractionResult {
  document: InsuranceDocument;
  chunks: DocumentChunk[];
  tokenUsage: TokenUsage;
  /** Last checkpoint — can be passed as `resumeFrom` to retry from a failure point. */
  checkpoint?: PipelineCheckpoint<ExtractionState>;
}

export interface ExtractOptions {
  /** Resume extraction from a previously saved checkpoint. */
  resumeFrom?: PipelineCheckpoint<ExtractionState>;
}

export function createExtractor(config: ExtractorConfig) {
  const {
    generateText,
    generateObject,
    convertPdfToImages,
    concurrency = 2,
    maxReviewRounds = 2,
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
    onCheckpointSave,
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

  async function extract(
    pdfBase64: string,
    documentId?: string,
    options?: ExtractOptions,
  ): Promise<ExtractionResult> {
    const id = documentId ?? `doc-${Date.now()}`;
    const memory = new Map<string, unknown>();
    totalUsage = { inputTokens: 0, outputTokens: 0 };

    // Set up checkpoint context
    const pipelineCtx = createPipelineContext<ExtractionState>({
      id,
      onSave: onCheckpointSave,
      resumeFrom: options?.resumeFrom,
    });

    // Restore memory from checkpoint if resuming
    const resumed = pipelineCtx.getCheckpoint()?.state;
    if (resumed?.memory) {
      for (const [k, v] of Object.entries(resumed.memory)) {
        memory.set(k, v);
      }
    }

    // Step 1: Classify
    let classifyResult: ClassifyResult;
    if (resumed?.classifyResult && pipelineCtx.isPhaseComplete("classify")) {
      classifyResult = resumed.classifyResult;
      onProgress?.("Resuming from checkpoint (classify complete)...");
    } else {
      onProgress?.("Classifying document...");
      const pageCount = await getPdfPageCount(pdfBase64);

      const classifyResponse = await safeGenerateObject(
        generateObject as GenerateObject<ClassifyResult>,
        {
          prompt: buildClassifyPrompt(),
          schema: ClassifyResultSchema,
          maxTokens: 512,
          providerOptions,
        },
        {
          fallback: { documentType: "policy" as const, policyTypes: ["other" as const], confidence: 0 },
          log,
          onError: (err, attempt) =>
            log?.(`Classify attempt ${attempt + 1} failed: ${err}`),
        },
      );
      trackUsage(classifyResponse.usage);
      classifyResult = classifyResponse.object;
      memory.set("classify", classifyResult);

      await pipelineCtx.save("classify", {
        id,
        pageCount,
        classifyResult,
        memory: Object.fromEntries(memory),
      });
    }

    const { documentType, policyTypes } = classifyResult;
    const primaryType = policyTypes[0] ?? "other";
    const template = getTemplate(primaryType);
    const pageCount = resumed?.pageCount ?? await getPdfPageCount(pdfBase64);

    // Step 2: Plan
    let plan: ExtractionPlan;
    if (resumed?.plan && pipelineCtx.isPhaseComplete("plan")) {
      plan = resumed.plan;
      onProgress?.("Resuming from checkpoint (plan complete)...");
    } else {
      onProgress?.(`Planning extraction for ${primaryType} ${documentType}...`);
      const templateHints = [
        `Document type: ${primaryType} ${documentType}`,
        `Expected sections: ${template.expectedSections.join(", ")}`,
        `Page hints: ${Object.entries(template.pageHints).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
        `Total pages: ${pageCount}`,
      ].join("\n");

      const planResponse = await safeGenerateObject(
        generateObject as GenerateObject<ExtractionPlan>,
        {
          prompt: buildPlanPrompt(templateHints),
          schema: ExtractionPlanSchema,
          maxTokens: 2048,
          providerOptions,
        },
        {
          fallback: {
            tasks: [{ extractorName: "sections", startPage: 1, endPage: pageCount, description: "Full document fallback extraction" }],
          },
          log,
          onError: (err, attempt) =>
            log?.(`Plan attempt ${attempt + 1} failed: ${err}`),
        },
      );
      trackUsage(planResponse.usage);
      plan = planResponse.object;

      await pipelineCtx.save("plan", {
        id,
        pageCount,
        classifyResult,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 3: Dispatch extractors in parallel
    if (!pipelineCtx.isPhaseComplete("extract")) {
      const tasks = plan.tasks;
      onProgress?.(`Dispatching ${tasks.length} extractors...`);

      const extractorResults = await Promise.all(
        tasks.map((task) =>
          limit(async () => {
            const ext = getExtractor(task.extractorName);
            if (!ext) {
              await log?.(`Unknown extractor: ${task.extractorName}, skipping`);
              return null;
            }

            onProgress?.(`Extracting ${task.extractorName} (pages ${task.startPage}-${task.endPage})...`);
            try {
              const result = await runExtractor({
                name: task.extractorName,
                prompt: ext.buildPrompt(),
                schema: ext.schema,
                pdfBase64,
                startPage: task.startPage,
                endPage: task.endPage,
                generateObject,
                convertPdfToImages,
                maxTokens: ext.maxTokens ?? 4096,
                providerOptions,
              });
              trackUsage(result.usage);
              return result;
            } catch (error) {
              await log?.(`Extractor ${task.extractorName} failed: ${error}`);
              return null;
            }
          })
        )
      );

      for (const result of extractorResults) {
        if (result) {
          memory.set(result.name, result.data);
        }
      }

      await pipelineCtx.save("extract", {
        id,
        pageCount,
        classifyResult,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 4: Review loop
    if (!pipelineCtx.isPhaseComplete("review")) {
      for (let round = 0; round < maxReviewRounds; round++) {
        const extractedKeys = [...memory.keys()].filter((k) => k !== "classify");

        const reviewResponse = await safeGenerateObject(
          generateObject as GenerateObject<ReviewResult>,
          {
            prompt: buildReviewPrompt(template.required, extractedKeys),
            schema: ReviewResultSchema,
            maxTokens: 1024,
            providerOptions,
          },
          {
            fallback: { complete: true, missingFields: [], additionalTasks: [] },
            log,
            onError: (err, attempt) =>
              log?.(`Review round ${round + 1} attempt ${attempt + 1} failed: ${err}`),
          },
        );
        trackUsage(reviewResponse.usage);

        if (reviewResponse.object.complete || reviewResponse.object.additionalTasks.length === 0) {
          onProgress?.("Extraction complete.");
          break;
        }

        onProgress?.(`Review round ${round + 1}: dispatching ${reviewResponse.object.additionalTasks.length} follow-up extractors...`);
        const followUpResults = await Promise.all(
          reviewResponse.object.additionalTasks.map((task) =>
            limit(async () => {
              const ext = getExtractor(task.extractorName);
              if (!ext) return null;

              try {
                const result = await runExtractor({
                  name: task.extractorName,
                  prompt: ext.buildPrompt(),
                  schema: ext.schema,
                  pdfBase64,
                  startPage: task.startPage,
                  endPage: task.endPage,
                  generateObject,
                  convertPdfToImages,
                  maxTokens: ext.maxTokens ?? 4096,
                  providerOptions,
                });
                trackUsage(result.usage);
                return result;
              } catch (error) {
                await log?.(`Follow-up extractor ${task.extractorName} failed: ${error}`);
                return null;
              }
            })
          )
        );

        for (const result of followUpResults) {
          if (result) {
            memory.set(result.name, result.data);
          }
        }
      }

      await pipelineCtx.save("review", {
        id,
        pageCount,
        classifyResult,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 5: Assemble
    onProgress?.("Assembling document...");
    const document = assembleDocument(id, documentType, memory);

    await pipelineCtx.save("assemble", {
      id,
      pageCount,
      classifyResult,
      plan,
      memory: Object.fromEntries(memory),
      document,
    });

    // Step 6: Format markdown content
    onProgress?.("Formatting extracted content...");
    const formatResult = await formatDocumentContent(document, generateText, {
      providerOptions,
      onProgress,
      log,
    });
    trackUsage(formatResult.usage);

    const chunks = chunkDocument(formatResult.document);

    const finalCheckpoint = pipelineCtx.getCheckpoint();

    return {
      document: formatResult.document,
      chunks,
      tokenUsage: totalUsage,
      checkpoint: finalCheckpoint,
    };
  }

  return { extract };
}
