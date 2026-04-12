import type { GenerateText, GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn } from "../core/types";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import { pLimit } from "../core/concurrency";
import { withRetry } from "../core/retry";
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
}

export interface ExtractionResult {
  document: InsuranceDocument;
  chunks: DocumentChunk[];
  tokenUsage: TokenUsage;
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

  async function extract(pdfBase64: string, documentId?: string): Promise<ExtractionResult> {
    const id = documentId ?? `doc-${Date.now()}`;
    const memory = new Map<string, unknown>();
    totalUsage = { inputTokens: 0, outputTokens: 0 };

    // Step 1: Classify
    onProgress?.("Classifying document...");
    const pageCount = await getPdfPageCount(pdfBase64);

    const classifyResult = await withRetry(() =>
      generateObject({
        prompt: buildClassifyPrompt(),
        schema: ClassifyResultSchema,
        maxTokens: 512,
        providerOptions,
      })
    ) as { object: ClassifyResult; usage?: TokenUsage };
    trackUsage(classifyResult.usage);
    memory.set("classify", classifyResult.object);

    const { documentType, policyTypes } = classifyResult.object;
    const primaryType = policyTypes[0] ?? "other";
    const template = getTemplate(primaryType);

    // Step 2: Plan
    onProgress?.(`Planning extraction for ${primaryType} ${documentType}...`);
    const templateHints = [
      `Document type: ${primaryType} ${documentType}`,
      `Expected sections: ${template.expectedSections.join(", ")}`,
      `Page hints: ${Object.entries(template.pageHints).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
      `Total pages: ${pageCount}`,
    ].join("\n");

    const planResult = await withRetry(() =>
      generateObject({
        prompt: buildPlanPrompt(templateHints),
        schema: ExtractionPlanSchema,
        maxTokens: 2048,
        providerOptions,
      })
    ) as { object: ExtractionPlan; usage?: TokenUsage };
    trackUsage(planResult.usage);

    // Step 3: Dispatch extractors in parallel
    const tasks = planResult.object.tasks;
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

    // Step 4: Review loop
    for (let round = 0; round < maxReviewRounds; round++) {
      const extractedKeys = [...memory.keys()].filter((k) => k !== "classify");
      const reviewResult = await withRetry(() =>
        generateObject({
          prompt: buildReviewPrompt(template.required, extractedKeys),
          schema: ReviewResultSchema,
          maxTokens: 1024,
          providerOptions,
        })
      ) as { object: ReviewResult; usage?: TokenUsage };
      trackUsage(reviewResult.usage);

      if (reviewResult.object.complete || reviewResult.object.additionalTasks.length === 0) {
        onProgress?.("Extraction complete.");
        break;
      }

      onProgress?.(`Review round ${round + 1}: dispatching ${reviewResult.object.additionalTasks.length} follow-up extractors...`);
      const followUpResults = await Promise.all(
        reviewResult.object.additionalTasks.map((task) =>
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

    // Step 5: Assemble
    onProgress?.("Assembling document...");
    const document = assembleDocument(id, documentType, memory);

    // Step 6: Format markdown content
    onProgress?.("Formatting extracted content...");
    const formatResult = await formatDocumentContent(document, generateText, {
      providerOptions,
      onProgress,
    });
    trackUsage(formatResult.usage);

    const chunks = chunkDocument(formatResult.document);

    return { document: formatResult.document, chunks, tokenUsage: totalUsage };
  }

  return { extract };
}
