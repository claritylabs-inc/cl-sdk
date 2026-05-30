import type Database from "better-sqlite3";
import type { EmbedText } from "../../core/types";
import type {
  SourceChunk,
  SourceRetrievalQuery,
  SourceRetrievalResult,
  SourceSpan,
  SourceStore,
} from "../../source";
import { orderSourceEvidence } from "../../source";
import { pLimit } from "../../core/concurrency";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
}

function embeddingToBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float64Array(embedding).buffer);
}

function bufferToEmbedding(buffer: Buffer): number[] {
  return Array.from(new Float64Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 8));
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToSourceSpan(row: Record<string, unknown>): SourceSpan {
  const metadata = parseJson(row.metadata as string | undefined, {});
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    sourceKind: (row.source_kind ?? undefined) as SourceSpan["sourceKind"],
    chunkId: (row.chunk_id ?? undefined) as string | undefined,
    kind: row.kind as SourceSpan["kind"],
    text: row.text as string,
    hash: row.hash as string,
    textHash: (row.text_hash ?? undefined) as string | undefined,
    pageStart: (row.page_start ?? undefined) as number | undefined,
    pageEnd: (row.page_end ?? undefined) as number | undefined,
    sectionId: (row.section_id ?? undefined) as string | undefined,
    formNumber: (row.form_number ?? undefined) as string | undefined,
    sourceUnit: (row.source_unit ?? undefined) as SourceSpan["sourceUnit"],
    parentSpanId: (row.parent_span_id ?? undefined) as string | undefined,
    table: parseJson(row.table_location as string | undefined, undefined),
    location: parseJson(row.location as string | undefined, undefined),
    bbox: parseJson(row.bbox as string | undefined, undefined),
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

function rowToSourceChunk(row: Record<string, unknown>): SourceChunk {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    sourceSpanIds: parseJson(row.source_span_ids as string | undefined, []),
    text: row.text as string,
    textHash: row.text_hash as string,
    pageStart: row.page_start as number | undefined,
    pageEnd: row.page_end as number | undefined,
    metadata: parseJson(row.metadata as string | undefined, {}),
  };
}

export function createSqliteSourceStore(db: Database.Database, embed: EmbedText): SourceStore {
  const limit = pLimit(4);

  return {
    async addSourceSpans(spans: SourceSpan[]): Promise<void> {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO source_spans (
          id, document_id, source_kind, chunk_id, kind, text, hash, text_hash,
          page_start, page_end, section_id, form_number, source_unit, parent_span_id,
          table_location, location, bbox, metadata, embedding
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMany = db.transaction((items: SourceSpan[]) => {
        for (const span of items) {
          stmt.run(
            span.id,
            span.documentId,
            span.sourceKind ?? null,
            span.chunkId ?? null,
            span.kind,
            span.text,
            span.hash,
            span.textHash ?? null,
            span.pageStart ?? null,
            span.pageEnd ?? null,
            span.sectionId ?? null,
            span.formNumber ?? null,
            span.sourceUnit ?? null,
            span.parentSpanId ?? null,
            span.table ? JSON.stringify(span.table) : null,
            span.location ? JSON.stringify(span.location) : null,
            span.bbox ? JSON.stringify(span.bbox) : null,
            JSON.stringify(span.metadata ?? {}),
            null,
          );
        }
      });
      insertMany(spans);

      await Promise.all(spans.map((span) =>
        limit(async () => {
          try {
            const embedding = await embed(span.text);
            db.prepare("UPDATE source_spans SET embedding = ? WHERE id = ?").run(embeddingToBuffer(embedding), span.id);
          } catch {
            // Embedding failure is non-fatal; span text remains persisted.
          }
        }),
      ));
    },

    async addSourceChunks(chunks: SourceChunk[]): Promise<void> {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO source_chunks (
          id, document_id, source_span_ids, text, text_hash, page_start, page_end, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMany = db.transaction((items: SourceChunk[]) => {
        for (const chunk of items) {
          stmt.run(
            chunk.id,
            chunk.documentId,
            JSON.stringify(chunk.sourceSpanIds),
            chunk.text,
            chunk.textHash,
            chunk.pageStart ?? null,
            chunk.pageEnd ?? null,
            JSON.stringify(chunk.metadata ?? {}),
          );
        }
      });
      insertMany(chunks);
    },

    async getSourceSpan(id: string): Promise<SourceSpan | null> {
      const row = db.prepare("SELECT * FROM source_spans WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return row ? rowToSourceSpan(row) : null;
    },

    async getSourceSpansByDocument(documentId: string): Promise<SourceSpan[]> {
      const rows = db.prepare("SELECT * FROM source_spans WHERE document_id = ? ORDER BY id ASC").all(documentId) as Array<Record<string, unknown>>;
      return rows.map(rowToSourceSpan);
    },

    async getSourceChunksByDocument(documentId: string): Promise<SourceChunk[]> {
      const rows = db.prepare("SELECT * FROM source_chunks WHERE document_id = ? ORDER BY id ASC").all(documentId) as Array<Record<string, unknown>>;
      return rows.map(rowToSourceChunk);
    },

    async deleteDocumentSource(documentId: string): Promise<void> {
      db.prepare("DELETE FROM source_chunks WHERE document_id = ?").run(documentId);
      db.prepare("DELETE FROM source_spans WHERE document_id = ?").run(documentId);
    },

    async searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]> {
      const queryEmbedding = await embed(query.question);
      const resultLimit = query.limit ?? 10;
      let sql = "SELECT * FROM source_spans WHERE embedding IS NOT NULL";
      const params: unknown[] = [];

      if (query.documentIds?.length) {
        sql += ` AND document_id IN (${query.documentIds.map(() => "?").join(",")})`;
        params.push(...query.documentIds);
      }
      if (query.chunkIds?.length) {
        sql += ` AND chunk_id IN (${query.chunkIds.map(() => "?").join(",")})`;
        params.push(...query.chunkIds);
      }
      if (query.filters?.sourceKind) {
        sql += " AND source_kind = ?";
        params.push(query.filters.sourceKind);
      }
      if (query.filters?.formNumber) {
        sql += " AND form_number = ?";
        params.push(query.filters.formNumber);
      }
      if (query.filters?.sectionId) {
        sql += " AND section_id = ?";
        params.push(query.filters.sectionId);
      }

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const scored = rows.map((row) => {
        const span = rowToSourceSpan(row);
        return {
          span,
          relevance: cosineSimilarity(queryEmbedding, bufferToEmbedding(row.embedding as Buffer)),
        };
      });

      return orderSourceEvidence(scored.map((result) => ({
        ...result,
        sourceSpanId: result.span.id,
        chunkId: result.span.chunkId,
        documentId: result.span.documentId,
        text: result.span.text,
      }))).map(({ span, relevance }) => ({ span, relevance })).slice(0, resultLimit);
    },
  };
}
