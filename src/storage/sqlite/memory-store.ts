import type Database from "better-sqlite3";
import type { MemoryStore } from "../interfaces";
import type { DocumentChunk, ConversationTurn, ChunkFilter } from "../chunk-types";
import type { EmbedText } from "../../core/types";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function createSqliteMemoryStore(db: Database.Database, embed: EmbedText): MemoryStore {
  return {
    async addChunks(chunks: DocumentChunk[]): Promise<void> {
      const stmt = db.prepare("INSERT OR REPLACE INTO chunks (id, document_id, type, text, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?)");
      const insertMany = db.transaction((items: DocumentChunk[]) => {
        for (const chunk of items) {
          stmt.run(chunk.id, chunk.documentId, chunk.type, chunk.text, JSON.stringify(chunk.metadata), null);
        }
      });
      insertMany(chunks);

      for (const chunk of chunks) {
        try {
          const embedding = await embed(chunk.text);
          const buf = Buffer.from(new Float64Array(embedding).buffer);
          db.prepare("UPDATE chunks SET embedding = ? WHERE id = ?").run(buf, chunk.id);
        } catch {
          // Embedding failure is non-fatal
        }
      }
    },

    async search(query: string, options?: { limit?: number; filter?: ChunkFilter }): Promise<DocumentChunk[]> {
      const queryEmbedding = await embed(query);
      const resultLimit = options?.limit ?? 10;

      let sql = "SELECT id, document_id, type, text, metadata, embedding FROM chunks WHERE embedding IS NOT NULL";
      const params: unknown[] = [];

      if (options?.filter?.documentId) {
        sql += " AND document_id = ?";
        params.push(options.filter.documentId);
      }
      if (options?.filter?.type) {
        sql += " AND type = ?";
        params.push(options.filter.type);
      }

      const rows = db.prepare(sql).all(...params) as Array<{
        id: string; document_id: string; type: string; text: string; metadata: string; embedding: Buffer;
      }>;

      const scored = rows.map((row) => {
        const stored = Array.from(new Float64Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 8));
        return {
          chunk: {
            id: row.id,
            documentId: row.document_id,
            type: row.type as DocumentChunk["type"],
            text: row.text,
            metadata: JSON.parse(row.metadata),
          },
          score: cosineSimilarity(queryEmbedding, stored),
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, resultLimit).map((s) => s.chunk);
    },

    async addTurn(turn: ConversationTurn): Promise<void> {
      const embedding = await embed(turn.content).catch(() => null);
      const buf = embedding ? Buffer.from(new Float64Array(embedding).buffer) : null;
      db.prepare(
        "INSERT INTO conversation_turns (id, conversation_id, role, content, tool_name, tool_result, timestamp, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(turn.id, turn.conversationId, turn.role, turn.content, turn.toolName ?? null, turn.toolResult ?? null, turn.timestamp, buf);
    },

    async getHistory(conversationId: string, options?: { limit?: number }): Promise<ConversationTurn[]> {
      const resultLimit = options?.limit ?? 50;
      const rows = db.prepare(
        "SELECT id, conversation_id, role, content, tool_name, tool_result, timestamp FROM conversation_turns WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?"
      ).all(conversationId, resultLimit) as Array<Record<string, unknown>>;

      return rows.reverse().map((r) => ({
        id: r.id as string,
        conversationId: r.conversation_id as string,
        role: r.role as ConversationTurn["role"],
        content: r.content as string,
        toolName: r.tool_name as string | undefined,
        toolResult: r.tool_result as string | undefined,
        timestamp: r.timestamp as number,
      }));
    },

    async searchHistory(query: string, conversationId?: string): Promise<ConversationTurn[]> {
      const queryEmbedding = await embed(query);

      let sql = "SELECT id, conversation_id, role, content, tool_name, tool_result, timestamp, embedding FROM conversation_turns WHERE embedding IS NOT NULL";
      const params: unknown[] = [];
      if (conversationId) {
        sql += " AND conversation_id = ?";
        params.push(conversationId);
      }

      const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

      const scored = rows.map((row) => {
        const buf = row.embedding as Buffer;
        const stored = Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
        return {
          turn: {
            id: row.id as string,
            conversationId: row.conversation_id as string,
            role: row.role as ConversationTurn["role"],
            content: row.content as string,
            toolName: row.tool_name as string | undefined,
            toolResult: row.tool_result as string | undefined,
            timestamp: row.timestamp as number,
          },
          score: cosineSimilarity(queryEmbedding, stored),
        };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 10).map((s) => s.turn);
    },
  };
}
