import type { GenerateText, GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn, PdfInput, PerformanceReport, ModelCallReport } from "../core/types";
import type { QualityGateMode } from "../core/quality";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import { resolveModelBudget } from "../core/model-budget";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import type { DocumentSourceNode, PolicyOperationalProfile, SourceChunk, SourceSpan, SourceStore } from "../source";
import { chunkSourceSpans, sourceSpanTextHash } from "../source";
import { pLimit } from "../core/concurrency";
import { safeGenerateObject } from "../core/safe-generate";
import { createPipelineContext, type PipelineCheckpoint } from "../core/pipeline";
import { createPdfPageSlicer, getPdfPageCount, pdfInputToBase64, buildPdfProviderOptions } from "./pdf";
import {
  buildDoclingProviderOptions,
  getDoclingPageRangeText,
  isDoclingExtractionInput,
  mergeSourceSpans,
  normalizeDoclingDocument,
  type DoclingExtractionInput,
  type NormalizedDoclingDocument,
} from "./docling";
import { runExtractor, type PageRangeImage } from "./extractor";
import { assembleDocument } from "./assembler";
import { attachDocumentStructure } from "./document-structure";
import { formatDocumentContent } from "./formatter";
import { chunkDocument } from "./chunking";
import { mergeExtractorResult } from "./merge";
import { getTemplate } from "../prompts/templates/index";
import { buildClassifyPrompt, ClassifyResultSchema, type ClassifyResult } from "../prompts/coordinator/classify";
import { type ExtractionPlan } from "./plan";
import { buildFormInventoryPrompt, FormInventorySchema, type FormInventoryResult } from "../prompts/coordinator/form-inventory";
import { buildPageMapPrompt, PageMapChunkSchema, formatFormInventoryForPageMap, type PageAssignment } from "../prompts/coordinator/page-map";
import { buildReviewPrompt, ReviewResultSchema, type ReviewResult } from "../prompts/coordinator/review";
import { buildSummaryPrompt, SummaryResultSchema, type SummaryResult } from "../prompts/coordinator/summarize";
import { formatExtractorCatalogForPrompt } from "../prompts/extractors/index";
import { buildSupplementaryPrompt, SupplementarySchema } from "../prompts/extractors/supplementary";
import { resolveReferentialCoverages } from "./resolve-referential";
import { runFocusedExtractorWithFallback } from "./focused-dispatch";
import { buildExtractionReviewReport, toReviewRoundRecord, type ExtractionReviewReport, type ReviewRoundRecord } from "./quality";
import { shouldFailQualityGate } from "../core/quality";
import { buildFormInventoryHints, buildPlanFromPageAssignments, buildTemplateHints, normalizePageAssignments } from "./planning";
import {
  getCarrierInfo,
  getCoverageLimitCoverages,
  getCoveredReasons,
  getDefinitions,
  getNamedInsured,
  getSections,
  readMemoryRecord,
  readRecordArray,
} from "./memory";
import { looksCoveredReasonSection } from "./heuristics";
import { groundExtractionMemoryWithSourceSpans } from "./source-grounding";
import { runSourceTreeExtraction } from "./source-tree-extractor";

/** Internal state checkpointed between extraction phases. */
export interface ExtractionState {
  id: string;
  pageCount: number;
  classifyResult?: ClassifyResult;
  formInventory?: FormInventoryResult;
  pageAssignments?: PageAssignment[];
  plan?: ExtractionPlan;
  reviewReport?: ExtractionReviewReport;
  memory: Record<string, unknown>;
  document?: InsuranceDocument;
}

export interface ExtractorConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;
  convertPdfToImages?: ConvertPdfToImagesFn;
  /** Default concurrency for page mapping, extractors, referential lookup, and formatting. */
  concurrency?: number;
  /** Optional override for page-map model calls. Defaults to `concurrency`. */
  pageMapConcurrency?: number;
  /** Optional override for focused extractor model calls. Defaults to `concurrency`. */
  extractorConcurrency?: number;
  /** Optional override for markdown formatting model calls. Defaults to `concurrency`. */
  formatConcurrency?: number;
  maxReviewRounds?: number;
  /** Controls the expensive LLM review pass. `auto` skips it when deterministic checks are clean and source spans are available. */
  reviewMode?: "always" | "auto" | "skip";
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
  sourceStore?: SourceStore;
  qualityGate?: QualityGateMode;
  modelCapabilities?: ModelCapabilities;
  modelCapabilitiesByTaskKind?: Partial<Record<ModelTaskKind, ModelCapabilities>>;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
  /** Optional checkpoint persistence callback. */
  onCheckpointSave?: (checkpoint: PipelineCheckpoint<ExtractionState>) => Promise<void>;
}

export interface ExtractionResult {
  document: InsuranceDocument;
  chunks: DocumentChunk[];
  sourceSpans: SourceSpan[];
  sourceChunks: SourceChunk[];
  sourceTree?: DocumentSourceNode[];
  operationalProfile?: PolicyOperationalProfile;
  warnings?: string[];
  tokenUsage: TokenUsage;
  usageReporting: {
    modelCalls: number;
    callsWithUsage: number;
    callsMissingUsage: number;
  };
  performanceReport: PerformanceReport;
  reviewReport: ExtractionReviewReport;
  /** Last checkpoint — can be passed as `resumeFrom` to retry from a failure point. */
  checkpoint?: PipelineCheckpoint<ExtractionState>;
}

export interface ExtractOptions {
  /** Resume extraction from a previously saved checkpoint. */
  resumeFrom?: PipelineCheckpoint<ExtractionState>;
  /** Optional form inventory/page-range hints to guide v3 source-tree hierarchy when source spans are provided. */
  formInventory?: FormInventoryResult;
  /** Caller-provided raw source spans for this document, reused for evidence grounding and optional persistence. */
  sourceSpans?: SourceSpan[];
}

export type ExtractionInput = PdfInput | DoclingExtractionInput;

