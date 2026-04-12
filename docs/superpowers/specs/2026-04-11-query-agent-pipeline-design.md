# Query Agent Pipeline Design

## Summary

A coordinator/worker query answering system for CL-SDK that mirrors the extraction pipeline pattern. Small focused agents handle classification, retrieval, reasoning, and verification — running in parallel where possible, with a controlling verifier that checks results for grounding and accuracy.

## Motivation

CL-SDK has a robust extraction pipeline (`createExtractor`) but no standardized way to answer questions against extracted documents. End products (Prism, Spot) need reliable, citation-backed answers from stored policies and quotes. The query pipeline provides this with the same architectural guarantees as extraction: provider-agnostic callbacks, parallel agent dispatch, iterative verification, and Zod-validated outputs.

## Entry Point

```typescript
import { createQueryAgent } from "@claritylabs/cl-sdk";

const agent = createQueryAgent({
  // Required: LLM callbacks (same as extraction)
  generateText,
  generateObject,

  // Required: storage backends
  documentStore,
  memoryStore,

  // Optional: tuning
  concurrency: 3,        // max parallel retrievers/reasoners (default: 3)
  maxVerifyRounds: 1,    // verification loop iterations (default: 1)
  retrievalLimit: 10,    // max chunks per retrieval query (default: 10)

  // Optional: observability
  onTokenUsage?: (usage) => void,
  onProgress?: (message) => void,
  log?: LogFn,
  providerOptions?: Record<string, unknown>,
});

const result = await agent.query({
  question: "What is the deductible on our GL policy?",
  conversationId: "conv-123",     // for conversation history
  context?: AgentContext,          // platform, intent, user/company
});
```

## Pipeline Phases

### Phase 1: Classify

The classifier agent analyzes the question and produces:
- **Intent** — one of: `policy_question`, `coverage_comparison`, `document_search`, `claims_inquiry`, `general_knowledge`
- **Sub-questions** — atomic questions that can each be independently retrieved + answered. A simple question produces one sub-question; a complex question (e.g., "compare the deductibles on my GL and auto policies") decomposes into multiple.
- **Required stores** — which storage backends to query (document store, memory store chunks, conversation history)

Uses `generateObject` with `QueryClassifyResultSchema`.

### Phase 2: Retrieve (parallel)

For each sub-question, a retriever agent runs in parallel (concurrency-limited):

1. **Chunk search** — `memoryStore.search(subQuestion, { limit: retrievalLimit, filter })` — semantic search over document chunks
2. **Document lookup** — `documentStore.query(filters)` — structured lookup when the classifier identifies specific documents (by carrier, policy number, etc.)
3. **Conversation history** — `memoryStore.searchHistory(subQuestion, conversationId)` — prior conversation context

Each retriever returns a `RetrievalResult`: an array of `EvidenceItem` objects, each with the source chunk/document, relevance score, and a text excerpt.

### Phase 3: Reason (parallel)

For each sub-question + its retrieved evidence, a reasoner agent runs in parallel:

1. Receives the sub-question and its evidence items only (not the full document — forces grounding)
2. Produces a `SubAnswer` with:
   - `answer` — text answer to the sub-question
   - `citations` — array of `Citation` referencing specific evidence items
   - `confidence` — 0-1 score
   - `needsMoreContext` — boolean flag if evidence was insufficient

Uses intent-specific reasoning prompts (e.g., coverage questions get a prompt tuned for interpreting limits/deductibles/endorsements).

### Phase 4: Verify

The verifier agent checks all sub-answers:

1. **Grounding check** — every claim in each sub-answer must reference a citation. Ungrounded claims are flagged.
2. **Consistency check** — sub-answers shouldn't contradict each other.
3. **Completeness check** — did all sub-questions get adequate answers?

If issues are found and `maxVerifyRounds` hasn't been reached, the verifier can:
- Request additional retrieval for low-confidence sub-answers
- Request re-reasoning with expanded context
- Flag contradictions for the responder to address

