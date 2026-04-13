// src/storage/chunk-types.ts

export interface DocumentChunk {
  /** Deterministic ID: `${documentId}:${type}:${index}` */
  id: string;
  /** Source document ID */
  documentId: string;
  /** Chunk type for filtering */
  type: "carrier_info" | "named_insured" | "coverage" | "endorsement" | "exclusion" | "condition" | "section" | "declaration" | "loss_history" | "premium" | "supplementary" | "location" | "vehicle" | "classification" | "financial" | "party" | "subjectivity" | "underwriting_condition";
  /** Human-readable text for embedding */
  text: string;
  /** Structured metadata for filtering */
  metadata: Record<string, string>;
}

export interface ConversationTurn {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolResult?: string;
  timestamp: number;
}

export interface ChunkFilter {
  documentId?: string;
  type?: DocumentChunk["type"];
  metadata?: Record<string, string>;
}

export interface DocumentFilters {
  type?: "policy" | "quote";
  carrier?: string;
  insuredName?: string;
  policyNumber?: string;
  quoteNumber?: string;
}
