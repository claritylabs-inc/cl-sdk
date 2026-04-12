import type { GenerateText, GenerateObject, TokenUsage, LogFn } from "../core/types";
import type { DocumentStore, MemoryStore } from "../storage/interfaces";
import type { AgentContext } from "../schemas/platform";
import type { ApplicationState, ApplicationField } from "../schemas/application";
import type { ApplicationStore, BackfillProvider } from "./store";

export interface ApplicationPipelineConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;

  /** Persistent application state storage */
  applicationStore?: ApplicationStore;

  /** Document store for policy/quote lookups during auto-fill */
  documentStore?: DocumentStore;

  /** Memory store for vector-based answer backfill */
  memoryStore?: MemoryStore;

  /** Custom backfill provider (overrides default memoryStore-based backfill) */
  backfillProvider?: BackfillProvider;

  /** Business context key-value pairs for auto-fill */
  orgContext?: { key: string; value: string; category: string }[];

  /** Max parallel agents for field extraction and auto-fill (default: 4) */
  concurrency?: number;

  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
}

export interface ProcessApplicationInput {
  /** Base64-encoded application PDF */
  pdfBase64: string;
  /** Application ID (auto-generated if not provided) */
  applicationId?: string;
  /** Agent context for email formatting */
  context?: AgentContext;
}

export interface ProcessApplicationResult {
  /** Current application state */
  state: ApplicationState;
  /** Token usage across all agent calls */
  tokenUsage: TokenUsage;
}

export interface ProcessReplyInput {
  /** Application ID */
  applicationId: string;
  /** User's email/message reply text */
  replyText: string;
  /** Agent context for response formatting */
  context?: AgentContext;
}

export interface ProcessReplyResult {
  /** Updated application state */
  state: ApplicationState;
  /** What the reply contained */
  intent: "answers_only" | "question" | "lookup_request" | "mixed";
  /** Number of fields filled from this reply */
  fieldsFilled: number;
  /** Response text (email body, explanation, etc.) */
  responseText?: string;
  /** Token usage */
  tokenUsage: TokenUsage;
}

export type { ApplicationState, ApplicationField };
