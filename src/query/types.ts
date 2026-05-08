import type { GenerateText, GenerateObject, TokenUsage, LogFn } from "../core/types";
import type { QualityGateMode } from "../core/quality";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import type { DocumentStore, MemoryStore } from "../storage/interfaces";
import type { AgentContext } from "../schemas/platform";
import type { QueryResult, Citation, QueryIntent, QueryAttachment, QueryRetrievalMode } from "../schemas/query";
import type { QueryReviewReport } from "./quality";
import type { SourceRetriever } from "../source";

export interface QueryConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;
  documentStore: DocumentStore;
  memoryStore: MemoryStore;
  sourceRetriever?: SourceRetriever;
  concurrency?: number;
  maxVerifyRounds?: number;
  retrievalLimit?: number;
  retrievalMode?: QueryRetrievalMode;
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
  qualityGate?: QualityGateMode;
  modelCapabilities?: ModelCapabilities;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
}

export interface QueryInput {
  question: string;
  conversationId?: string;
  context?: AgentContext;
  attachments?: QueryAttachment[];
  retrievalMode?: QueryRetrievalMode;
}

export interface QueryOutput extends QueryResult {
  tokenUsage: TokenUsage;
  reviewReport: QueryReviewReport;
}

export type { QueryResult, Citation, QueryIntent, QueryAttachment, QueryRetrievalMode };