export function createExtractor(config: ExtractorConfig) {
  const {
    generateText,
    generateObject,
    convertPdfToImages,
    concurrency = 2,
    pageMapConcurrency,
    extractorConcurrency,
    formatConcurrency,
    maxReviewRounds = 2,
    reviewMode = "auto",
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
    sourceStore,
    qualityGate = "warn",
    modelCapabilities,
    modelCapabilitiesByTaskKind,
    modelBudgetConstraints,
    onCheckpointSave,
  } = config;

  const pageMapLimit = pLimit(pageMapConcurrency ?? concurrency);
  const extractorLimit = pLimit(extractorConcurrency ?? concurrency);
  const extractorCatalog = formatExtractorCatalogForPrompt();
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let modelCalls = 0;
  let callsWithUsage = 0;
  let callsMissingUsage = 0;
  let performanceReport: PerformanceReport = {
    modelCalls: [],
    totalModelCallDurationMs: 0,
  };
  let activeProviderOptions = providerOptions;

  function resolveBudget(taskKind: ModelTaskKind, hintTokens: number) {
    const taskModelCapabilities = modelCapabilitiesByTaskKind?.[taskKind] ?? modelCapabilities;
    return resolveModelBudget({
      taskKind,
      hintTokens,
      modelCapabilities: taskModelCapabilities,
      constraint: modelBudgetConstraints?.[taskKind],
    });
  }

  function trackUsage(usage?: TokenUsage, report?: Omit<ModelCallReport, "usage" | "usageReported">) {
    modelCalls += 1;
    if (usage) {
      callsWithUsage += 1;
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      onTokenUsage?.(usage);
    } else {
      callsMissingUsage += 1;
    }
    if (report) {
      performanceReport.modelCalls.push({
        ...report,
        usage,
        usageReported: !!usage,
      });
      if (report.durationMs != null) {
        performanceReport.totalModelCallDurationMs += report.durationMs;
      }
    }
  }

  function mergeMemoryResult(name: string, data: unknown, memory: Map<string, unknown>) {
    const existing = memory.get(name);
    memory.set(name, mergeExtractorResult(name, existing, data));
  }

  function summarizeExtraction(memory: Map<string, unknown>): string {
    const declarationResult = readMemoryRecord(memory, "declarations");
    const endorsements = readRecordArray(readMemoryRecord(memory, "endorsements"), "endorsements") ?? [];
    const exclusions = readRecordArray(readMemoryRecord(memory, "exclusions"), "exclusions") ?? [];
    const conditions = readRecordArray(readMemoryRecord(memory, "conditions"), "conditions") ?? [];
    const sections = getSections<Record<string, unknown>>(memory) ?? [];
    const definitions = getDefinitions<Record<string, unknown>>(memory) ?? sections.filter((section) => section.type === "definition");
    const coveredReasons = getCoveredReasons<Record<string, unknown>>(memory) ?? sections.filter(looksCoveredReasonSection);
    const coverages = getCoverageLimitCoverages<Record<string, unknown>>(memory);

    const coverageSummary = coverages.slice(0, 12).map((coverage) => ({
      name: coverage.name,
      limit: coverage.limit,
      deductible: coverage.deductible,
      formNumber: coverage.formNumber,
    }));

    return JSON.stringify({
      extractedKeys: [...memory.keys()].filter((key) => key !== "classify"),
      declarationFieldCount: Array.isArray(declarationResult?.fields) ? declarationResult.fields.length : 0,
      coverageCount: coverages.length,
      coverageSamples: coverageSummary,
      endorsementCount: endorsements.length,
      exclusionCount: exclusions.length,
      conditionCount: conditions.length,
      definitionCount: definitions.length,
      coveredReasonCount: coveredReasons.length,
      sectionCount: sections.length,
    }, null, 2);
  }

  function textIncludesSupplementarySignal(value: unknown): boolean {
    if (typeof value !== "string") return false;
    return /\b(supplementary|regulatory|department of insurance|ombudsman|complaint|claim|claims|contact|phone|email|cancellation|cancelled|nonrenewal|non-renewal|non renew|notice|governing law|jurisdiction|third[- ]party administrator|tpa)\b/i.test(value);
  }

  function hasSupplementaryExtractionSignal(
    pageAssignments: PageAssignment[],
    formInventory: FormInventoryResult | undefined,
    memory: Map<string, unknown>,
  ): boolean {
    const hasPageSignal = pageAssignments.some((assignment) =>
      assignment.pageRole === "supplementary"
      || assignment.extractorNames.includes("supplementary")
      || textIncludesSupplementarySignal(assignment.notes)
    );
    if (hasPageSignal) return true;

    const hasFormSignal = (formInventory?.forms ?? []).some((form) =>
      form.formType === "notice"
      || textIncludesSupplementarySignal(form.title)
      || textIncludesSupplementarySignal(form.formNumber)
    );
    if (hasFormSignal) return true;

    const likelySupplementaryKeys = ["sections", "conditions", "endorsements", "exclusions"];
    return likelySupplementaryKeys.some((key) => {
      const value = memory.get(key);
      if (!value) return false;
      return textIncludesSupplementarySignal(JSON.stringify(value));
    });
  }

  function getSupplementaryPageRanges(
    pageAssignments: PageAssignment[],
    formInventory: FormInventoryResult | undefined,
  ): Array<{ startPage: number; endPage: number }> {
    const pages = new Set<number>();

    for (const assignment of pageAssignments) {
      if (
        assignment.pageRole === "supplementary"
        || assignment.extractorNames.includes("supplementary")
        || textIncludesSupplementarySignal(assignment.notes)
      ) {
        pages.add(assignment.localPageNumber);
      }
    }

    for (const form of formInventory?.forms ?? []) {
      if (
        form.formType === "notice"
        || textIncludesSupplementarySignal(form.title)
        || textIncludesSupplementarySignal(form.formNumber)
      ) {
        const startPage = form.pageStart;
        const endPage = form.pageEnd ?? form.pageStart;
        if (typeof startPage !== "number" || typeof endPage !== "number") continue;
        for (let page = startPage; page <= endPage; page += 1) {
          pages.add(page);
        }
      }
    }

    const sortedPages = [...pages].sort((a, b) => a - b);
    if (sortedPages.length === 0) return [];

    const ranges: Array<{ startPage: number; endPage: number }> = [];
    let startPage = sortedPages[0];
    let previousPage = sortedPages[0];
    for (const page of sortedPages.slice(1)) {
      if (page === previousPage + 1) {
        previousPage = page;
        continue;
      }
      ranges.push({ startPage, endPage: previousPage });
      startPage = page;
      previousPage = page;
    }
    ranges.push({ startPage, endPage: previousPage });
    return ranges;
  }

  function pageNumberForSpan(span: SourceSpan): number | undefined {
    return span.pageStart ?? span.location?.startPage ?? span.location?.page;
  }

  function spansForPageRange(spans: SourceSpan[], startPage: number, endPage: number): SourceSpan[] {
    return spans.filter((span) => {
      const start = span.pageStart ?? span.location?.startPage ?? span.location?.page;
      const end = span.pageEnd ?? span.location?.endPage ?? start;
      return typeof start === "number" && typeof end === "number" && start <= endPage && end >= startPage;
    });
  }

  function formatSourceSpanText(spans: SourceSpan[]): string {
    return spans
      .filter((span) => span.text.trim().length > 0)
      .map((span) => {
        const page = pageNumberForSpan(span);
        const label = [
          page ? `Page ${page}` : undefined,
          span.sectionId,
          span.formNumber,
        ].filter(Boolean).join(" | ");
        return label ? `${label}\n${span.text}` : span.text;
      })
      .join("\n\n---\n\n");
  }

  function inferSectionType(title: string, text: string): string {
    const value = `${title} ${text.slice(0, 500)}`.toLowerCase();
    if (/\bdefinition|defined terms?\b/.test(value)) return "definition";
    if (/\bexclusion|not covered|does not apply\b/.test(value)) return "exclusion";
    if (/\bcondition|duties|loss condition|general condition\b/.test(value)) return "condition";
    if (/\bendorsement|amend|additional insured\b/.test(value)) return "endorsement";
    if (/\bcovered cause|covered reason|covered peril|cause of loss|perils insured\b/.test(value)) return "covered_reason";
    if (/\bdeclaration|schedule\b/.test(value)) return "declarations";
    return "policy_form";
  }

  function buildSourceBackedSectionIndex(spans: SourceSpan[], startPage: number, endPage: number) {
    const candidateSpans = spansForPageRange(spans, startPage, endPage)
      .filter((span) => span.text.trim().length > 0)
      .filter((span) => span.metadata?.sourceUnit === "section_candidate" || span.sectionId || span.text.length >= 160);

    return {
      sections: candidateSpans.map((span, index) => {
        const pageStart = span.pageStart ?? span.location?.startPage ?? span.location?.page ?? startPage;
        const pageEnd = span.pageEnd ?? span.location?.endPage ?? pageStart;
        const title = span.sectionId
          ?? span.formNumber
          ?? firstHeadingLine(span.text)
          ?? `Policy text page ${pageStart}`;
        return {
          title,
          sectionNumber: span.formNumber,
          pageStart,
          pageEnd,
          type: inferSectionType(title, span.text),
          excerpt: span.text.slice(0, 240),
          recordId: `section_index_${pageStart}_${index}`,
          sourceSpanIds: [span.id],
          sourceTextHash: span.textHash ?? sourceSpanTextHash(span.text),
        };
      }),
    };
  }

  function firstHeadingLine(text: string): string | undefined {
    const line = text.split(/\r?\n/).map((item) => item.trim()).find((item) => item.length > 0);
    if (!line) return undefined;
    return line.slice(0, 100);
  }

  function shouldRunLlmReview(
    mode: ExtractorConfig["reviewMode"],
    report: ExtractionReviewReport,
    sourceSpansAvailable: boolean,
  ): boolean {
    if (mode === "skip" || maxReviewRounds <= 0) return false;
    if (mode === "always") return true;
    if (!sourceSpansAvailable) return true;
    return report.qualityGateStatus !== "passed" || report.issues.length > 0;
  }

  function buildAlreadyExtractedSummary(memory: Map<string, unknown>): string {
    const lines: string[] = [];

    const declarationResult = readMemoryRecord(memory, "declarations");
    if (Array.isArray(declarationResult?.fields)) {
      for (const field of declarationResult.fields as Array<Record<string, unknown>>) {
        if (field.key && field.value) {
          const subject = field.subject ? ` [${field.subject}]` : "";
          lines.push(`- ${field.key}${subject}: ${field.value}`);
        }
      }
    }

    for (const cov of getCoverageLimitCoverages<Record<string, unknown>>(memory)) {
      const parts = [cov.name, cov.limit && `limit=${cov.limit}`, cov.deductible && `deductible=${cov.deductible}`].filter(Boolean);
      if (parts.length > 0) lines.push(`- coverage: ${parts.join(", ")}`);
    }

    const namedInsured = getNamedInsured(memory);
    if (namedInsured) {
      for (const [key, value] of Object.entries(namedInsured)) {
        if (value && typeof value === "string") lines.push(`- ${key}: ${value}`);
      }
    }

    const carrierInfo = getCarrierInfo(memory);
    if (carrierInfo) {
      for (const [key, value] of Object.entries(carrierInfo)) {
        if (value && typeof value === "string") lines.push(`- ${key}: ${value}`);
      }
    }

    return lines.length > 0 ? lines.join("\n") : "";
  }

  async function runFocusedExtractorTask(
    task: ExtractionPlan["tasks"][number],
    pdfInput: PdfInput | undefined,
    memory: Map<string, unknown>,
    sourceSpansForSections: SourceSpan[],
    pageRangeCache?: Map<string, string>,
    getPageRangePdf?: (startPage: number, endPage: number) => Promise<string>,
    getPageImages?: (startPage: number, endPage: number) => Promise<PageRangeImage[]>,
    getPageRangeText?: (startPage: number, endPage: number) => Promise<string>,
  ) {
    if (task.extractorName === "sections" && sourceSpansForSections.length > 0) {
      return {
        name: "sections",
        data: buildSourceBackedSectionIndex(sourceSpansForSections, task.startPage, task.endPage),
        usage: undefined,
      };
    }

    if (task.extractorName === "supplementary") {
      const alreadyExtractedSummary = buildAlreadyExtractedSummary(memory);
      const budget = resolveBudget("extraction_focused", 4096);
      const startedAt = Date.now();
      const result = await runExtractor({
        name: "supplementary",
        prompt: buildSupplementaryPrompt(alreadyExtractedSummary),
        schema: SupplementarySchema,
        pdfInput,
        startPage: task.startPage,
        endPage: task.endPage,
        generateObject,
        convertPdfToImages,
        maxTokens: budget.maxTokens,
        taskKind: "extraction_focused",
        budgetDiagnostics: budget,
        providerOptions: activeProviderOptions,
        pageRangeCache,
        getPageRangePdf,
        getPageImages,
        getPageRangeText,
      });
      trackUsage(result.usage, {
        taskKind: "extraction_focused",
        label: "supplementary",
        maxTokens: budget.maxTokens,
        durationMs: Date.now() - startedAt,
      });
      return result;
    }

    return runFocusedExtractorWithFallback({
      task,
      pdfInput,
      generateObject,
      convertPdfToImages,
      providerOptions: activeProviderOptions,
      pageRangeCache,
      getPageRangePdf,
      getPageImages,
      getPageRangeText,
      trackUsage,
      resolveBudget,
      log,
    });
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
      .map(([extractorName, pages]) => `${extractorName}: ${pages.length} page(s), pages ${pages.join(", ")}`)
      .join("\n");
  }

  async function extract(
    input: ExtractionInput,
    documentId?: string,
    options?: ExtractOptions,
  ): Promise<ExtractionResult> {
    const id = documentId ?? `doc-${Date.now()}`;
    const isDoclingInput = isDoclingExtractionInput(input);
    const pdfInput = isDoclingInput ? undefined : input;
    const doclingDocument: NormalizedDoclingDocument | undefined = isDoclingInput
      ? normalizeDoclingDocument(input.document, {
          documentId: id,
          sourceKind: input.sourceKind,
        })
      : undefined;
    const memory = new Map<string, unknown>();
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    modelCalls = 0;
    callsWithUsage = 0;
    callsMissingUsage = 0;
    performanceReport = {
      modelCalls: [],
      totalModelCallDurationMs: 0,
    };
    const sourceSpans = mergeSourceSpans([
      ...(doclingDocument?.sourceSpans ?? []),
      ...(options?.sourceSpans ?? []),
    ]);
    const sourceChunks = sourceSpans.length ? chunkSourceSpans(sourceSpans) : [];
    activeProviderOptions = sourceSpans.length
      ? { ...providerOptions, sourceSpans, sourceChunks }
      : providerOptions;

    if (sourceStore && sourceSpans.length > 0) {
      await sourceStore.addSourceSpans(sourceSpans);
      if (sourceChunks.length > 0) {
        await sourceStore.addSourceChunks(sourceChunks);
      }
    }

    if (sourceSpans.length > 0) {
      const pageCount = Math.max(
        1,
        ...sourceSpans.map((span) => span.pageEnd ?? span.pageStart ?? span.location?.endPage ?? span.location?.page ?? 1),
      );
      let formInventory = options?.formInventory;
      if (!formInventory) {
        onProgress?.("Building form inventory from source spans...");
        const budget = resolveBudget("extraction_form_inventory", 2048);
        const startedAt = Date.now();
        const templateHints = buildFormInventoryHints("other", "policy", pageCount, getTemplate("other"));
        const sourceText = formatSourceSpanText(sourceSpans);
        const prompt = `${buildFormInventoryPrompt(templateHints)}\n\nSOURCE SPAN DOCUMENT TEXT:\n${sourceText}`;
        const response = await safeGenerateObject(
          generateObject as GenerateObject<FormInventoryResult>,
          {
            prompt,
            schema: FormInventorySchema,
            maxTokens: budget.maxTokens,
            taskKind: "extraction_form_inventory",
            budgetDiagnostics: budget,
          },
          {
            fallback: { forms: [] },
            maxRetries: 0,
            log,
            retry: false,
            onError: (err, attempt) =>
              log?.(`Form inventory attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        );
        trackUsage(response.usage, {
          taskKind: "extraction_form_inventory",
          label: "form_inventory",
          maxTokens: budget.maxTokens,
          durationMs: Date.now() - startedAt,
        });
        formInventory = response.object;
      }
      onProgress?.("Building source-native document tree...");
      const v3 = await runSourceTreeExtraction({
        id,
        sourceSpans,
        formInventory,
        generateObject,
        providerOptions: activeProviderOptions,
        resolveBudget,
        trackUsage,
        log,
      });
      const sourceTreeFormInventory = v3.formInventory.flatMap((form) => {
        const formNumber = typeof form.formNumber === "string" ? form.formNumber.trim() : "";
        if (!formNumber) return [];
        return [{
          formNumber,
          title: form.title,
          pageStart: form.pageStart,
          pageEnd: form.pageEnd,
          sources: ["source_tree"],
        }];
      });
      const reviewReport: ExtractionReviewReport = {
        issues: v3.warnings.map((warning) => ({
          code: "source_tree_warning",
          severity: "warning" as const,
          message: warning,
        })),
        rounds: [],
        artifacts: [
          { kind: "source_tree", label: "Source Tree", itemCount: v3.sourceTree.length },
          { kind: "source_spans", label: "Source Spans", itemCount: v3.sourceSpans.length },
          { kind: "operational_profile", label: "Operational Profile", itemCount: v3.operationalProfile.coverages.length },
        ],
        reviewRoundRecords: [],
        formInventory: sourceTreeFormInventory,
        qualityGateStatus: v3.warnings.length > 0 ? "warning" : "passed",
      };
      if (shouldFailQualityGate(qualityGate, reviewReport.qualityGateStatus)) {
        throw new Error("Extraction quality gate failed. See reviewReport for blocking issues.");
      }
      onProgress?.("Source-tree extraction complete.");
      return {
        document: v3.document,
        chunks: [],
        sourceSpans: v3.sourceSpans,
        sourceChunks: v3.sourceChunks,
        sourceTree: v3.sourceTree,
        operationalProfile: v3.operationalProfile,
        warnings: v3.warnings,
        tokenUsage: v3.tokenUsage,
        usageReporting: v3.usageReporting,
        performanceReport: v3.performanceReport,
        reviewReport,
      };
    }

    // Set up checkpoint context
    const pipelineCtx = createPipelineContext<ExtractionState>({
      id,
      onSave: onCheckpointSave,
      resumeFrom: options?.resumeFrom,
      phaseOrder: ["classify", "form_inventory", "page_map", "plan", "extract", "resolve_referential", "review", "assemble"],
    });

    // Restore memory from checkpoint if resuming
    const resumed = pipelineCtx.getCheckpoint()?.state;
    if (resumed?.memory) {
      for (const [k, v] of Object.entries(resumed.memory)) {
        memory.set(k, v);
      }
    }

    // Cache for base64 conversion when needed for page extraction
    // FileId references cannot be used for page range extraction, so we
    // need to convert them to base64 once and reuse for extractors
    let pdfBase64Cache: string | undefined;
    const completedPageRangePdfCache = new Map<string, string>();
    const pageRangePdfCache = new Map<string, Promise<string>>();
    const pageRangeImageCache = new Map<string, Promise<PageRangeImage[]>>();
    let pdfSlicerPromise: ReturnType<typeof createPdfPageSlicer> | undefined;
    let fullPdfProviderOptionsPromise: Promise<Record<string, unknown>> | undefined;
    let pageCountPromise: Promise<number> | undefined;

    // Helper to get base64 for page extraction operations
    async function getPdfBase64ForExtraction(): Promise<string> {
      if (!pdfInput) {
        throw new Error("PDF input is not available for Docling extraction.");
      }
      if (pdfBase64Cache === undefined) {
        pdfBase64Cache = await pdfInputToBase64(pdfInput);
      }
      return pdfBase64Cache;
    }

    async function getCachedPageCount(): Promise<number> {
      if (doclingDocument) return doclingDocument.pageCount;
      if (!pdfInput) {
        throw new Error("PDF input is required to read page count.");
      }
      if (!pageCountPromise) {
        pageCountPromise = getPdfSlicer().then((slicer) => slicer.getPageCount()).catch(() => getPdfPageCount(pdfInput));
      }
      return pageCountPromise;
    }

    async function getFullDocumentProviderOptions(): Promise<Record<string, unknown>> {
      if (doclingDocument) {
        return buildDoclingProviderOptions(doclingDocument, activeProviderOptions);
      }
      if (!pdfInput) {
        return activeProviderOptions ?? {};
      }
      if (!fullPdfProviderOptionsPromise) {
        fullPdfProviderOptionsPromise = buildPdfProviderOptions(pdfInput, activeProviderOptions);
      }
      return fullPdfProviderOptionsPromise;
    }

    async function getPdfSlicer() {
      if (!pdfInput) {
        throw new Error("PDF input is not available for Docling extraction.");
      }
      if (!pdfSlicerPromise) {
        pdfSlicerPromise = createPdfPageSlicer(pdfInput);
      }
      return pdfSlicerPromise;
    }

    async function getPageRangePdf(startPage: number, endPage: number): Promise<string> {
      const cacheKey = `${startPage}-${endPage}`;
      const cached = completedPageRangePdfCache.get(cacheKey);
      if (cached) return cached;
      const pending = pageRangePdfCache.get(cacheKey);
      if (pending) return pending;
      const promise = (async () => {
        const slicer = await getPdfSlicer();
        const pagesPdf = await slicer.extractPageRange(startPage, endPage);
        completedPageRangePdfCache.set(cacheKey, pagesPdf);
        return pagesPdf;
      })().catch((error) => {
        pageRangePdfCache.delete(cacheKey);
        throw error;
      });
      pageRangePdfCache.set(cacheKey, promise);
      return promise;
    }

    async function getPageImages(startPage: number, endPage: number): Promise<PageRangeImage[]> {
      if (!convertPdfToImages) return [];
      const cacheKey = `${startPage}-${endPage}`;
      const cached = pageRangeImageCache.get(cacheKey);
      if (cached) return cached;
      const promise = (async () => {
        const pdfBase64 = await getPdfBase64ForExtraction();
        return convertPdfToImages(pdfBase64, startPage, endPage);
      })().catch((error) => {
        pageRangeImageCache.delete(cacheKey);
        throw error;
      });
      pageRangeImageCache.set(cacheKey, promise);
      return promise;
    }

    async function getPageRangeText(startPage: number, endPage: number): Promise<string> {
      if (doclingDocument) return getDoclingPageRangeText(doclingDocument, startPage, endPage);
      return formatSourceSpanText(spansForPageRange(sourceSpans, startPage, endPage));
    }

    function withFullDocumentTextContext(prompt: string): string {
      if (doclingDocument) return `${prompt}\n\nDOCLING DOCUMENT TEXT:\n${doclingDocument.fullText}`;
      const sourceText = formatSourceSpanText(sourceSpans);
      if (!sourceText) return prompt;
      return `${prompt}\n\nSOURCE SPAN DOCUMENT TEXT:\n${sourceText}`;
    }

    function withPageRangeTextContext(prompt: string, startPage: number, endPage: number, pageText: string): string {
      if (!pageText) return prompt;
      const label = doclingDocument ? "DOCLING DOCUMENT" : "SOURCE SPAN DOCUMENT";
      return `${prompt}\n\n${label} PAGES ${startPage}-${endPage}:\n${pageText}`;
    }

    // Step 1: Classify
    let classifyResult: ClassifyResult;
    if (resumed?.classifyResult && pipelineCtx.isPhaseComplete("classify")) {
      classifyResult = resumed.classifyResult;
      onProgress?.("Resuming from checkpoint (classify complete)...");
    } else {
      onProgress?.("Classifying document...");
      const pageCount = await getCachedPageCount();
      const budget = resolveBudget("extraction_classify", 512);
      const startedAt = Date.now();

      const classifyResponse = await safeGenerateObject(
        generateObject as GenerateObject<ClassifyResult>,
        {
          prompt: withFullDocumentTextContext(buildClassifyPrompt()),
          schema: ClassifyResultSchema,
          maxTokens: budget.maxTokens,
          taskKind: "extraction_classify",
          budgetDiagnostics: budget,
          providerOptions: await getFullDocumentProviderOptions(),
        },
        {
          fallback: { documentType: "policy" as const, policyTypes: ["other" as const], confidence: 0 },
          maxRetries: 3,
          log,
          onError: (err, attempt) =>
            log?.(`Classify attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
        },
      );
      trackUsage(classifyResponse.usage, {
        taskKind: "extraction_classify",
        label: "classify",
        maxTokens: budget.maxTokens,
        durationMs: Date.now() - startedAt,
      });
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

    const documentType = classifyResult.documentType;
    const policyTypes = classifyResult.policyTypes ?? [];
    const primaryType = policyTypes[0] ?? "other";
    const template = getTemplate(primaryType);
    const pageCount = resumed?.pageCount ?? await getCachedPageCount();
    const templateHints = buildTemplateHints(primaryType, documentType, pageCount, template);

    // Step 2: Build form inventory with an LLM pass.
    let formInventory: FormInventoryResult | undefined;
    if (resumed?.formInventory && pipelineCtx.isPhaseComplete("form_inventory")) {
      formInventory = resumed.formInventory;
      memory.set("form_inventory", formInventory);
      onProgress?.("Resuming from checkpoint (form inventory complete)...");
    } else {
      onProgress?.(`Building form inventory for ${primaryType} ${documentType}...`);
      const budget = resolveBudget("extraction_form_inventory", 2048);
      const startedAt = Date.now();

      const formInventoryResponse = await safeGenerateObject(
        generateObject as GenerateObject<FormInventoryResult>,
        {
          prompt: withFullDocumentTextContext(buildFormInventoryPrompt(
            buildFormInventoryHints(primaryType, documentType, pageCount, template),
          )),
          schema: FormInventorySchema,
          maxTokens: budget.maxTokens,
          taskKind: "extraction_form_inventory",
          budgetDiagnostics: budget,
          providerOptions: await getFullDocumentProviderOptions(),
        },
        {
          fallback: { forms: [] },
          log,
          onError: (err, attempt) =>
            log?.(`Form inventory attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
        },
      );
      trackUsage(formInventoryResponse.usage, {
        taskKind: "extraction_form_inventory",
        label: "form_inventory",
        maxTokens: budget.maxTokens,
        durationMs: Date.now() - startedAt,
      });
      formInventory = formInventoryResponse.object;
      memory.set("form_inventory", formInventory);

      await pipelineCtx.save("form_inventory", {
        id,
        pageCount,
        classifyResult,
        formInventory,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 3: Map pages to extractors
    let pageAssignments: PageAssignment[];
    if (resumed?.pageAssignments && pipelineCtx.isPhaseComplete("page_map")) {
      pageAssignments = resumed.pageAssignments;
      onProgress?.("Resuming from checkpoint (page map complete)...");
    } else {
      onProgress?.(`Mapping document pages for ${primaryType} ${documentType}...`);
      const chunkSize = 8;
      const collectedAssignments: PageAssignment[] = [];
      const formInventoryHint = formInventory?.forms?.length
        ? formatFormInventoryForPageMap(formInventory.forms)
        : undefined;

      const pageMapChunks = Array.from(
        { length: Math.ceil(pageCount / chunkSize) },
        (_, index) => {
          const startPage = index * chunkSize + 1;
          return { startPage, endPage: Math.min(pageCount, startPage + chunkSize - 1) };
        },
      );

      const pageMapResults = await Promise.all(
        pageMapChunks.map(({ startPage, endPage }) =>
          pageMapLimit(async () => {
            const pagesPdf = doclingDocument ? undefined : await getPageRangePdf(startPage, endPage);
            const pagesText = await getPageRangeText(startPage, endPage);
            const budget = resolveBudget("extraction_page_map", 2048);
            const startedAt = Date.now();
            const mapResponse = await safeGenerateObject(
              generateObject as GenerateObject<{ pages: PageAssignment[] }>,
              {
                prompt: withPageRangeTextContext(
                  buildPageMapPrompt(templateHints, startPage, endPage, formInventoryHint),
                  startPage,
                  endPage,
                  pagesText,
                ),
                schema: PageMapChunkSchema,
                maxTokens: budget.maxTokens,
                taskKind: "extraction_page_map",
                budgetDiagnostics: budget,
                providerOptions: doclingDocument
                  ? { ...activeProviderOptions, doclingText: pagesText, doclingPageRange: { startPage, endPage } }
                  : { ...activeProviderOptions, pdfBase64: pagesPdf },
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
            trackUsage(mapResponse.usage, {
              taskKind: "extraction_page_map",
              label: `page_map:${startPage}-${endPage}`,
              maxTokens: budget.maxTokens,
              durationMs: Date.now() - startedAt,
            });

            return mapResponse.object.pages.map((assignment) => ({
              ...assignment,
              localPageNumber: startPage + assignment.localPageNumber - 1,
            }));
          }),
        ),
      );

      for (const assignments of pageMapResults) {
        collectedAssignments.push(...assignments);
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

      pageAssignments = normalizePageAssignments(pageAssignments, formInventory);

      await pipelineCtx.save("page_map", {
        id,
        pageCount,
        classifyResult,
        formInventory,
        pageAssignments,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 4: Plan
    let plan: ExtractionPlan;
    if (resumed?.plan && pipelineCtx.isPhaseComplete("plan")) {
      plan = resumed.plan;
      onProgress?.("Resuming from checkpoint (plan complete)...");
    } else {
      onProgress?.(`Building extraction plan from page map for ${primaryType} ${documentType}...`);
      plan = buildPlanFromPageAssignments(pageAssignments, pageCount, formInventory);

      await pipelineCtx.save("plan", {
        id,
        pageCount,
        classifyResult,
        formInventory,
        pageAssignments,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 5: Dispatch extractors in parallel
    if (!pipelineCtx.isPhaseComplete("extract")) {
      const supplementaryRanges = getSupplementaryPageRanges(pageAssignments, formInventory);
      const baseTasks = plan.tasks;
      const hasPlannedSupplementary = baseTasks.some((task) => task.extractorName === "supplementary");
      const tasks: ExtractionPlan["tasks"] = hasPlannedSupplementary || supplementaryRanges.length === 0
        ? baseTasks
        : [
            ...baseTasks,
            ...supplementaryRanges.map((range) => ({
              extractorName: "supplementary" as const,
              startPage: range.startPage,
              endPage: range.endPage,
              description: `Page-signaled supplementary extraction for pages ${range.startPage}-${range.endPage}`,
            })),
          ];
      onProgress?.(`Dispatching ${tasks.length} extractors...`);
      const extractionPdfInput = doclingDocument ? undefined : await getPdfBase64ForExtraction();

      const extractorResults = await Promise.all(
        tasks.map((task) =>
          extractorLimit(async () => {
            onProgress?.(`Extracting ${task.extractorName} (pages ${task.startPage}-${task.endPage})...`);
            return runFocusedExtractorTask(
              task,
              extractionPdfInput,
              memory,
              sourceSpans,
              completedPageRangePdfCache,
              getPageRangePdf,
              convertPdfToImages ? getPageImages : undefined,
              sourceSpans.length > 0 || doclingDocument ? getPageRangeText : undefined,
            );
          })
        )
      );

      for (const result of extractorResults.flatMap((item) => Array.isArray(item) ? item : item ? [item] : [])) {
        if (result) {
          mergeMemoryResult(result.name, result.data, memory);
        }
      }

      const planIncludesSupplementary = tasks.some((task) => task.extractorName === "supplementary");
      if (!planIncludesSupplementary && hasSupplementaryExtractionSignal(pageAssignments, formInventory, memory)) {
        onProgress?.("Extracting supplementary retrieval facts...");
        try {
          const alreadyExtractedSummary = buildAlreadyExtractedSummary(memory);
          const budget = resolveBudget("extraction_focused", 4096);
          const startedAt = Date.now();
          const supplementaryResult = await runExtractor({
            name: "supplementary",
            prompt: buildSupplementaryPrompt(alreadyExtractedSummary),
            schema: SupplementarySchema,
            pdfInput,
            startPage: 1,
            endPage: pageCount,
            generateObject,
            convertPdfToImages,
            maxTokens: budget.maxTokens,
            taskKind: "extraction_focused",
            budgetDiagnostics: budget,
            providerOptions: activeProviderOptions,
            pageRangeCache: completedPageRangePdfCache,
            getPageRangePdf,
            getPageImages: convertPdfToImages ? getPageImages : undefined,
            getPageRangeText: sourceSpans.length > 0 || doclingDocument ? getPageRangeText : undefined,
          });
          trackUsage(supplementaryResult.usage, {
            taskKind: "extraction_focused",
            label: "supplementary",
            maxTokens: budget.maxTokens,
            durationMs: Date.now() - startedAt,
          });
          mergeMemoryResult(supplementaryResult.name, supplementaryResult.data, memory);
        } catch (error) {
          await log?.(`Supplementary extractor failed: ${error}`);
        }
      }

      await pipelineCtx.save("extract", {
        id,
        pageCount,
        classifyResult,
        formInventory,
        pageAssignments,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 5b: Resolve referential coverage limits
    if (!pipelineCtx.isPhaseComplete("resolve_referential")) {
      onProgress?.("Resolving referential coverage limits...");
      try {
        const startedAt = Date.now();
        const resolution = await resolveReferentialCoverages({
          memory,
          pdfInput,
          pageCount,
          generateObject,
          convertPdfToImages,
          concurrency,
          getPageRangePdf,
          getPageImages: convertPdfToImages ? getPageImages : undefined,
          getPageRangeText: sourceSpans.length > 0 || doclingDocument ? getPageRangeText : undefined,
          providerOptions: activeProviderOptions,
          modelCapabilities,
          modelBudgetConstraints,
          log,
          onProgress,
        });
        trackUsage(resolution.usage, {
          taskKind: "extraction_referential_lookup",
          label: "referential_resolution",
          durationMs: Date.now() - startedAt,
        });
        if (resolution.attempts > 0) {
          await log?.(`Referential resolution: ${resolution.resolved}/${resolution.attempts} resolved, ${resolution.unresolved} unresolved`);
        }
      } catch (error) {
        await log?.(`Referential resolution failed, continuing: ${error instanceof Error ? error.message : String(error)}`);
      }

      await pipelineCtx.save("resolve_referential", {
        id,
        pageCount,
        classifyResult,
        formInventory,
        pageAssignments,
        plan,
        memory: Object.fromEntries(memory),
      });
    }

    // Step 6: Review loop
    let reviewRounds: ReviewRoundRecord[] = resumed?.reviewReport?.reviewRoundRecords ?? [];
    let reviewReport: ExtractionReviewReport | undefined = resumed?.reviewReport;
    if (!pipelineCtx.isPhaseComplete("review")) {
      reviewRounds = [];
      groundExtractionMemoryWithSourceSpans(memory, sourceSpans);
      const preReviewReport = buildExtractionReviewReport({
        memory,
        pageAssignments,
        reviewRounds,
        sourceSpansAvailable: sourceSpans.length > 0,
        sourceSpans,
      });

      if (shouldRunLlmReview(reviewMode, preReviewReport, sourceSpans.length > 0)) {
        for (let round = 0; round < maxReviewRounds; round++) {
          const extractedKeys = [...memory.keys()].filter((k) => k !== "classify");
          const extractionSummary = summarizeExtraction(memory);
          const pageMapSummary = formatPageMapSummary(pageAssignments);
          const budget = resolveBudget("extraction_review", 1536);
          const startedAt = Date.now();

          const reviewResponse = await safeGenerateObject(
            generateObject as GenerateObject<ReviewResult>,
            {
              prompt: withFullDocumentTextContext(buildReviewPrompt(template.required, extractedKeys, extractionSummary, pageMapSummary, extractorCatalog)),
              schema: ReviewResultSchema,
              maxTokens: budget.maxTokens,
              taskKind: "extraction_review",
              budgetDiagnostics: budget,
              providerOptions: await getFullDocumentProviderOptions(),
            },
            {
              fallback: {
                complete: false,
                missingFields: ["llm_review_unavailable"],
                qualityIssues: [
                  "LLM extraction review failed; deterministic review was used and the result needs review.",
                ],
                additionalTasks: [],
              },
              log,
              onError: (err, attempt) =>
                log?.(`Review round ${round + 1} attempt ${attempt + 1} failed: ${err}`),
            },
          );
          trackUsage(reviewResponse.usage, {
            taskKind: "extraction_review",
            label: `review:${round + 1}`,
            maxTokens: budget.maxTokens,
            durationMs: Date.now() - startedAt,
          });
          reviewRounds.push(toReviewRoundRecord(round + 1, reviewResponse.object));

          if (reviewResponse.object.qualityIssues?.length) {
            await log?.(`Review round ${round + 1} quality issues: ${reviewResponse.object.qualityIssues.join("; ")}`);
          }

          if (reviewResponse.object.complete || reviewResponse.object.additionalTasks.length === 0) {
            onProgress?.("Extraction complete.");
            break;
          }

          onProgress?.(`Review round ${round + 1}: dispatching ${reviewResponse.object.additionalTasks.length} follow-up extractors...`);
          const extractionPdfInput = doclingDocument ? undefined : await getPdfBase64ForExtraction();
          const followUpResults = await Promise.all(
            reviewResponse.object.additionalTasks.map((task) =>
              extractorLimit(async () => {
                return runFocusedExtractorTask(
                  task,
                  extractionPdfInput,
                  memory,
                  sourceSpans,
                  completedPageRangePdfCache,
                  getPageRangePdf,
                  convertPdfToImages ? getPageImages : undefined,
                  sourceSpans.length > 0 || doclingDocument ? getPageRangeText : undefined,
                );
              })
            )
          );

          for (const result of followUpResults.flatMap((item) => Array.isArray(item) ? item : item ? [item] : [])) {
            if (result) {
              mergeMemoryResult(result.name, result.data, memory);
            }
          }
        }
      } else {
        onProgress?.("Skipping LLM extraction review; deterministic checks passed.");
      }

      groundExtractionMemoryWithSourceSpans(memory, sourceSpans);

      reviewReport = buildExtractionReviewReport({
        memory,
        pageAssignments,
        reviewRounds,
        sourceSpansAvailable: sourceSpans.length > 0,
        sourceSpans,
      });

      if (reviewReport.issues.length > 0) {
        await log?.(
          `Deterministic review issues: ${reviewReport.issues.map((issue) => issue.message).join("; ")}`,
        );
      }

      if (shouldFailQualityGate(qualityGate, reviewReport.qualityGateStatus)) {
        throw new Error("Extraction quality gate failed. See reviewReport for blocking issues.");
      }

      await pipelineCtx.save("review", {
        id,
        pageCount,
        classifyResult,
        formInventory,
        pageAssignments,
        plan,
        reviewReport,
        memory: Object.fromEntries(memory),
      });
    }

    groundExtractionMemoryWithSourceSpans(memory, sourceSpans);

    reviewReport ??= buildExtractionReviewReport({
      memory,
      pageAssignments,
      reviewRounds,
      sourceSpansAvailable: sourceSpans.length > 0,
      sourceSpans,
    });

    // Step 7: Assemble
    onProgress?.("Assembling document...");
    const document = assembleDocument(id, documentType, memory);
    attachDocumentStructure({ document, pageAssignments, sourceSpans });

    await pipelineCtx.save("assemble", {
      id,
      pageCount,
      classifyResult,
      formInventory,
      pageAssignments,
      plan,
      reviewReport,
      memory: Object.fromEntries(memory),
      document,
    });

    // Step 8: Generate summary
    if (!document.summary) {
      onProgress?.("Generating document summary...");
      try {
        const budget = resolveBudget("extraction_summary", 512);
        const startedAt = Date.now();
        const summaryResponse = await safeGenerateObject(
          generateObject as GenerateObject<SummaryResult>,
          {
            prompt: buildSummaryPrompt(document),
            schema: SummaryResultSchema,
            maxTokens: budget.maxTokens,
            taskKind: "extraction_summary",
            budgetDiagnostics: budget,
            providerOptions: activeProviderOptions,
          },
          {
            fallback: { summary: "" },
            log,
            onError: (err, attempt) =>
              log?.(`Summary attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        );
        trackUsage(summaryResponse.usage, {
          taskKind: "extraction_summary",
          label: "summary",
          maxTokens: budget.maxTokens,
          durationMs: Date.now() - startedAt,
        });
        if (summaryResponse.object.summary) {
          (document as Record<string, unknown>).summary = summaryResponse.object.summary;
        }
      } catch (error) {
        await log?.(`Summary generation failed, skipping: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Step 9: Format markdown content
    onProgress?.("Formatting extracted content...");
    const formatBudget = resolveBudget("extraction_format", 16384);
    const formatStartedAt = Date.now();
    const formatResult = await formatDocumentContent(document, generateText, {
      providerOptions: activeProviderOptions,
      maxTokens: formatBudget.maxTokens,
      taskKind: "extraction_format",
      budgetDiagnostics: formatBudget,
      concurrency: formatConcurrency ?? concurrency,
      onProgress,
      log,
    });
    trackUsage(formatResult.usage, {
      taskKind: "extraction_format",
      label: "format",
      maxTokens: formatBudget.maxTokens,
      durationMs: Date.now() - formatStartedAt,
    });

    const chunks = chunkDocument(formatResult.document);

    const finalCheckpoint = pipelineCtx.getCheckpoint();

    if (callsMissingUsage > 0) {
      await log?.(`Token usage was unavailable for ${callsMissingUsage}/${modelCalls} model calls. Check that your provider callbacks return usage.`);
      onProgress?.(`Token usage unavailable for ${callsMissingUsage}/${modelCalls} model calls.`);
    }

    return {
      document: formatResult.document,
      chunks,
      sourceSpans,
      sourceChunks,
      tokenUsage: totalUsage,
      usageReporting: {
        modelCalls,
        callsWithUsage,
        callsMissingUsage,
      },
      performanceReport,
      checkpoint: finalCheckpoint,
      reviewReport,
    };
  }

  return { extract };
}
