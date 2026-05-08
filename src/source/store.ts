import type { SourceRetriever, SourceRetrievalQuery, SourceRetrievalResult } from "./retrieval";
import type { SourceChunk, SourceSpan } from "./schemas";
import { orderSourceEvidence } from "./retrieval";

export interface SourceStore extends SourceRetriever {
  addSourceSpans(spans: SourceSpan[]): Promise<void>;
  addSourceChunks(chunks: SourceChunk[]): Promise<void>;
  getSourceSpan(id: string): Promise<SourceSpan | null>;
  getSourceSpansByDocument(documentId: string): Promise<SourceSpan[]>;
  getSourceChunksByDocument(documentId: string): Promise<SourceChunk[]>;
  deleteDocumentSource(documentId: string): Promise<void>;
}

export class MemorySourceStore implements SourceStore {
  private readonly spans = new Map<string, SourceSpan>();
  private readonly chunks = new Map<string, SourceChunk>();

  async addSourceSpans(spans: SourceSpan[]): Promise<void> {
    for (const span of spans) {
      this.spans.set(span.id, span);
    }
  }

  async addSourceChunks(chunks: SourceChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
    }
  }

  async getSourceSpan(id: string): Promise<SourceSpan | null> {
    return this.spans.get(id) ?? null;
  }

  async getSourceSpansByDocument(documentId: string): Promise<SourceSpan[]> {
    return [...this.spans.values()]
      .filter((span) => span.documentId === documentId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async getSourceChunksByDocument(documentId: string): Promise<SourceChunk[]> {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.documentId === documentId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async deleteDocumentSource(documentId: string): Promise<void> {
    for (const [id, span] of this.spans.entries()) {
      if (span.documentId === documentId) this.spans.delete(id);
    }
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.documentId === documentId) this.chunks.delete(id);
    }
  }

  async searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]> {
    const terms = tokenize(query.question);
    const documentFilter = new Set(query.documentIds ?? []);
    const chunkFilter = new Set(query.chunkIds ?? []);
    const limit = query.limit ?? 10;

    const results = [...this.spans.values()]
      .filter((span) => documentFilter.size === 0 || documentFilter.has(span.documentId))
      .filter((span) => chunkFilter.size === 0 || (span.chunkId ? chunkFilter.has(span.chunkId) : false))
      .filter((span) => matchesFilters(span, query.filters))
      .map((span) => ({
        span,
        relevance: lexicalRelevance(span.text, terms),
      }))
      .filter((result) => result.relevance > 0);

    return orderSourceEvidence(results.map((result) => ({
      ...result,
      sourceSpanId: result.span.id,
      documentId: result.span.documentId,
      chunkId: result.span.chunkId,
      text: result.span.text,
    }))).map(({ span, relevance }) => ({ span, relevance })).slice(0, limit);
  }
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9$.,%-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  ));
}

function lexicalRelevance(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const normalized = text.toLowerCase();
  const matches = terms.filter((term) => normalized.includes(term)).length;
  if (matches === 0) return 0;
  return Math.min(1, matches / terms.length);
}

function matchesFilters(span: SourceSpan, filters: Record<string, string> | undefined): boolean {
  if (!filters) return true;
  for (const [key, value] of Object.entries(filters)) {
    if (span.metadata?.[key] === value) continue;
    if (key === "sourceKind" && span.sourceKind === value) continue;
    if (key === "formNumber" && span.formNumber === value) continue;
    if (key === "sectionId" && span.sectionId === value) continue;
    return false;
  }
  return true;
}
