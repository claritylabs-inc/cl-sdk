import type { SourceSpan } from "./schemas";

export type SourceRetrievalMode = "graph_only" | "source_rag" | "long_context" | "hybrid";

export interface SourceRetrievalQuery {
  question: string;
  documentIds?: string[];
  chunkIds?: string[];
  limit?: number;
  mode?: SourceRetrievalMode;
  filters?: Record<string, string>;
}

export interface SourceRetrievalResult {
  span: SourceSpan;
  relevance: number;
}

export interface SourceRetriever {
  searchSourceSpans(query: SourceRetrievalQuery): Promise<SourceRetrievalResult[]>;
}

export interface OrderableSourceEvidence {
  source?: string;
  sourceSpanId?: string;
  chunkId?: string;
  documentId?: string;
  turnId?: string;
  attachmentId?: string;
  text: string;
  relevance: number;
}

function evidenceTieBreakId(evidence: OrderableSourceEvidence): string {
  return [
    evidence.source ?? "",
    evidence.sourceSpanId ?? "",
    evidence.chunkId ?? "",
    evidence.documentId ?? "",
    evidence.turnId ?? "",
    evidence.attachmentId ?? "",
    evidence.text,
  ].join("|");
}

export function compareSourceEvidence(a: OrderableSourceEvidence, b: OrderableSourceEvidence): number {
  const relevanceDelta = b.relevance - a.relevance;
  if (relevanceDelta !== 0) return relevanceDelta;
  return evidenceTieBreakId(a).localeCompare(evidenceTieBreakId(b));
}

export function orderSourceEvidence<T extends OrderableSourceEvidence>(evidence: T[]): T[] {
  return [...evidence].sort(compareSourceEvidence);
}
