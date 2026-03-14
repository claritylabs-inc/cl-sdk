/**
 * Shared helpers for policy extraction.
 * Used by extractPolicy, retryExtraction, and reExtractFromFile actions.
 */

import Anthropic from "@anthropic-ai/sdk";
import { METADATA_PROMPT, QUOTE_METADATA_PROMPT, CLASSIFY_DOCUMENT_PROMPT, buildSectionsPrompt, buildQuoteSectionsPrompt, buildSupplementaryEnrichmentPrompt } from "../prompts/extraction";

export const SONNET_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type LogFn = (message: string) => Promise<void>;

/** Strip markdown code fences from AI response text. */
export function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

/**
 * Recursively convert null values to undefined.
 * Convex rejects null for optional fields — Claude often returns null for missing values.
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

/** Merge document sections from chunked extraction passes. */
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

/** Call Claude API with a PDF document and prompt. */
export async function callClaude(
  anthropic: Anthropic,
  pdfBase64: string,
  prompt: string,
  maxTokens: number = 16384,
  model: string = SONNET_MODEL,
  log?: LogFn,
) {
  const modelShort = model.includes("haiku") ? "Haiku" : "Sonnet";
  await log?.(`Calling Claude ${modelShort} (max ${maxTokens} tokens)...`);
  const start = Date.now();

  const isSonnet = model.includes("sonnet");
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    ...(isSonnet ? { thinking: { type: "enabled", budget_tokens: 4096 } } : {}),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  } as any);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const thinkingTokens = (response.usage as any)?.thinking_tokens;
  const thinkingInfo = thinkingTokens ? ` / ${thinkingTokens} thinking` : "";
  await log?.(`${modelShort}: ${inputTokens} in / ${outputTokens} out${thinkingInfo} tokens (${elapsed}s)`);

  // With adaptive thinking, response may include thinking blocks before the text block
  const textBlock = response.content.find((b: any) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "{}";
}

/** Call Claude API with text-only prompt (no PDF). Used for pass 3 enrichment. */
export async function callClaudeText(
  anthropic: Anthropic,
  prompt: string,
  maxTokens: number = 4096,
  model: string = HAIKU_MODEL,
  log?: LogFn,
) {
  const modelShort = model.includes("haiku") ? "Haiku" : "Sonnet";
  await log?.(`Calling Claude ${modelShort} text-only (max ${maxTokens} tokens)...`);
  const start = Date.now();

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  await log?.(`${modelShort} text: ${inputTokens} in / ${outputTokens} out tokens (${elapsed}s)`);

  return response.content[0].type === "text" ? response.content[0].text : "{}";
}

/**
 * Pass 3: Enrich supplementary fields with structured data.
 * Text-only Haiku call — non-fatal on failure (returns document unchanged).
 */
