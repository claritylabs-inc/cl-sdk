import type { DocumentStore, MemoryStore } from "../storage/interfaces";
import type { SubQuestion, EvidenceItem, RetrievalResult } from "../schemas/query";
import type { QueryRetrievalMode } from "../schemas/query";
import type { ChunkFilter, DocumentFilters } from "../storage/chunk-types";
import type { LogFn } from "../core/types";
import type { SourceRetriever } from "../source";
import { orderSourceEvidence } from "../source";

function recordToKVArray(record: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export interface RetrieverConfig {
  documentStore: DocumentStore;
  memoryStore: MemoryStore;
  sourceRetriever?: SourceRetriever;
  retrievalLimit: number;
  retrievalMode: QueryRetrievalMode;
  log?: LogFn;
}

/**
 * Retrieve evidence for a single sub-question from all relevant stores.
 * Runs chunk search, document lookup, and conversation history in parallel.
 */
export async function retrieve(
  subQuestion: SubQuestion,
  conversationId: string | undefined,
  config: RetrieverConfig,
): Promise<RetrievalResult> {
  const { documentStore, memoryStore, sourceRetriever, retrievalLimit, retrievalMode, log } = config;
  const evidence: EvidenceItem[] = [];

  const tasks: Promise<void>[] = [];

  // Source-tree search is the v3 preferred evidence path. It retrieves
  // hierarchy-expanded source nodes and exact leaf spans from the caller's
  // source store instead of relying on extracted graph chunks.
  if (retrievalMode === "source_rag" || retrievalMode === "hybrid" || retrievalMode === "long_context") {
    tasks.push(
      (async () => {
        try {
          const nodeResults = await sourceRetriever?.searchSourceNodes?.({
            question: subQuestion.question,
            limit: retrievalLimit,
            mode: retrievalMode,
          }) ?? [];

          for (const result of nodeResults) {
            const hierarchyText = result.hierarchy
              .map((node) => `${node.path} ${node.title}: ${node.textExcerpt ?? node.description}`)
              .join("\n");
            const spanText = result.spans
              .map((span) => `[source-span:${span.id}${span.pageStart ? ` p.${span.pageStart}` : ""}]\n${span.text}`)
              .join("\n\n");
            evidence.push({
              source: "source_node",
              sourceNodeId: result.node.id,
              sourceSpanId: result.spans[0]?.id,
              documentId: result.node.documentId,
              text: [hierarchyText, spanText].filter(Boolean).join("\n\n"),
              relevance: result.relevance,
              retrievalMode,
              sourceLocation: result.spans[0]?.location ?? (result.node.pageStart ? { page: result.node.pageStart } : undefined),
              metadata: [
                { key: "kind", value: result.node.kind },
                { key: "path", value: result.node.path },
                { key: "title", value: result.node.title },
                ...(result.node.metadata
                  ? recordToKVArray(Object.fromEntries(
                      Object.entries(result.node.metadata)
                        .filter(([, value]) => typeof value === "string")
                        .map(([key, value]) => [key, value as string]),
                    ))
                  : []),
              ],
            });
          }

          if (nodeResults.length > 0) return;

          const sourceResults = await sourceRetriever?.searchSourceSpans({
            question: subQuestion.question,
            limit: retrievalLimit,
            mode: retrievalMode,
          }) ?? [];

          for (const result of sourceResults) {
            evidence.push({
              source: "source_span",
              sourceSpanId: result.span.id,
              chunkId: result.span.chunkId,
              documentId: result.span.documentId,
              text: result.span.text,
              relevance: result.relevance,
              retrievalMode,
              sourceLocation: result.span.location,
              metadata: result.span.metadata ? recordToKVArray(result.span.metadata) : undefined,
            });
          }
        } catch (e) {
          await log?.(`Source tree search failed for "${subQuestion.question}": ${e}`);
        }
      })(),
    );
  }

  if (retrievalMode === "graph_only" || retrievalMode === "hybrid" || !sourceRetriever) {
    tasks.push(
    (async () => {
      try {
        const filter: ChunkFilter = {};
        if (subQuestion.chunkTypes?.length) {
          // Search for each chunk type separately and merge
          const chunkResults = await Promise.all(
            subQuestion.chunkTypes.map((type) =>
              memoryStore.search(subQuestion.question, {
                limit: Math.ceil(retrievalLimit / subQuestion.chunkTypes!.length),
                filter: { ...filter, type: type as ChunkFilter["type"] },
              }),
            ),
          );
          for (const chunks of chunkResults) {
            for (const chunk of chunks) {
              evidence.push({
                source: "chunk",
                chunkId: chunk.id,
                documentId: chunk.documentId,
                text: chunk.text,
                relevance: 0.8, // Default — store doesn't expose scores directly
                retrievalMode,
                metadata: recordToKVArray(chunk.metadata),
              });
            }
          }
        } else {
          const chunks = await memoryStore.search(subQuestion.question, {
            limit: retrievalLimit,
          });
          for (const chunk of chunks) {
            evidence.push({
              source: "chunk",
              chunkId: chunk.id,
              documentId: chunk.documentId,
              text: chunk.text,
              relevance: 0.8,
              retrievalMode,
              metadata: recordToKVArray(chunk.metadata),
            });
          }
        }
      } catch (e) {
        await log?.(`Chunk search failed for "${subQuestion.question}": ${e}`);
      }
    })(),
    );
  }

  // Structured document lookup
  if (subQuestion.documentFilters && (retrievalMode === "graph_only" || retrievalMode === "hybrid" || retrievalMode === "long_context")) {
    tasks.push(
      (async () => {
        try {
          const filters: DocumentFilters = {};
          if (subQuestion.documentFilters?.type) filters.type = subQuestion.documentFilters.type;
          if (subQuestion.documentFilters?.carrier) filters.carrier = subQuestion.documentFilters.carrier;
          if (subQuestion.documentFilters?.insuredName) filters.insuredName = subQuestion.documentFilters.insuredName;
          if (subQuestion.documentFilters?.policyNumber) filters.policyNumber = subQuestion.documentFilters.policyNumber;
          if (subQuestion.documentFilters?.quoteNumber) filters.quoteNumber = subQuestion.documentFilters.quoteNumber;

          const docs = await documentStore.query(filters);
          for (const doc of docs) {
            // Build a text summary of the document for reasoning
            const summary = buildDocumentSummary(doc);
            evidence.push({
              source: "document",
              documentId: doc.id,
              text: summary,
              relevance: 0.9, // Direct lookup is high relevance
              retrievalMode,
              metadata: [
                { key: "type", value: doc.type },
                { key: "carrier", value: doc.carrier ?? "" },
                { key: "insuredName", value: doc.insuredName ?? "" },
              ],
            });
          }
        } catch (e) {
          await log?.(`Document lookup failed: ${e}`);
        }
      })(),
    );
  }

  // Conversation history
  if (conversationId) {
    tasks.push(
      (async () => {
        try {
          const turns = await memoryStore.searchHistory(
            subQuestion.question,
            conversationId,
          );
          for (const turn of turns.slice(0, 5)) {
            evidence.push({
              source: "conversation",
              turnId: turn.id,
              text: `[${turn.role}]: ${turn.content}`,
              relevance: 0.6, // Conversation context is lower relevance than documents
              retrievalMode,
            });
          }
        } catch (e) {
          await log?.(`Conversation history search failed: ${e}`);
        }
      })(),
    );
  }

  await Promise.all(tasks);

  // Sort by relevance descending with stable source-aware tie-breaks, then limit total evidence.
  const orderedEvidence = orderSourceEvidence(evidence);

  return {
    subQuestion: subQuestion.question,
    evidence: orderedEvidence.slice(0, retrievalLimit),
  };
}

/**
 * Build a concise text summary of a document for use as evidence.
 */
function buildDocumentSummary(doc: Record<string, unknown>): string {
  const parts: string[] = [];
  const type = doc.type as string;
  parts.push(`Document type: ${type}`);

  if (doc.carrier) parts.push(`Carrier: ${doc.carrier}`);
  if (doc.insuredName) parts.push(`Insured: ${doc.insuredName}`);

  if (type === "policy") {
    if (doc.policyNumber) parts.push(`Policy #: ${doc.policyNumber}`);
    if (doc.effectiveDate) parts.push(`Effective: ${doc.effectiveDate}`);
    if (doc.expirationDate) parts.push(`Expiration: ${doc.expirationDate}`);
  } else if (type === "quote") {
    if (doc.quoteNumber) parts.push(`Quote #: ${doc.quoteNumber}`);
    if (doc.proposedEffectiveDate) parts.push(`Proposed effective: ${doc.proposedEffectiveDate}`);
  }

  if (doc.premium) parts.push(`Premium: ${doc.premium}`);

  const coverages = doc.coverages as Array<Record<string, unknown>> | undefined;
  if (coverages?.length) {
    parts.push(`Coverages (${coverages.length}):`);
    for (const cov of coverages.slice(0, 10)) {
      const line = [cov.name, cov.limit ? `Limit: ${cov.limit}` : null, cov.deductible ? `Ded: ${cov.deductible}` : null]
        .filter(Boolean)
        .join(" | ");
      parts.push(`  - ${line}`);
    }
  }

  return parts.join("\n");
}
