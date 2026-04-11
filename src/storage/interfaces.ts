import type { InsuranceDocument } from "../schemas/document";
import type { DocumentChunk, ConversationTurn, ChunkFilter, DocumentFilters } from "./chunk-types";

export interface DocumentStore {
  save(doc: InsuranceDocument): Promise<void>;
  get(id: string): Promise<InsuranceDocument | null>;
  query(filters: DocumentFilters): Promise<InsuranceDocument[]>;
  delete(id: string): Promise<void>;
}

export interface MemoryStore {
  addChunks(chunks: DocumentChunk[]): Promise<void>;
  search(query: string, options?: { limit?: number; filter?: ChunkFilter }): Promise<DocumentChunk[]>;
  addTurn(turn: ConversationTurn): Promise<void>;
  getHistory(conversationId: string, options?: { limit?: number }): Promise<ConversationTurn[]>;
  searchHistory(query: string, conversationId?: string): Promise<ConversationTurn[]>;
}
