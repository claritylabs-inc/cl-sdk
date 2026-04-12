import type { GenerateText, GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn } from "../core/types";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import { pLimit } from "../core/concurrency";
import { safeGenerateObject } from "../core/safe-generate";
import { createPipelineContext, type PipelineCheckpoint } from "../core/pipeline";
import { extractPageRange, getPdfPageCount } from "./pdf";
import { runExtractor } from "./extractor";
import { assembleDocument } from "./assembler";
import { formatDocumentContent } from "./formatter";
import { chunkDocument } from "./chunking";
import { mergeExtractorResult } from "./merge";
import { getTemplate } from "../prompts/templates/index";
import { buildClassifyPrompt, ClassifyResultSchema, type ClassifyResult } from "../prompts/coordinator/classify";
import { type ExtractionPlan } from "../prompts/coordinator/plan";
import { buildPageMapPrompt, PageMapChunkSchema, type PageAssignment } from "../prompts/coordinator/page-map";
import { buildReviewPrompt, ReviewResultSchema, type ReviewResult } from "../prompts/coordinator/review";
import { getExtractor } from "../prompts/extractors/index";

/** Internal state checkpointed between extraction phases. */
export interface ExtractionState {
  id: string;
  pageCount: number;
  classifyResult?: ClassifyResult;
  pageAssignments?: PageAssignment[];
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
  usageReporting: {
    modelCalls: number;
    callsWithUsage: number;
    callsMissingUsage: number;
  };
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
  let modelCalls = 0;
  let callsWithUsage = 0;
  let callsMissingUsage = 0;

  function trackUsage(usage?: TokenUsage) {
    modelCalls += 1;
    if (usage) {
      callsWithUsage += 1;
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      onTokenUsage?.(usage);
    } else {
      callsMissingUsage += 1;
    }
  }

  function mergeMemoryResult(name: string, data: unknown, memory: Map<string, unknown>) {
    const existing = memory.get(name);
    memory.set(name, mergeExtractorResult(name, existing, data));
  }

  function summarizeExtraction(memory: Map<string, unknown>): string {
    const coverageResult = memory.get("coverage_limits") as Record<string, unknown> | undefined;
    const declarationResult = memory.get("declarations") as Record<string, unknown> | undefined;
    const endorsementResult = memory.get("endorsements") as Record<string, unknown> | undefined;
    const exclusionResult = memory.get("exclusions") as Record<string, unknown> | undefined;
    const conditionResult = memory.get("conditions") as Record<string, unknown> | undefined;
    const sectionResult = memory.get("sections") as Record<string, unknown> | undefined;

    const coverageSummary = Array.isArray(coverageResult?.coverages)
      ? coverageResult.coverages.slice(0, 12).map((coverage) => ({
          name: (coverage as Record<string, unknown>).name,
          limit: (coverage as Record<string, unknown>).limit,
          deductible: (coverage as Record<string, unknown>).deductible,
          formNumber: (coverage as Record<string, unknown>).formNumber,
        }))
      : [];

    return JSON.stringify({
      extractedKeys: [...memory.keys()].filter((key) => key !== "classify"),
      declarationFieldCount: Array.isArray(declarationResult?.fields) ? declarationResult.fields.length : 0,
      coverageCount: Array.isArray(coverageResult?.coverages) ? coverageResult.coverages.length : 0,
      coverageSamples: coverageSummary,
      endorsementCount: Array.isArray(endorsementResult?.endorsements) ? endorsementResult.endorsements.length : 0,
      exclusionCount: Array.isArray(exclusionResult?.exclusions) ? exclusionResult.exclusions.length : 0,
      conditionCount: Array.isArray(conditionResult?.conditions) ? conditionResult.conditions.length : 0,
      sectionCount: Array.isArray(sectionResult?.sections) ? sectionResult.sections.length : 0,
    }, null, 2);
  }

  function formatPageMapSummary(pageAssignments: PageAssignment[]): string {
    const extractorPages = new Map<string, number[]>();

    for (const assignment of pageAssignments) {
      for (const extractorName of assignment.extractorNames) {
        extractorPages.set(extractorName, [...(extractorPages.get(extractorName) ?? []), assignment.localPageNumber]);
      }
    }

    if (extractorPages.size === 0) return "No page assignments available.";

    return [...extractorPages.entries()]
      .map(([extractorName, pages]) => `${extractorName}: pages ${pages.join(", ")}`)
      .join("\n");
  }

