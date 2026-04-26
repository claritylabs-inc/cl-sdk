import type { GenerateObject, ConvertPdfToImagesFn, PdfInput, TokenUsage, LogFn } from "../core/types";
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
  trackUsage: (usage?: TokenUsage) => void;
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
    trackUsage,
    log,
  } = params;

  const ext = getExtractor(task.extractorName);
  if (!ext) {
    await log?.(`Unknown extractor: ${task.extractorName}, skipping`);
    return null;
  }

  try {
    const result = await runExtractor({
      name: task.extractorName,
      prompt: ext.buildPrompt(),
      schema: ext.schema,
      pdfInput,
      startPage: task.startPage,
      endPage: task.endPage,
      generateObject,
      convertPdfToImages,
      maxTokens: ext.maxTokens ?? 4096,
      providerOptions,
    });
    trackUsage(result.usage);

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
    const fallbackResult = await runExtractor({
      name: ext.fallback.extractorName,
      prompt: fallbackExt.buildPrompt(),
      schema: fallbackExt.schema,
      pdfInput,
      startPage: task.startPage,
      endPage: task.endPage,
      generateObject,
      convertPdfToImages,
      maxTokens: fallbackExt.maxTokens ?? 4096,
      providerOptions,
    });
    trackUsage(fallbackResult.usage);

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