### Phase 5: Respond

The responder agent merges verified sub-answers into a final response:

1. Compose a natural-language answer addressing the original question
2. Embed inline citations (e.g., `[1]`, `[2]`) referencing source documents
3. Generate a `followUp` suggestion if the question naturally leads to more
4. Store the exchange as a `ConversationTurn` in the memory store

## Types

### QueryConfig

```typescript
interface QueryConfig {
  generateText: GenerateText;
  generateObject: GenerateObject;
  documentStore: DocumentStore;
  memoryStore: MemoryStore;
  concurrency?: number;           // default: 3
  maxVerifyRounds?: number;       // default: 1
  retrievalLimit?: number;        // default: 10
  onTokenUsage?: (usage: TokenUsage) => void;
  onProgress?: (message: string) => void;
  log?: LogFn;
  providerOptions?: Record<string, unknown>;
}
```

### QueryInput

```typescript
interface QueryInput {
  question: string;
  conversationId?: string;
  context?: AgentContext;
}
```

### QueryResult

```typescript
interface QueryResult {
  answer: string;
  citations: Citation[];
  intent: QueryIntent;
  confidence: number;
  followUp?: string;
  tokenUsage: TokenUsage;
}
```

### Citation

```typescript
interface Citation {
  index: number;            // [1], [2], etc.
  chunkId: string;          // e.g. "doc-123:coverage:2"
  documentId: string;
  documentType: "policy" | "quote";
  field?: string;           // e.g. "coverages[0].deductible"
  quote: string;            // exact text from source chunk
  relevance: number;        // 0-1 similarity score
}
```

### QueryIntent

```typescript
type QueryIntent =
  | "policy_question"
  | "coverage_comparison"
  | "document_search"
  | "claims_inquiry"
  | "general_knowledge";
```

### Internal Types

```typescript
interface SubQuestion {
  question: string;
  intent: QueryIntent;
  filters?: ChunkFilter;           // from classifier
  documentFilters?: DocumentFilters; // from classifier
}

interface EvidenceItem {
  source: "chunk" | "document" | "conversation";
  chunkId?: string;
  documentId?: string;
  turnId?: string;
  text: string;
  relevance: number;
  metadata?: Record<string, string>;
}

interface RetrievalResult {
  subQuestion: string;
  evidence: EvidenceItem[];
}

interface SubAnswer {
  subQuestion: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  needsMoreContext: boolean;
}

interface VerifyResult {
  approved: boolean;
  issues: string[];
  retrySubQuestions?: string[];
}
```

## File Structure

```
src/
  query/
    coordinator.ts      # createQueryAgent + pipeline orchestration
    retriever.ts        # parallel retrieval from all stores
    reasoner.ts         # evidence-based reasoning per sub-question
    verifier.ts         # grounding + consistency + completeness check
    types.ts            # QueryConfig, QueryResult, Citation, internal types
  prompts/
    query/
      classify.ts       # intent classification + sub-question decomposition
      plan.ts           # retrieval strategy (which stores, what filters)
      reason.ts         # per-intent reasoning prompts
      verify.ts         # grounding verification prompt
      respond.ts        # final answer formatting + citation prompt
  schemas/
    query.ts            # Zod schemas for all query types
```

## Exports

Add to `src/index.ts`:
- `createQueryAgent`
- `QueryConfig`, `QueryInput`, `QueryResult`, `Citation`, `QueryIntent`

## Patterns (matching extraction pipeline)

- **Provider-agnostic**: same `generateText`/`generateObject` callbacks
- **Concurrency-limited parallel dispatch**: `pLimit(concurrency)` for retrievers + reasoners
- **Rate-limit retry**: `withRetry()` wraps all LLM calls
- **Zod schemas**: all inter-agent data validated at boundaries
- **Token tracking**: `onTokenUsage` callback after each LLM call
- **Progress reporting**: `onProgress` at each phase transition
- **Memory accumulation**: sub-answers accumulate in a Map (like extractor memory)