  function buildTemplateHints(
    primaryType: string,
    documentType: "policy" | "quote",
    pageCount: number,
    template: ReturnType<typeof getTemplate>,
  ): string {
    return [
      `Document type: ${primaryType} ${documentType}`,
      `Expected sections: ${template.expectedSections.join(", ")}`,
      `Page hints: ${Object.entries(template.pageHints).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
      `Total pages: ${pageCount}`,
    ].join("\n");
  }

  function groupContiguousPages(pages: number[]): Array<{ startPage: number; endPage: number }> {
    if (pages.length === 0) return [];
    const sorted = [...new Set(pages)].sort((a, b) => a - b);
    const ranges: Array<{ startPage: number; endPage: number }> = [];
    let start = sorted[0];
    let previous = sorted[0];

    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i];
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      ranges.push({ startPage: start, endPage: previous });
      start = current;
      previous = current;
    }

    ranges.push({ startPage: start, endPage: previous });
    return ranges;
  }

  function buildPlanFromPageAssignments(
    pageAssignments: PageAssignment[],
    pageCount: number,
  ): ExtractionPlan {
    const extractorPages = new Map<string, number[]>();

    for (const assignment of pageAssignments) {
      const extractors = assignment.extractorNames.length > 0 ? assignment.extractorNames : ["sections"];
      for (const extractorName of extractors) {
        extractorPages.set(extractorName, [...(extractorPages.get(extractorName) ?? []), assignment.localPageNumber]);
      }
    }

    const coveredPages = new Set<number>();
    for (const pages of extractorPages.values()) {
      for (const page of pages) coveredPages.add(page);
    }
    for (let page = 1; page <= pageCount; page += 1) {
      if (!coveredPages.has(page)) {
        extractorPages.set("sections", [...(extractorPages.get("sections") ?? []), page]);
      }
    }

    const tasks = [...extractorPages.entries()]
      .flatMap(([extractorName, pages]) =>
        groupContiguousPages(pages).map(({ startPage, endPage }) => ({
          extractorName,
          startPage,
          endPage,
          description: `Page-mapped ${extractorName} extraction for pages ${startPage}-${endPage}`,
        }))
      )
      .sort((a, b) => a.startPage - b.startPage || a.extractorName.localeCompare(b.extractorName));

    return {
      tasks,
      pageMap: [...extractorPages.entries()].map(([section, pages]) => ({
        section,
        pages: `pages ${[...new Set(pages)].sort((a, b) => a - b).join(", ")}`,
      })),
    };
  }

  async function extract(
    pdfBase64: string,
    documentId?: string,
    options?: ExtractOptions,
  ): Promise<ExtractionResult> {
    const id = documentId ?? `doc-${Date.now()}`;
    const memory = new Map<string, unknown>();
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    modelCalls = 0;
    callsWithUsage = 0;
    callsMissingUsage = 0;

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
          providerOptions: { ...providerOptions, pdfBase64 },
        },
        {
          fallback: { documentType: "policy" as const, policyTypes: ["other" as const], confidence: 0 },
          maxRetries: 3,
          log,
          onError: (err, attempt) =>
            log?.(`Classify attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
        },
      );
      trackUsage(classifyResponse.usage);
      classifyResult = classifyResponse.object;

      if (classifyResult.confidence === 0) {
        await log?.(`WARNING: classify returned fallback (policyTypes: ["other"]). This usually means the generateObject callback failed — check that the document content is accessible to the model.`);
      }

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
    const templateHints = buildTemplateHints(primaryType, documentType, pageCount, template);

