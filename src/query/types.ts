import type { GenerateText, GenerateObject, TokenUsage, LogFn } from "../core/types";
import type { DocumentStore, MemoryStore } from "../storage/interfaces";
import type { AgentContext } from "../schemas/platform";
import type { QueryResult, Citation, QueryIntent } from "../schemas/query";

export interface QueryConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;
  documentStore: DocumentStore;
  memoryStore: MemoryStore;
  concurrency?: number;
  maxVerifyRounds?: number;
  retrievalLimit?: number;
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
}

export interface QueryInput {
  question: string;
  conversationId?: string;
  context?: AgentContext;
}

export interface QueryOutput extends QueryResult {
  tokenUsage: TokenUsage;
}

export type { QueryResult, Citation, QueryIntent };
