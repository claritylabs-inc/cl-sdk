/**
 * Multi-pass extraction pipeline for insurance PDFs.
 *
 * Processes documents in up to 4 passes with adaptive fallback:
 *
 * - **Pass 0 (Classification)**: Classification model classifies document as policy or quote.
 * - **Pass 1 (Metadata)**: Metadata model extracts high-level metadata (carrier, dates,
 *   premium, coverages). Supports `onMetadata?()` callback for early persistence
 *   so metadata survives pass 2 failures.
 * - **Pass 2 (Sections)**: Chunked extraction with sections model. Documents are split into
 *   15-page chunks; on JSON parse failure (usually output truncation), re-splits
 *   to 10 -> 5 pages, then falls back to sectionsFallback model. `mergeChunkedSections()` combines.
 * - **Pass 3 (Enrichment)**: Enrichment model enriches supplementary fields (regulatory context,
 *   contacts) from raw text. Non-fatal on failure.
 *
 * Separate entry points exist for policies (`extractFromPdf`) vs quotes
 * (`extractQuoteFromPdf`). `extractSectionsOnly()` retries pass 2 using
 * saved metadata from a prior pass 1.
 *
 * Provider-agnostic: accepts `ModelConfig` with Vercel AI SDK `LanguageModel` instances.
 * Defaults to Anthropic models via `createDefaultModelConfig()`.
 */

import { generateText, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ModelConfig } from "../types/models";
import { createDefaultModelConfig, MODEL_TOKEN_LIMITS } from "../types/models";
import { METADATA_PROMPT, QUOTE_METADATA_PROMPT, CLASSIFY_DOCUMENT_PROMPT, buildSectionsPrompt, buildQuoteSectionsPrompt, buildSupplementaryEnrichmentPrompt } from "../prompts/extraction";

export const SONNET_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type LogFn = (message: string) => Promise<void>;

/** Default provider options for metadata calls (Anthropic thinking). */
const DEFAULT_METADATA_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
};

/** Default provider options for fallback calls (Anthropic thinking). */
const DEFAULT_FALLBACK_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
};

/** Maximum number of retries for rate-limited requests. */
const MAX_RETRIES = 5;
/** Base delay in ms for exponential backoff (doubles each retry). */
const BASE_DELAY_MS = 2000;

/** Check if an error is a rate limit error (HTTP 429 or matching message). */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests")) {
      return true;
    }
  }
  if (typeof error === "object" && error !== null) {
    const status = (error as any).status ?? (error as any).statusCode;
    if (status === 429) return true;
  }
  return false;
}

