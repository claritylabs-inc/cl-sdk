import type { GenerateText, GenerateObject, TokenUsage, LogFn } from "../core/types";
import type { QualityGateMode } from "../core/quality";
import type { DocumentStore, MemoryStore } from "../storage/interfaces";
import type { AgentContext } from "../schemas/platform";
import type { QueryResult, Citation, QueryIntent, QueryAttachment } from "../schemas/query";
import type { QueryReviewReport } from "./quality";

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
  qualityGate?: QualityGateMode;
}

export interface QueryInput {
  question: string;
  conversationId?: string;
  context?: AgentContext;
  attachments?: QueryAttachment[];
}

export interface QueryOutput extends QueryResult {
  tokenUsage: TokenUsage;
  reviewReport: QueryReviewReport;
}

export type { QueryResult, Citation, QueryIntent, QueryAttachment };
