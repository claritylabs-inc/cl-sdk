import type { GenerateText, GenerateObject, TokenUsage, LogFn } from "../core/types";
import type { QualityGateMode } from "../core/quality";
import type { ModelBudgetConstraint, ModelCapabilities, ModelTaskKind } from "../core/model-budget";
import type { DocumentStore, MemoryStore } from "../storage/interfaces";
import type { AgentContext } from "../schemas/platform";
import type {
  ApplicationContextProposal,
  ApplicationPacket,
  ApplicationQuestionGraph,
  ApplicationState,
  ApplicationField,
  ApplicationTemplate,
} from "../schemas/application";
import type { ApplicationStore, ApplicationTemplateStore, BackfillProvider } from "./store";
import type { ApplicationQualityReport } from "./quality";
import type { SourceSpan } from "../source";

export interface ApplicationPipelineConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;

  /** Persistent application state storage */
  applicationStore?: ApplicationStore;

  /** Optional template store for broker/carrier application libraries */
  templateStore?: ApplicationTemplateStore;

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
  qualityGate?: QualityGateMode;
  modelCapabilities?: ModelCapabilities;
  modelBudgetConstraints?: Partial<Record<ModelTaskKind, ModelBudgetConstraint>>;
}

export interface ProcessApplicationInput {
  /** Base64-encoded application PDF */
  pdfBase64: string;
  /** Optional caller-extracted application source spans for page/field grounding */
  sourceSpans?: SourceSpan[];
  /** Application ID (auto-generated if not provided) */
  applicationId?: string;
  /** Template metadata to pin on the application run */
  template?: ApplicationTemplate;
  /** Caller-supplied graph when the template was extracted or authored upstream */
  questionGraph?: ApplicationQuestionGraph;
  /** Agent context for email formatting */
  context?: AgentContext;
}

export interface ProcessApplicationResult {
  /** Current application state */
  state: ApplicationState;
  /** Token usage across all agent calls */
  tokenUsage: TokenUsage;
  reviewReport: ApplicationQualityReport;
}

export interface ProcessReplyInput {
  /** Application ID */
  applicationId: string;
  /** User's email/message reply text */
  replyText: string;
  /** Stable caller-provided source span IDs for the reply message or attachments */
  replySourceSpanIds?: string[];
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
  reviewReport: ApplicationQualityReport;
}

export interface CreateApplicationRunInput {
  applicationId: string;
  template: ApplicationTemplate;
  now?: number;
}

export interface ApplicationNextQuestions {
  status: "complete" | "needs_answers";
  fieldIds: string[];
  fields: ApplicationField[];
}

export interface BuildApplicationPacketInput {
  applicationId: string;
  submissionNotes?: string;
  now?: number;
}

export interface BuildApplicationPacketResult {
  packet: ApplicationPacket;
  reviewReport: ApplicationQualityReport;
}

export interface ContextProposalResult {
  proposals: ApplicationContextProposal[];
}

export type {
  ApplicationContextProposal,
  ApplicationPacket,
  ApplicationQuestionGraph,
  ApplicationState,
  ApplicationField,
  ApplicationTemplate,
};