/** Retry a function with exponential backoff on rate limit errors. */
async function withRetry<T>(
  fn: () => Promise<T>,
  log?: LogFn,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const jitter = Math.random() * 1000;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
      await log?.(`Rate limited, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Concurrency limiter — returns a function that wraps async tasks
 * so at most `concurrency` run simultaneously. No external dependency.
 */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      queue.push(run);
      next();
    });
}

/** Strip markdown code fences from AI response text. */
export function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

/**
 * Recursively convert null values to undefined.
 *
 * Required because Convex rejects `null` for optional fields, but Claude
 * routinely returns `null` for missing values in JSON output. Applied to
 * all extraction results before persistence.
 */
export function sanitizeNulls<T>(obj: T): T {
  if (obj === null || obj === undefined) return undefined as any;
  if (Array.isArray(obj)) return obj.map(sanitizeNulls) as any;
  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj as any)) {
      result[key] = sanitizeNulls(value);
    }
    return result;
  }
  return obj;
}

/** Map raw Claude extraction JSON to mutation-compatible fields. */
export function applyExtracted(extracted: any) {
  const meta = extracted.metadata ?? extracted;

  const policyTypes = Array.isArray(meta.policyTypes)
    ? meta.policyTypes
    : meta.policyType
      ? [meta.policyType]
      : ["other"];

  return {
    carrier: meta.carrier || meta.security || "Unknown",
    security: meta.security ?? undefined,
    underwriter: meta.underwriter ?? undefined,
    mga: meta.mga ?? undefined,
    broker: meta.broker ?? undefined,
    policyNumber: meta.policyNumber || "Unknown",
    policyTypes,
    documentType: (meta.documentType === "quote" ? "quote" : "policy") as "policy" | "quote",
    policyYear: meta.policyYear || new Date().getFullYear(),
    effectiveDate: meta.effectiveDate || "Unknown",
    expirationDate: meta.expirationDate || "Unknown",
    isRenewal: meta.isRenewal ?? false,
    coverages: sanitizeNulls(extracted.coverages || meta.coverages || []),
    premium: meta.premium ?? undefined,
    insuredName: meta.insuredName || "Unknown",
    summary: meta.summary ?? undefined,
    metadataSource: extracted.metadataSource ? sanitizeNulls(extracted.metadataSource) : undefined,
    document: extracted.document ? sanitizeNulls(extracted.document) : undefined,
    extractionStatus: "complete" as const,
    extractionError: "",
  };
}

/**
 * Merge document sections from chunked extraction passes.
 *
 * Combines sections from all chunks into a single array and takes the last
 * non-null value for supplementary fields (regulatoryContext, complaintContact,
 * costsAndFees, claimsContact) since these typically appear only once.
 */
export function mergeChunkedSections(
  metadataResult: any,
  sectionChunks: any[],
): any {
  const allSections: any[] = [];
  let regulatoryContext: any = null;
  let complaintContact: any = null;
  let costsAndFees: any = null;
  let claimsContact: any = null;

  for (const chunk of sectionChunks) {
    if (chunk.sections) {
      allSections.push(...chunk.sections);
    }
    if (chunk.regulatoryContext) regulatoryContext = chunk.regulatoryContext;
    if (chunk.complaintContact) complaintContact = chunk.complaintContact;
    if (chunk.costsAndFees) costsAndFees = chunk.costsAndFees;
    if (chunk.claimsContact) claimsContact = chunk.claimsContact;
  }

  return {
    metadata: metadataResult.metadata,
    metadataSource: metadataResult.metadataSource,
    coverages: metadataResult.coverages,
    document: {
      sections: allSections,
      ...(regulatoryContext && { regulatoryContext }),
      ...(complaintContact && { complaintContact }),
      ...(costsAndFees && { costsAndFees }),
      ...(claimsContact && { claimsContact }),
    },
    totalPages: metadataResult.totalPages,
  };
}

/** Determine page ranges for chunked extraction. */
export function getPageChunks(totalPages: number, chunkSize: number = 30): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  for (let start = 1; start <= totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalPages);
    chunks.push([start, end]);
  }
  return chunks;
}

/**
 * Call a model with a PDF document and prompt via Vercel AI SDK.
 * Retries automatically on rate limit errors with exponential backoff.
 */
async function callModel(
  model: LanguageModel,
  pdfBase64: string,
  prompt: string,
  maxTokens: number,
  providerOptions?: ProviderOptions,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  await log?.(`Calling model (max ${maxTokens} tokens)...`);
  const start = Date.now();

  const { text, usage } = await withRetry(
    () => generateText({
      model,
      maxOutputTokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "file", data: pdfBase64, mediaType: "application/pdf" },
          { type: "text", text: prompt },
        ],
      }],
      ...(providerOptions ? { providerOptions } : {}),
    }),
    log,
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  await log?.(`${inputTokens} in / ${outputTokens} out tokens (${elapsed}s)`);
  onTokenUsage?.({ inputTokens, outputTokens });

  return text || "{}";
}

/**
 * Call a model with text-only prompt (no PDF) via Vercel AI SDK.
 * Used for pass 3 enrichment. Retries on rate limit errors.
 */
async function callModelText(
  model: LanguageModel,
  prompt: string,
  maxTokens: number,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  await log?.(`Calling model text-only (max ${maxTokens} tokens)...`);
  const start = Date.now();

  const { text, usage } = await withRetry(
    () => generateText({
      model,
      maxOutputTokens: maxTokens,
      messages: [{
        role: "user",
        content: prompt,
      }],
    }),
    log,
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  await log?.(`text: ${inputTokens} in / ${outputTokens} out tokens (${elapsed}s)`);
  onTokenUsage?.({ inputTokens, outputTokens });

  return text || "{}";
}

/** Resolve models, lazily creating defaults if not provided. */
function resolveModels(models?: ModelConfig): ModelConfig {
  return models ?? createDefaultModelConfig();
}

/**
 * Pass 3: Enrich supplementary fields with structured data.
 * Text-only enrichment call — non-fatal on failure (returns document unchanged).
 */
export async function enrichSupplementaryFields(
  document: any,
  models?: ModelConfig,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
): Promise<any> {
  const fields: Record<string, string> = {};
  if (document.regulatoryContext?.content) {
    fields.regulatoryContext = document.regulatoryContext.content;
  }
  if (document.complaintContact?.content) {
    fields.complaintContact = document.complaintContact.content;
  }
  if (document.costsAndFees?.content) {
    fields.costsAndFees = document.costsAndFees.content;
  }
  if (document.claimsContact?.content) {
    fields.claimsContact = document.claimsContact.content;
  }

  if (Object.keys(fields).length === 0) {
    await log?.("Pass 3: No supplementary fields to enrich, skipping.");
    return document;
  }

  await log?.(`Pass 3: Enriching ${Object.keys(fields).length} supplementary field(s)...`);

  try {
    const resolved = resolveModels(models);
    const prompt = buildSupplementaryEnrichmentPrompt(fields);
    const raw = await callModelText(resolved.enrichment, prompt, MODEL_TOKEN_LIMITS.enrichment, log, onTokenUsage);
    const parsed = JSON.parse(stripFences(raw));

    const enriched = { ...document };

    if (parsed.regulatoryContext && enriched.regulatoryContext) {
      enriched.regulatoryContext = {
        ...enriched.regulatoryContext,
        ...sanitizeNulls(parsed.regulatoryContext),
      };
    }
    if (parsed.complaintContact && enriched.complaintContact) {
      enriched.complaintContact = {
        ...enriched.complaintContact,
        ...sanitizeNulls(parsed.complaintContact),
      };
    }
    if (parsed.costsAndFees && enriched.costsAndFees) {
      enriched.costsAndFees = {
        ...enriched.costsAndFees,
        ...sanitizeNulls(parsed.costsAndFees),
      };
    }
    if (parsed.claimsContact && enriched.claimsContact) {
      enriched.claimsContact = {
        ...enriched.claimsContact,
        ...sanitizeNulls(parsed.claimsContact),
      };
    }

    await log?.("Pass 3: Supplementary enrichment complete.");
    return enriched;
  } catch (e: any) {
    await log?.(`Pass 3: Enrichment failed (non-fatal): ${e.message}`);
    return document;
  }
}

export interface ClassifyOptions {
  log?: LogFn;
  models?: ModelConfig;
  /** Called after each model call with token usage for tracking. */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Pass 0: Classify document as policy or quote.
 */
export async function classifyDocumentType(
  pdfBase64: string,
  options?: ClassifyOptions,
): Promise<{ documentType: "policy" | "quote"; confidence: number; signals: string[] }> {
  const { log, models, onTokenUsage } = options ?? {};
  const resolved = resolveModels(models);
  await log?.("Pass 0: Classifying document type...");
  const raw = await callModel(
    resolved.classification, pdfBase64, CLASSIFY_DOCUMENT_PROMPT,
    MODEL_TOKEN_LIMITS.classification, undefined, log, onTokenUsage,
  );
  try {
    const parsed = JSON.parse(stripFences(raw));
    const documentType = parsed.documentType === "quote" ? "quote" : "policy";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const signals = Array.isArray(parsed.signals) ? parsed.signals : [];
    await log?.(`Pass 0: Classified as "${documentType}" (confidence: ${confidence.toFixed(2)}, signals: ${signals.join(", ")})`);
    return { documentType, confidence, signals };
  } catch {
    await log?.("Pass 0: Classification parse failed, defaulting to policy");
    return { documentType: "policy", confidence: 0, signals: ["parse_failed"] };
  }
}

/** Map raw Claude quote extraction JSON to mutation-compatible fields. */
export function applyExtractedQuote(extracted: any) {
  const meta = extracted.metadata ?? extracted;

  const policyTypes = Array.isArray(meta.policyTypes)
    ? meta.policyTypes
    : ["other"];

  return {
    carrier: meta.carrier || meta.security || "Unknown",
    security: meta.security ?? undefined,
    underwriter: meta.underwriter ?? undefined,
    mga: meta.mga ?? undefined,
    broker: meta.broker ?? undefined,
    quoteNumber: meta.quoteNumber || meta.policyNumber || "Unknown",
    policyTypes,
    quoteYear: meta.quoteYear || meta.policyYear || new Date().getFullYear(),
    proposedEffectiveDate: meta.proposedEffectiveDate || meta.effectiveDate || undefined,
    proposedExpirationDate: meta.proposedExpirationDate || meta.expirationDate || undefined,
    quoteExpirationDate: meta.quoteExpirationDate ?? undefined,
    isRenewal: meta.isRenewal ?? false,
    coverages: sanitizeNulls(
      (extracted.coverages || meta.coverages || []).map((c: any) => ({
        name: c.name,
        proposedLimit: c.proposedLimit || c.limit || "N/A",
        proposedDeductible: c.proposedDeductible || c.deductible,
        pageNumber: c.pageNumber,
        sectionRef: c.sectionRef,
      }))
    ),
    premium: meta.premium ?? undefined,
    premiumBreakdown: sanitizeNulls(extracted.premiumBreakdown || meta.premiumBreakdown) ?? undefined,
    insuredName: meta.insuredName || "Unknown",
    summary: meta.summary ?? undefined,
    subjectivities: sanitizeNulls(extracted.subjectivities || meta.subjectivities) ?? undefined,
    underwritingConditions: sanitizeNulls(extracted.underwritingConditions || meta.underwritingConditions) ?? undefined,
    metadataSource: extracted.metadataSource ? sanitizeNulls(extracted.metadataSource) : undefined,
    document: extracted.document ? sanitizeNulls(extracted.document) : undefined,
    extractionStatus: "complete" as const,
    extractionError: "",
  };
}

/**
 * Merge document sections from chunked quote extraction passes.
 *
 * Similar to `mergeChunkedSections` but also accumulates quote-specific
 * fields: subjectivities and underwriting conditions from all chunks.
 */
export function mergeChunkedQuoteSections(
  metadataResult: any,
  sectionChunks: any[],
): any {
  const allSections: any[] = [];
  const allSubjectivities: any[] = metadataResult.subjectivities || [];
  const allConditions: any[] = metadataResult.underwritingConditions || [];

  for (const chunk of sectionChunks) {
    if (chunk.sections) {
      allSections.push(...chunk.sections);
    }
    if (chunk.subjectivities) {
      allSubjectivities.push(...chunk.subjectivities);
    }
    if (chunk.underwritingConditions) {
      allConditions.push(...chunk.underwritingConditions);
    }
  }

  return {
    metadata: metadataResult.metadata,
    metadataSource: metadataResult.metadataSource,
    coverages: metadataResult.coverages,
    premiumBreakdown: metadataResult.premiumBreakdown,
    subjectivities: allSubjectivities.length > 0 ? allSubjectivities : undefined,
    underwritingConditions: allConditions.length > 0 ? allConditions : undefined,
    document: {
      sections: allSections,
    },
    totalPages: metadataResult.totalPages,
  };
}

/** Chunk sizes to try in order — progressively smaller to avoid output token limits. */
const CHUNK_SIZES = [15, 10, 5];

export type PromptBuilder = (pageStart: number, pageEnd: number) => string;

/**
 * Extract sections from a single page range with recursive retry.
 *
 * Strategy: attempt sections model first. On JSON parse failure (typically output
 * truncation), re-split the range into smaller sub-chunks using the next size
 * in `CHUNK_SIZES` [15, 10, 5] and retry recursively. After exhausting all
 * smaller sizes, falls back to sectionsFallback model with higher token limit.
 */
async function extractChunkWithRetry(
  models: ModelConfig,
  pdfBase64: string,
  start: number,
  end: number,
  sizeIndex: number,
  promptBuilder: PromptBuilder,
  fallbackProviderOptions?: ProviderOptions,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
  concurrency: number = 2,
): Promise<any[]> {
  await log?.(`Pass 2: Extracting sections pages ${start}–${end}...`);
  const chunkRaw = await callModel(
    models.sections, pdfBase64, promptBuilder(start, end),
    MODEL_TOKEN_LIMITS.sections, undefined, log, onTokenUsage,
  );
  try {
    return [JSON.parse(stripFences(chunkRaw))];
  } catch {
    // Try re-splitting into smaller sub-chunks
    const nextSizeIndex = sizeIndex + 1;
    if (nextSizeIndex < CHUNK_SIZES.length) {
      const smallerSize = CHUNK_SIZES[nextSizeIndex];
      const pageSpan = end - start + 1;
      if (pageSpan > smallerSize) {
        await log?.(`Truncated pages ${start}–${end}, re-splitting into ${smallerSize}-page chunks...`);
        const subChunks = getPageChunks(pageSpan, smallerSize).map(
          ([s, e]) => [s + start - 1, e + start - 1] as [number, number],
        );
        const limit = pLimit(concurrency);
        const nestedResults = await Promise.all(
          subChunks.map(([subStart, subEnd]) =>
            limit(() => extractChunkWithRetry(
              models, pdfBase64, subStart, subEnd, nextSizeIndex,
              promptBuilder, fallbackProviderOptions, log, onTokenUsage, concurrency,
            ))
          ),
        );
        return nestedResults.flat();
      }
    }

    // All smaller sizes exhausted — fall back to sectionsFallback model
    await log?.(`Sections model exhausted for pages ${start}–${end}, falling back...`);
    const fallbackRaw = await callModel(
      models.sectionsFallback, pdfBase64, promptBuilder(start, end),
      MODEL_TOKEN_LIMITS.sectionsFallback, fallbackProviderOptions, log, onTokenUsage,
    );
    try {
      return [JSON.parse(stripFences(fallbackRaw))];
    } catch (e2: any) {
      const preview = fallbackRaw.slice(0, 200);
      await log?.(`Failed to parse sections JSON (fallback): ${preview}`);
      throw new Error(`Sections JSON parse failed: ${e2.message}`);
    }
  }
}

/**
 * Extract sections from page chunks with adaptive re-splitting and fallback.
 */
async function extractSectionChunks(
  models: ModelConfig,
  pdfBase64: string,
  pageCount: number,
  promptBuilder: PromptBuilder = buildSectionsPrompt,
  fallbackProviderOptions?: ProviderOptions,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
  concurrency: number = 2,
): Promise<any[]> {
  const chunks = getPageChunks(pageCount, CHUNK_SIZES[0]);
  const limit = pLimit(concurrency);

  const nestedResults = await Promise.all(
    chunks.map(([start, end]) =>
      limit(() => extractChunkWithRetry(
        models, pdfBase64, start, end, 0, promptBuilder,
        fallbackProviderOptions, log, onTokenUsage, concurrency,
      ))
    ),
  );

  return nestedResults.flat();
}

/** Token usage reported per model call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExtractOptions {
  log?: LogFn;
  onMetadata?: (raw: string) => Promise<void>;
  models?: ModelConfig;
  /** Provider-specific options for metadata calls (e.g. Anthropic thinking). Defaults to Anthropic thinking enabled. */
  metadataProviderOptions?: ProviderOptions;
  /** Provider-specific options for fallback calls. Defaults to Anthropic thinking enabled. */
  fallbackProviderOptions?: ProviderOptions;
  /** Maximum number of chunk extractions to run in parallel (default: 2). */
  concurrency?: number;
  /** Called after each model call with token usage for tracking. */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Full extraction pipeline for policy documents (passes 1-3).
 *
 * - **Pass 1**: Metadata model extracts metadata, coverages, and page count.
 * - **Pass 2**: Sections model extracts sections in chunks (with adaptive retry and fallback).
 * - **Pass 3**: Enrichment model enriches supplementary fields (non-fatal).
 *
 * @param pdfBase64 - Base64-encoded PDF document.
 * @param options - Extraction options (models, logging, callbacks, provider options).
 */
export async function extractFromPdf(
  pdfBase64: string,
  options?: ExtractOptions,
) {
  const {
    log,
    onMetadata,
    models,
    metadataProviderOptions = DEFAULT_METADATA_PROVIDER_OPTIONS,
    fallbackProviderOptions = DEFAULT_FALLBACK_PROVIDER_OPTIONS,
    concurrency = 2,
    onTokenUsage,
  } = options ?? {};
  const resolved = resolveModels(models);

  // Pass 1: Metadata extraction
  await log?.("Pass 1: Extracting metadata...");
  const metadataRaw = await callModel(
    resolved.metadata, pdfBase64, METADATA_PROMPT,
    MODEL_TOKEN_LIMITS.metadata, metadataProviderOptions, log, onTokenUsage,
  );

  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    const preview = metadataRaw.slice(0, 200);
    await log?.(`Failed to parse metadata JSON: ${preview}`);
    throw new Error(`Metadata JSON parse failed: ${e.message}`);
  }

  // Persist metadata early so it survives pass 2 failures
  await onMetadata?.(metadataRaw);

  const pageCount = metadataResult.totalPages || 1;
  await log?.(`Document: ${pageCount} page(s)`);

  // Pass 2: Sections (chunked, with fallback)
  const sectionChunks = await extractSectionChunks(
    resolved, pdfBase64, pageCount, buildSectionsPrompt,
    fallbackProviderOptions, log, onTokenUsage, concurrency,
  );

  await log?.("Merging extraction results...");
  const merged = mergeChunkedSections(metadataResult, sectionChunks);

  // Pass 3: Enrich supplementary fields (non-fatal)
  if (merged.document) {
    merged.document = await enrichSupplementaryFields(merged.document, resolved, log, onTokenUsage);
  }

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

export interface ExtractSectionsOptions {
  log?: LogFn;
  promptBuilder?: PromptBuilder;
  models?: ModelConfig;
  /** Provider-specific options for fallback calls. */
  fallbackProviderOptions?: ProviderOptions;
  /** Maximum number of chunk extractions to run in parallel (default: 2). */
  concurrency?: number;
  /** Called after each model call with token usage for tracking. */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Sections-only extraction: skip pass 1, use saved metadata.
 * For retrying when metadata succeeded but sections failed.
 */
export async function extractSectionsOnly(
  pdfBase64: string,
  metadataRaw: string,
  options?: ExtractSectionsOptions,
) {
  const {
    log,
    promptBuilder = buildSectionsPrompt,
    models,
    fallbackProviderOptions = DEFAULT_FALLBACK_PROVIDER_OPTIONS,
    concurrency = 2,
    onTokenUsage,
  } = options ?? {};
  const resolved = resolveModels(models);

  await log?.("Using saved metadata, skipping pass 1...");
  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    throw new Error(`Saved metadata JSON parse failed: ${e.message}`);
  }

  const pageCount = metadataResult.totalPages || 1;
  await log?.(`Document: ${pageCount} page(s)`);

  const sectionChunks = await extractSectionChunks(
    resolved, pdfBase64, pageCount, promptBuilder,
    fallbackProviderOptions, log, onTokenUsage, concurrency,
  );

  await log?.("Merging extraction results...");
  const merged = mergeChunkedSections(metadataResult, sectionChunks);

  // Pass 3: Enrich supplementary fields (non-fatal)
  if (merged.document) {
    merged.document = await enrichSupplementaryFields(merged.document, resolved, log, onTokenUsage);
  }

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

/**
 * Full extraction pipeline for quote documents (passes 1-2).
 *
 * - **Pass 1**: Metadata model extracts quote-specific metadata (proposed dates,
 *   subjectivities, premium breakdown).
 * - **Pass 2**: Sections model extracts sections in chunks (with adaptive retry).
 *
 * Does not run pass 3 enrichment (quotes rarely have supplementary fields).
 *
 * @param pdfBase64 - Base64-encoded PDF document.
 * @param options - Extraction options (models, logging, callbacks, provider options).
 */
export async function extractQuoteFromPdf(
  pdfBase64: string,
  options?: ExtractOptions,
) {
  const {
    log,
    onMetadata,
    models,
    metadataProviderOptions = DEFAULT_METADATA_PROVIDER_OPTIONS,
    fallbackProviderOptions = DEFAULT_FALLBACK_PROVIDER_OPTIONS,
    concurrency = 2,
    onTokenUsage,
  } = options ?? {};
  const resolved = resolveModels(models);

  // Pass 1: Quote metadata
  await log?.("Pass 1: Extracting quote metadata...");
  const metadataRaw = await callModel(
    resolved.metadata, pdfBase64, QUOTE_METADATA_PROMPT,
    MODEL_TOKEN_LIMITS.metadata, metadataProviderOptions, log, onTokenUsage,
  );

  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    const preview = metadataRaw.slice(0, 200);
    await log?.(`Failed to parse quote metadata JSON: ${preview}`);
    throw new Error(`Quote metadata JSON parse failed: ${e.message}`);
  }

  // Persist metadata early
  await onMetadata?.(metadataRaw);

  const pageCount = metadataResult.totalPages || 1;
  await log?.(`Quote document: ${pageCount} page(s)`);

  // Pass 2: Quote sections (chunked)
  const sectionChunks = await extractSectionChunks(
    resolved, pdfBase64, pageCount, buildQuoteSectionsPrompt,
    fallbackProviderOptions, log, onTokenUsage, concurrency,
  );

  await log?.("Merging quote extraction results...");
  const merged = mergeChunkedQuoteSections(metadataResult, sectionChunks);

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}
