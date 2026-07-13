import type { GenerateObject, TokenUsage, LogFn, PdfInput, PerformanceReport, ModelCallReport } from "../core/types";
import type { QualityGateMode } from "../core/quality";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import { resolveModelBudget } from "../core/model-budget";
import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk } from "../storage/chunk-types";
import type { DocumentSourceNode, PolicyOperationalProfile, SourceChunk, SourceSpan, SourceStore } from "../source";
import { chunkSourceSpans } from "../source";
import {
  isDoclingExtractionInput,
  mergeSourceSpans,
  normalizeDoclingDocument,
  type DoclingExtractionInput,
} from "./docling";
import type { ExtractionReviewReport } from "./quality";
import { shouldFailQualityGate } from "../core/quality";
import { runSourceTreeExtraction } from "./source-tree-extractor";
import type { CoverageRecoveryDiagnostics } from "./coverage-recovery";

export interface ExtractorConfig {
  generateObject: GenerateObject;
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
  sourceStore?: SourceStore;
  qualityGate?: QualityGateMode;
  modelCapabilities?: ModelCapabilities;
  modelCapabilitiesByTaskKind?: Partial<Record<ModelTaskKind, ModelCapabilities>>;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
}

export interface ExtractionResult {
  document: InsuranceDocument;
  chunks: DocumentChunk[];
  sourceSpans: SourceSpan[];
  sourceChunks: SourceChunk[];
  sourceTree?: DocumentSourceNode[];
  operationalProfile?: PolicyOperationalProfile;
  coverageRecovery?: CoverageRecoveryDiagnostics;
  warnings?: string[];
  tokenUsage: TokenUsage;
  usageReporting: {
    modelCalls: number;
    callsWithUsage: number;
    callsMissingUsage: number;
  };
  performanceReport: PerformanceReport;
  reviewReport: ExtractionReviewReport;
}

export interface ExtractOptions {
  /** Caller-provided raw source spans for this document, reused for evidence grounding and optional persistence. */
  sourceSpans?: SourceSpan[];
  /** Opt in to document-wide semantic coverage, schedule, and financial recovery. */
  coverageRecovery?: { enabled: boolean };
}

export type ExtractionInput = PdfInput | DoclingExtractionInput;

export function createExtractor(config: ExtractorConfig) {
  const {
    generateObject,
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
    sourceStore,
    qualityGate = "warn",
    modelCapabilities,
    modelCapabilitiesByTaskKind,
    modelBudgetConstraints,
  } = config;

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

  async function extract(
    input: ExtractionInput,
    documentId?: string,
    options?: ExtractOptions,
  ): Promise<ExtractionResult> {
    const id = documentId ?? `doc-${Date.now()}`;
    const isDoclingInput = isDoclingExtractionInput(input);
    const doclingDocument = isDoclingInput
      ? normalizeDoclingDocument(input.document, {
          documentId: id,
          sourceKind: input.sourceKind,
        })
      : undefined;
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
      onProgress?.("Building source-native document tree...");
      const v3 = await runSourceTreeExtraction({
        id,
        sourceSpans,
        generateObject,
        providerOptions: activeProviderOptions,
        resolveBudget,
        trackUsage,
        log,
        coverageRecovery: options?.coverageRecovery,
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
        coverageRecovery: v3.coverageRecovery,
        warnings: v3.warnings,
        tokenUsage: v3.tokenUsage,
        usageReporting: v3.usageReporting,
        performanceReport: v3.performanceReport,
        reviewReport,
      };
    }

    throw new Error("cl-sdk extraction now requires preprocessed source spans. Run LiteParse or another source-span preprocessor and pass ExtractOptions.sourceSpans; legacy raw-PDF page-map extraction has been removed.");
  }

  return { extract };
}
