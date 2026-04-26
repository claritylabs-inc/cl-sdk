import type { GenerateText, GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn, PdfInput } from "../core/types";
import type { QualityGateMode } from "../core/quality";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import { pLimit } from "../core/concurrency";
import { safeGenerateObject } from "../core/safe-generate";
import { createPipelineContext, type PipelineCheckpoint } from "../core/pipeline";
import { extractPageRange, getPdfPageCount, pdfInputToBase64, buildPdfProviderOptions } from "./pdf";
import { runExtractor } from "./extractor";
import { assembleDocument } from "./assembler";
import { formatDocumentContent } from "./formatter";
import { chunkDocument } from "./chunking";
import { mergeExtractorResult } from "./merge";
import { getTemplate } from "../prompts/templates/index";
import { buildClassifyPrompt, ClassifyResultSchema, type ClassifyResult } from "../prompts/coordinator/classify";
import { type ExtractionPlan } from "../prompts/coordinator/plan";
import { buildFormInventoryPrompt, FormInventorySchema, type FormInventoryResult } from "../prompts/coordinator/form-inventory";
import { buildPageMapPrompt, PageMapChunkSchema, formatFormInventoryForPageMap, type PageAssignment } from "../prompts/coordinator/page-map";
import { buildReviewPrompt, ReviewResultSchema, type ReviewResult } from "../prompts/coordinator/review";
import { buildSummaryPrompt, SummaryResultSchema, type SummaryResult } from "../prompts/coordinator/summarize";
import { getExtractor } from "../prompts/extractors/index";
import { buildSupplementaryPrompt, SupplementarySchema } from "../prompts/extractors/supplementary";
import { resolveReferentialCoverages } from "./resolve-referential";
import { buildExtractionReviewReport, toReviewRoundRecord, type ExtractionReviewReport, type ReviewRoundRecord } from "./quality";
import { shouldFailQualityGate } from "../core/quality";
import type { FormInventoryEntry } from "../prompts/coordinator/form-inventory";

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
  concurrency?: number;
  maxReviewRounds?: number;
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
  qualityGate?: QualityGateMode;
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
  reviewReport: ExtractionReviewReport;
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
    qualityGate = "warn",
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
    const definitionsResult = memory.get("definitions") as Record<string, unknown> | undefined;
    const coveredReasonsResult = memory.get("covered_reasons") as Record<string, unknown> | undefined;
    const sections = Array.isArray(sectionResult?.sections) ? sectionResult.sections as Array<Record<string, unknown>> : [];
    const definitionCount = Array.isArray(definitionsResult?.definitions)
      ? definitionsResult.definitions.length
      : sections.filter((section) => section.type === "definition").length;
    const coveredReasonCount = Array.isArray(coveredReasonsResult?.coveredReasons)
      ? coveredReasonsResult.coveredReasons.length
      : Array.isArray(coveredReasonsResult?.covered_reasons)
        ? coveredReasonsResult.covered_reasons.length
        : sections.filter((section) => {
            const title = String(section.title ?? "").toLowerCase();
            const type = String(section.type ?? "").toLowerCase();
            return type === "covered_reason" || title.includes("covered cause") || title.includes("covered reason") || title.includes("covered peril");
          }).length;

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
      definitionCount,
      coveredReasonCount,
      sectionCount: sections.length,
    }, null, 2);
  }

  function buildAlreadyExtractedSummary(memory: Map<string, unknown>): string {
    const lines: string[] = [];

    const declarationResult = memory.get("declarations") as Record<string, unknown> | undefined;
    if (Array.isArray(declarationResult?.fields)) {
      for (const field of declarationResult.fields as Array<Record<string, unknown>>) {
        if (field.key && field.value) {
          const subject = field.subject ? ` [${field.subject}]` : "";
          lines.push(`- ${field.key}${subject}: ${field.value}`);
        }
      }
    }

    const coverageResult = memory.get("coverage_limits") as Record<string, unknown> | undefined;
    if (Array.isArray(coverageResult?.coverages)) {
      for (const cov of coverageResult.coverages as Array<Record<string, unknown>>) {
        const parts = [cov.name, cov.limit && `limit=${cov.limit}`, cov.deductible && `deductible=${cov.deductible}`].filter(Boolean);
        if (parts.length > 0) lines.push(`- coverage: ${parts.join(", ")}`);
      }
    }

    const namedInsured = memory.get("named_insured") as Record<string, unknown> | undefined;
    if (namedInsured) {
      for (const [key, value] of Object.entries(namedInsured)) {
        if (value && typeof value === "string") lines.push(`- ${key}: ${value}`);
      }
    }

    const carrierInfo = memory.get("carrier_info") as Record<string, unknown> | undefined;
    if (carrierInfo) {
      for (const [key, value] of Object.entries(carrierInfo)) {
        if (value && typeof value === "string") lines.push(`- ${key}: ${value}`);
      }
    }

    return lines.length > 0 ? lines.join("\n") : "";
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

  function normalizePageAssignments(
    pageAssignments: PageAssignment[],
    formInventory?: FormInventoryResult,
  ): PageAssignment[] {
    // Build a lookup: page number → form types from inventory
    const pageFormTypes = new Map<number, Set<string>>();
    if (formInventory) {
      for (const form of formInventory.forms) {
        if (form.pageStart != null) {
          const end = form.pageEnd ?? form.pageStart;
          for (let p = form.pageStart; p <= end; p++) {
            const types = pageFormTypes.get(p) ?? new Set();
            types.add(form.formType);
            pageFormTypes.set(p, types);
          }
        }
      }
    }

    return pageAssignments.map((assignment) => {
      let extractorNames: PageAssignment["extractorNames"] = [...new Set(
        (assignment.extractorNames.length > 0 ? assignment.extractorNames : ["sections"]).filter(Boolean),
      )] as PageAssignment["extractorNames"];

      const hasDeclarations = extractorNames.includes("declarations");
      const hasConditions = extractorNames.includes("conditions");
      const hasExclusions = extractorNames.includes("exclusions");
      const hasEndorsements = extractorNames.includes("endorsements");
      const looksLikeScheduleValues = assignment.hasScheduleValues === true;
      const roleBlocksCoverageLimits = assignment.pageRole === "policy_form"
        || assignment.pageRole === "condition_exclusion_form"
        || assignment.pageRole === "endorsement_form";

      // Use form inventory to further constrain: if the inventory says this page
      // belongs to an endorsement/notice/application form, block coverage_limits
      // unless the page has explicit schedule values.
      const inventoryTypes = pageFormTypes.get(assignment.localPageNumber);
      const inventoryBlocksCoverageLimits = inventoryTypes != null
        && !looksLikeScheduleValues
        && !hasDeclarations
        && (inventoryTypes.has("endorsement") || inventoryTypes.has("notice") || inventoryTypes.has("application"));

      if (extractorNames.includes("coverage_limits")) {
        const shouldDropCoverageLimits = inventoryBlocksCoverageLimits
          || (!looksLikeScheduleValues && roleBlocksCoverageLimits)
          || (!hasDeclarations && !looksLikeScheduleValues && (hasConditions || hasExclusions))
          || (!hasDeclarations && !looksLikeScheduleValues && hasEndorsements);

        if (shouldDropCoverageLimits) {
          extractorNames = extractorNames.filter((name) => name !== "coverage_limits") as PageAssignment["extractorNames"];
        }
      }

      // If inventory says this page is an endorsement form, ensure endorsements extractor is assigned
      if (inventoryTypes?.has("endorsement") && !extractorNames.includes("endorsements")) {
        extractorNames = [...extractorNames, "endorsements"] as PageAssignment["extractorNames"];
      }

      if (extractorNames.length === 0) {
        extractorNames = ["sections"];
      }

      return {
        ...assignment,
        extractorNames,
      };
    });
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
    formInventory?: FormInventoryResult,
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

    const contextualExtractors = new Set(["conditions", "covered_reasons", "definitions", "exclusions", "endorsements"]);
    const contextualForms = (formInventory?.forms ?? []).filter((form): form is FormInventoryEntry & { pageStart: number; pageEnd: number } =>
      form.pageStart != null && (form.pageEnd ?? form.pageStart) != null,
    );

    const expandPagesToFormRanges = (extractorName: string, pages: number[]): number[] => {
      if (!contextualExtractors.has(extractorName)) return pages;

      const expanded = new Set<number>(pages);
      for (const page of pages) {
        for (const form of contextualForms) {
          const pageStart = form.pageStart;
          const pageEnd = form.pageEnd ?? form.pageStart;
          const formType = form.formType;
          const supportsContextualExpansion = extractorName === "endorsements"
            ? formType === "endorsement"
            : formType === "coverage" || formType === "endorsement";

          if (!supportsContextualExpansion) continue;
          if (page < pageStart || page > pageEnd) continue;

          for (let current = pageStart; current <= pageEnd; current += 1) {
            expanded.add(current);
          }
        }
      }

      return [...expanded].sort((a, b) => a - b);
    };

    const tasks = [...extractorPages.entries()]
      .flatMap(([extractorName, pages]) =>
        groupContiguousPages(expandPagesToFormRanges(extractorName, pages)).map(({ startPage, endPage }) => ({
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
    pdfInput: PdfInput,
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

    // Cache for base64 conversion when needed for page extraction
    // FileId references cannot be used for page range extraction, so we
    // need to convert them to base64 once and reuse for extractors
    let pdfBase64Cache: string | undefined;

    // Helper to get base64 for page extraction operations
    async function getPdfBase64ForExtraction(): Promise<string> {
      if (pdfBase64Cache === undefined) {
        pdfBase64Cache = await pdfInputToBase64(pdfInput);
      }
      return pdfBase64Cache;
    }

    // Step 1: Classify
    let classifyResult: ClassifyResult;
    if (resumed?.classifyResult && pipelineCtx.isPhaseComplete("classify")) {
      classifyResult = resumed.classifyResult;
      onProgress?.("Resuming from checkpoint (classify complete)...");
    } else {
      onProgress?.("Classifying document...");
      const pageCount = await getPdfPageCount(pdfInput);

      const classifyResponse = await safeGenerateObject(
        generateObject as GenerateObject<ClassifyResult>,
        {
          prompt: buildClassifyPrompt(),
          schema: ClassifyResultSchema,
          maxTokens: 512,
          providerOptions: await buildPdfProviderOptions(pdfInput, providerOptions),
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
    const pageCount = resumed?.pageCount ?? await getPdfPageCount(pdfInput);
    const templateHints = buildTemplateHints(primaryType, documentType, pageCount, template);

    // Step 2: Build form inventory
    let formInventory: FormInventoryResult | undefined;
    if (resumed?.formInventory && pipelineCtx.isPhaseComplete("form_inventory")) {
      formInventory = resumed.formInventory;
      memory.set("form_inventory", formInventory);
      onProgress?.("Resuming from checkpoint (form inventory complete)...");
    } else {
      onProgress?.(`Building form inventory for ${primaryType} ${documentType}...`);

      const formInventoryResponse = await safeGenerateObject(
        generateObject as GenerateObject<FormInventoryResult>,
        {
          prompt: buildFormInventoryPrompt(templateHints),
          schema: FormInventorySchema,
          maxTokens: 2048,
          providerOptions: await buildPdfProviderOptions(pdfInput, providerOptions),
        },
        {
          fallback: { forms: [] },
          log,
          onError: (err, attempt) =>
            log?.(`Form inventory attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
        },
      );
      trackUsage(formInventoryResponse.usage);
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
      const formInventoryHint = formInventory?.forms.length
        ? formatFormInventoryForPageMap(formInventory.forms)
        : undefined;

      // Get base64 for page extraction (caches after first conversion for fileId/URL inputs)
      const extractionBase64 = await getPdfBase64ForExtraction();

      for (let startPage = 1; startPage <= pageCount; startPage += chunkSize) {
        const endPage = Math.min(pageCount, startPage + chunkSize - 1);
        const pagesPdf = await extractPageRange(extractionBase64, startPage, endPage);
        const mapResponse = await safeGenerateObject(
          generateObject as GenerateObject<{ pages: PageAssignment[] }>,
          {
            prompt: buildPageMapPrompt(templateHints, startPage, endPage, formInventoryHint),
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
      const tasks = plan.tasks;
      onProgress?.(`Dispatching ${tasks.length} extractors...`);

      const extractorResults = await Promise.all(
        tasks.map((task) =>
          limit(async () => {
            const ext = getExtractor(task.extractorName) ?? (
              task.extractorName === "definitions" || task.extractorName === "covered_reasons"
                ? getExtractor("sections")
                : undefined
            );
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
                pdfInput,
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

      {
        onProgress?.("Extracting supplementary retrieval facts...");
        try {
          const alreadyExtractedSummary = buildAlreadyExtractedSummary(memory);
          const supplementaryResult = await runExtractor({
            name: "supplementary",
            prompt: buildSupplementaryPrompt(alreadyExtractedSummary),
            schema: SupplementarySchema,
            pdfInput,
            startPage: 1,
            endPage: pageCount,
            generateObject,
            convertPdfToImages,
            maxTokens: 4096,
            providerOptions,
          });
          trackUsage(supplementaryResult.usage);
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
        const resolution = await resolveReferentialCoverages({
          memory,
          pdfInput,
          pageCount,
          generateObject,
          convertPdfToImages,
          concurrency,
          providerOptions,
          log,
          onProgress,
        });
        trackUsage(resolution.usage);
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
            providerOptions: await buildPdfProviderOptions(pdfInput, providerOptions),
          },
          {
            fallback: { complete: true, missingFields: [], qualityIssues: [], additionalTasks: [] },
            log,
            onError: (err, attempt) =>
              log?.(`Review round ${round + 1} attempt ${attempt + 1} failed: ${err}`),
          },
        );
        trackUsage(reviewResponse.usage);
        reviewRounds.push(toReviewRoundRecord(round + 1, reviewResponse.object));

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
              const ext = getExtractor(task.extractorName) ?? (
                task.extractorName === "definitions" || task.extractorName === "covered_reasons"
                  ? getExtractor("sections")
                  : undefined
              );
              if (!ext) return null;

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

      reviewReport = buildExtractionReviewReport({
        memory,
        pageAssignments,
        reviewRounds,
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

    reviewReport ??= buildExtractionReviewReport({
      memory,
      pageAssignments,
      reviewRounds,
    });

    // Step 7: Assemble
    onProgress?.("Assembling document...");
    const document = assembleDocument(id, documentType, memory);

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
        const summaryResponse = await safeGenerateObject(
          generateObject as GenerateObject<SummaryResult>,
          {
            prompt: buildSummaryPrompt(document),
            schema: SummaryResultSchema,
            maxTokens: 512,
            providerOptions,
          },
          {
            fallback: { summary: "" },
            log,
            onError: (err, attempt) =>
              log?.(`Summary attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        );
        trackUsage(summaryResponse.usage);
        if (summaryResponse.object.summary) {
          (document as Record<string, unknown>).summary = summaryResponse.object.summary;
        }
      } catch (error) {
        await log?.(`Summary generation failed, skipping: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Step 9: Format markdown content
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
      reviewReport,
    };
  }

  return { extract };
}