    // Step 2: Map pages to extractors
    let pageAssignments: PageAssignment[];
    if (resumed?.pageAssignments && pipelineCtx.isPhaseComplete("page_map")) {
      pageAssignments = resumed.pageAssignments;
      onProgress?.("Resuming from checkpoint (page map complete)...");
    } else {
      onProgress?.(`Mapping document pages for ${primaryType} ${documentType}...`);
      const chunkSize = 8;
      const collectedAssignments: PageAssignment[] = [];

      for (let startPage = 1; startPage <= pageCount; startPage += chunkSize) {
        const endPage = Math.min(pageCount, startPage + chunkSize - 1);
        const pagesPdf = await extractPageRange(pdfBase64, startPage, endPage);
        const mapResponse = await safeGenerateObject(
          generateObject as GenerateObject<{ pages: PageAssignment[] }>,
          {
            prompt: buildPageMapPrompt(templateHints, startPage, endPage),
            schema: PageMapChunkSchema,
            maxTokens: 2048,
            providerOptions: { ...providerOptions, pdfBase64: pagesPdf },
          },
          {
            fallback: {
              pages: Array.from({ length: endPage - startPage + 1 }, (_, index): PageAssignment => ({
                localPageNumber: index + 1,
                extractorNames: index === 0 && startPage === 1
                  ? ["carrier_info", "named_insured", "declarations", "coverage_limits"]
                  : ["sections"],
                confidence: 0,
                notes: "Fallback page assignment",
              })),
            },
            log,
            onError: (err, attempt) =>
              log?.(`Page map attempt ${attempt + 1} failed for pages ${startPage}-${endPage}: ${err}`),
          },
        );
        trackUsage(mapResponse.usage);

        for (const assignment of mapResponse.object.pages) {
          collectedAssignments.push({
            ...assignment,
            localPageNumber: startPage + assignment.localPageNumber - 1,
          });
        }
      }

      pageAssignments = collectedAssignments.length > 0
        ? collectedAssignments
        : Array.from({ length: pageCount }, (_, index): PageAssignment => ({
            localPageNumber: index + 1,
            extractorNames: index === 0
              ? ["carrier_info", "named_insured", "declarations", "coverage_limits"]
              : ["sections"],
            confidence: 0,
            notes: "Full-document fallback page assignment",
          }));

      await pipelineCtx.save("page_map", {
        id,
        pageCount,
        classifyResult,
        pageAssignments,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 3: Plan
    let plan: ExtractionPlan;
    if (resumed?.plan && pipelineCtx.isPhaseComplete("plan")) {
      plan = resumed.plan;
      onProgress?.("Resuming from checkpoint (plan complete)...");
    } else {
      onProgress?.(`Building extraction plan from page map for ${primaryType} ${documentType}...`);
      plan = buildPlanFromPageAssignments(pageAssignments, pageCount);

      await pipelineCtx.save("plan", {
        id,
        pageCount,
        classifyResult,
        pageAssignments,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 4: Dispatch extractors in parallel
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
          mergeMemoryResult(result.name, result.data, memory);
        }
      }

      await pipelineCtx.save("extract", {
        id,
        pageCount,
        classifyResult,
        pageAssignments,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 5: Review loop
    if (!pipelineCtx.isPhaseComplete("review")) {
      for (let round = 0; round < maxReviewRounds; round++) {
        const extractedKeys = [...memory.keys()].filter((k) => k !== "classify");
        const extractionSummary = summarizeExtraction(memory);
        const pageMapSummary = formatPageMapSummary(pageAssignments);

        const reviewResponse = await safeGenerateObject(
          generateObject as GenerateObject<ReviewResult>,
          {
            prompt: buildReviewPrompt(template.required, extractedKeys, extractionSummary, pageMapSummary),
            schema: ReviewResultSchema,
            maxTokens: 1536,
            providerOptions: { ...providerOptions, pdfBase64 },
          },
          {
            fallback: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
            log,
            onError: (err, attempt) =>
              log?.(`Review round ${round + 1} attempt ${attempt + 1} failed: ${err}`),
          },
        );
        trackUsage(reviewResponse.usage);

        if (reviewResponse.object.qualityIssues?.length) {
          await log?.(`Review round ${round + 1} quality issues: ${reviewResponse.object.qualityIssues.join("; ")}`);
        }

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
            mergeMemoryResult(result.name, result.data, memory);
          }
        }
      }

      await pipelineCtx.save("review", {
        id,
        pageCount,
        classifyResult,
        pageAssignments,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 6: Assemble
    onProgress?.("Assembling document...");
    const document = assembleDocument(id, documentType, memory);

    await pipelineCtx.save("assemble", {
      id,
      pageCount,
      classifyResult,
      pageAssignments,
      plan,
      memory: Object.fromEntries(memory),
      document,
    });

    // Step 7: Format markdown content
    onProgress?.("Formatting extracted content...");
    const formatResult = await formatDocumentContent(document, generateText, {
      providerOptions,
      onProgress,
      log,
    });
    trackUsage(formatResult.usage);

    const chunks = chunkDocument(formatResult.document);

    const finalCheckpoint = pipelineCtx.getCheckpoint();

    if (callsMissingUsage > 0) {
      await log?.(`Token usage was unavailable for ${callsMissingUsage}/${modelCalls} model calls. Check that your provider callbacks return usage.`);
      onProgress?.(`Token usage unavailable for ${callsMissingUsage}/${modelCalls} model calls.`);
    }

    return {
      document: formatResult.document,
      chunks,
      tokenUsage: totalUsage,
      usageReporting: {
        modelCalls,
        callsWithUsage,
        callsMissingUsage,
      },
      checkpoint: finalCheckpoint,
    };
  }

  return { extract };
}