export async function enrichSupplementaryFields(
  anthropic: Anthropic,
  document: any,
  log?: LogFn,
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

  await log?.(`Pass 3: Enriching ${Object.keys(fields).length} supplementary field(s) (Haiku text-only)...`);

  try {
    const prompt = buildSupplementaryEnrichmentPrompt(fields);
    const raw = await callClaudeText(anthropic, prompt, 4096, HAIKU_MODEL, log);
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

/**
 * Pass 0: Classify document as policy or quote using Haiku.
 */
export async function classifyDocumentType(
  anthropic: Anthropic,
  pdfBase64: string,
  log?: LogFn,
): Promise<{ documentType: "policy" | "quote"; confidence: number; signals: string[] }> {
  await log?.("Pass 0: Classifying document type (Haiku)...");
  const raw = await callClaude(
    anthropic, pdfBase64, CLASSIFY_DOCUMENT_PROMPT, 512, HAIKU_MODEL, log,
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

/** Merge document sections from chunked quote extraction passes. */
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

/** Chunk sizes to try in order — progressively smaller to avoid Haiku's 8192 output token limit. */
const CHUNK_SIZES = [15, 10, 5];

export type PromptBuilder = (pageStart: number, pageEnd: number) => string;

/**
 * Try to extract a single page range with Haiku. On JSON parse failure (likely truncation),
 * re-split into smaller sub-chunks and retry. After exhausting smaller sizes, fall back to Sonnet.
 */
async function extractChunkWithRetry(
  anthropic: Anthropic,
  pdfBase64: string,
  start: number,
  end: number,
  sizeIndex: number,
  promptBuilder: PromptBuilder,
  log?: LogFn,
): Promise<any[]> {
  await log?.(`Pass 2: Extracting sections pages ${start}–${end} (Haiku)...`);
  const chunkRaw = await callClaude(
    anthropic, pdfBase64, promptBuilder(start, end), 8192, HAIKU_MODEL, log,
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
        await log?.(`Haiku truncated pages ${start}–${end}, re-splitting into ${smallerSize}-page chunks...`);
        const subChunks = getPageChunks(pageSpan, smallerSize).map(
          ([s, e]) => [s + start - 1, e + start - 1] as [number, number],
        );
        const results: any[] = [];
        for (const [subStart, subEnd] of subChunks) {
          const subResults = await extractChunkWithRetry(
            anthropic, pdfBase64, subStart, subEnd, nextSizeIndex, promptBuilder, log,
          );
          results.push(...subResults);
        }
        return results;
      }
    }

    // All smaller sizes exhausted — fall back to Sonnet (16384 token limit)
    await log?.(`Haiku exhausted for pages ${start}–${end}, falling back to Sonnet...`);
    const sonnetRaw = await callClaude(
      anthropic, pdfBase64, promptBuilder(start, end), 16384, SONNET_MODEL, log,
    );
    try {
      return [JSON.parse(stripFences(sonnetRaw))];
    } catch (e2: any) {
      const preview = sonnetRaw.slice(0, 200);
      await log?.(`Failed to parse sections JSON (Sonnet fallback): ${preview}`);
      throw new Error(`Sections JSON parse failed: ${e2.message}`);
    }
  }
}

/**
 * Extract sections from page chunks using Haiku, with adaptive re-splitting and Sonnet fallback.
 */
async function extractSectionChunks(
  anthropic: Anthropic,
  pdfBase64: string,
  pageCount: number,
  promptBuilder: PromptBuilder = buildSectionsPrompt,
  log?: LogFn,
): Promise<any[]> {
  const chunks = getPageChunks(pageCount, CHUNK_SIZES[0]);
  const sectionChunks: any[] = [];

  for (const [start, end] of chunks) {
    const results = await extractChunkWithRetry(anthropic, pdfBase64, start, end, 0, promptBuilder, log);
    sectionChunks.push(...results);
  }

  return sectionChunks;
}

/**
 * Two-pass extraction: Sonnet for metadata + Haiku for sections.
 * All documents use this flow — metadata with Sonnet, sections with Haiku (cheaper).
 *
 * @param onMetadata - Optional callback invoked after pass 1 succeeds with the raw metadata JSON string.
 *   Use this to persist metadata early so it survives pass 2 failures.
 */
export async function extractFromPdf(
  anthropic: Anthropic,
  pdfBase64: string,
  log?: LogFn,
  onMetadata?: (raw: string) => Promise<void>,
) {
  // Pass 1: Sonnet for metadata, coverages, page count
  await log?.("Pass 1: Extracting metadata (Sonnet)...");
  const metadataRaw = await callClaude(
    anthropic, pdfBase64, METADATA_PROMPT, 4096, SONNET_MODEL, log,
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

  // Pass 2: Haiku for sections (chunked, with Sonnet fallback)
  const sectionChunks = await extractSectionChunks(anthropic, pdfBase64, pageCount, buildSectionsPrompt, log);

  await log?.("Merging extraction results...");
  const merged = mergeChunkedSections(metadataResult, sectionChunks);

  // Pass 3: Enrich supplementary fields (non-fatal)
  if (merged.document) {
    merged.document = await enrichSupplementaryFields(anthropic, merged.document, log);
  }

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

/**
 * Sections-only extraction: skip pass 1, use saved metadata.
 * For retrying when metadata succeeded but sections failed.
 */
export async function extractSectionsOnly(
  anthropic: Anthropic,
  pdfBase64: string,
  metadataRaw: string,
  log?: LogFn,
  promptBuilder: PromptBuilder = buildSectionsPrompt,
) {
  await log?.("Using saved metadata, skipping pass 1...");
  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    throw new Error(`Saved metadata JSON parse failed: ${e.message}`);
  }

  const pageCount = metadataResult.totalPages || 1;
  await log?.(`Document: ${pageCount} page(s)`);

  const sectionChunks = await extractSectionChunks(anthropic, pdfBase64, pageCount, promptBuilder, log);

  await log?.("Merging extraction results...");
  const merged = mergeChunkedSections(metadataResult, sectionChunks);

  // Pass 3: Enrich supplementary fields (non-fatal)
  if (merged.document) {
    merged.document = await enrichSupplementaryFields(anthropic, merged.document, log);
  }

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

/**
 * Two-pass extraction for quote documents.
 * Pass 1: Sonnet for quote-specific metadata.
 * Pass 2: Haiku for quote sections (chunked).
 */
export async function extractQuoteFromPdf(
  anthropic: Anthropic,
  pdfBase64: string,
  log?: LogFn,
  onMetadata?: (raw: string) => Promise<void>,
) {
  // Pass 1: Sonnet for quote metadata
  await log?.("Pass 1: Extracting quote metadata (Sonnet)...");
  const metadataRaw = await callClaude(
    anthropic, pdfBase64, QUOTE_METADATA_PROMPT, 4096, SONNET_MODEL, log,
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

  // Pass 2: Haiku for quote sections (chunked)
  const sectionChunks = await extractSectionChunks(anthropic, pdfBase64, pageCount, buildQuoteSectionsPrompt, log);

  await log?.("Merging quote extraction results...");
  const merged = mergeChunkedQuoteSections(metadataResult, sectionChunks);

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}
