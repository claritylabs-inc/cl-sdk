import type { GenerateObject, ConvertPdfToImagesFn, PdfInput, TokenUsage, LogFn } from "../core/types";
import type { ModelBudgetResolution, ModelTaskKind } from "../core/model-budget";
import { getExtractor } from "../prompts/extractors/index";
import { runExtractor, type ExtractorResult } from "./extractor";

export interface FocusedExtractorTask {
  extractorName: string;
  startPage: number;
  endPage: number;
}

export interface FocusedExtractorDispatchParams {
  task: FocusedExtractorTask;
  pdfInput: PdfInput;
  generateObject: GenerateObject;
  convertPdfToImages?: ConvertPdfToImagesFn;
  providerOptions?: Record<string, unknown>;
  pageRangeCache?: Map<string, string>;
  trackUsage: (usage?: TokenUsage, report?: { taskKind: ModelTaskKind; label?: string; maxTokens?: number }) => void;
  resolveBudget: (taskKind: ModelTaskKind, hintTokens: number) => ModelBudgetResolution;
  log?: LogFn;
}

export type FocusedExtractorDispatchResult =
  | ExtractorResult<unknown>
  | Array<ExtractorResult<unknown>>;

export async function runFocusedExtractorWithFallback(
  params: FocusedExtractorDispatchParams,
): Promise<FocusedExtractorDispatchResult | null> {
  const {
    task,
    pdfInput,
    generateObject,
    convertPdfToImages,
    providerOptions,
    pageRangeCache,
    trackUsage,
    resolveBudget,
    log,
  } = params;

  const ext = getExtractor(task.extractorName);
  if (!ext) {
    await log?.(`Unknown extractor: ${task.extractorName}, skipping`);
    return null;
  }

  try {
    const hintTokens = ext.maxTokens ?? 4096;
    const taskKind = hintTokens >= 8192 ? "extraction_long_list" : "extraction_focused";
    const budget = resolveBudget(taskKind, hintTokens);
    const result = await runExtractor({
      name: task.extractorName,
      prompt: ext.buildPrompt(),
      schema: ext.schema,
      pdfInput,
      startPage: task.startPage,
      endPage: task.endPage,
      generateObject,
      convertPdfToImages,
      maxTokens: budget.maxTokens,
      providerOptions,
      pageRangeCache,
    });
    trackUsage(result.usage, {
      taskKind,
      label: task.extractorName,
      maxTokens: budget.maxTokens,
    });

    if (!ext.fallback?.isEmpty(result.data)) {
      return result;
    }

    if (!ext.fallback) {
      return result;
    }
  } catch (error) {
    await log?.(`Extractor ${task.extractorName} failed: ${error}`);
    if (!ext.fallback) {
      return null;
    }
  }

  const fallbackExt = getExtractor(ext.fallback.extractorName);
  if (!fallbackExt) return null;

  await log?.(
    `Extractor ${task.extractorName} produced no usable records; trying ${ext.fallback.extractorName} fallback for pages ${task.startPage}-${task.endPage}`,
  );

  try {
    const hintTokens = fallbackExt.maxTokens ?? 4096;
    const taskKind = hintTokens >= 8192 ? "extraction_long_list" : "extraction_focused";
    const budget = resolveBudget(taskKind, hintTokens);
    const fallbackResult = await runExtractor({
      name: ext.fallback.extractorName,
      prompt: fallbackExt.buildPrompt(),
      schema: fallbackExt.schema,
      pdfInput,
      startPage: task.startPage,
      endPage: task.endPage,
      generateObject,
      convertPdfToImages,
      maxTokens: budget.maxTokens,
      providerOptions,
      pageRangeCache,
    });
    trackUsage(fallbackResult.usage, {
      taskKind,
      label: ext.fallback.extractorName,
      maxTokens: budget.maxTokens,
    });

    const focusedData = ext.fallback.deriveFocusedResult(fallbackResult.data);
    return focusedData
      ? [
          fallbackResult,
          { name: task.extractorName, data: focusedData, usage: undefined },
        ]
      : fallbackResult;
  } catch (fallbackError) {
    await log?.(`${ext.fallback.extractorName} fallback for ${task.extractorName} failed: ${fallbackError}`);
    return null;
  }
}
