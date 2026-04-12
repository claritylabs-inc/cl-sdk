# CL-SDK v6 — Agentic Extraction Architecture

**Date:** 2026-04-11
**Status:** Approved
**Breaking:** Yes — new major version, clean break from v5

## Core Principles

1. **Zero AI SDK dependency** — consumers pass simple callback functions, not `LanguageModel` instances
2. **Agentic extraction** — coordinator + focused extractors with shared memory, not fixed passes
3. **Schema-first data contracts** — Zod schemas define the canonical document structure, chunking strategy, and query interface
4. **Thin storage abstraction** — `DocumentStore` + `MemoryStore` interfaces with one reference SQLite implementation
5. **Simplicity** — no single file over ~300 lines, logical folder structure, minimal duplication

---

## 1. Provider Abstraction

Remove `ai` (Vercel AI SDK) as a peer dependency entirely. Replace with simple callback types:

```ts
type GenerateText = (params: {
  prompt: string;
  system?: string;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}>;

type GenerateObject<T> = (params: {
  prompt: string;
  system?: string;
  schema: ZodSchema<T>;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{
  object: T;
  usage?: { inputTokens: number; outputTokens: number };
}>;

type EmbedText = (text: string) => Promise<number[]>;
```

No adapter shipped. README documents how consumers wire up their provider (AI SDK, raw HTTP, LangChain, etc.).

---

## 2. Agentic Extraction Pipeline

### Architecture

The fixed 4-pass pipeline (`classify → metadata → sections → enrichment`) is replaced by a coordinator/worker architecture.

### Coordinator

A small, fast model that:

1. Reads the first few pages to classify the document (policy vs quote, what type)
2. Loads a **document-type template** as hints for what to expect
3. Scans the full document to build a page map ("declarations on pages 1-3, endorsements on pages 14-20")
4. Dispatches focused extractors in parallel based on what it finds
5. After each batch completes, checks shared memory for gaps ("missing premium breakdown, no loss history yet")
6. Dispatches follow-up extractors as needed
7. Stops when the template is satisfied or the document is exhausted

### Extractors

Small, focused workers. Each:

- Has a tiny prompt (~10-20 lines) and a Zod output schema
- Receives only the relevant pages (not the whole document)
- Writes results to shared memory (in-memory Map during extraction)
- Results validated against Zod schemas as they arrive

Examples: `extract_carrier_info`, `extract_coverage_limits`, `extract_endorsements`, `extract_named_insured`, `extract_premium_breakdown`, `extract_declarations`, `extract_loss_history`

### Document-Type Templates

Shipped with the SDK, one per policy type. Hybrid approach — templates provide hints but the coordinator can deviate if the actual document doesn't match.

```ts
const HOMEOWNERS_TEMPLATE = {
  type: "homeowners",
  expectedSections: ["carrier_info", "named_insured", "coverages", "deductibles", "endorsements", ...],
  pageHints: { declarations: "first 3 pages", endorsements: "last 20%" },
  required: ["carrier_info", "named_insured", "coverages"],
  optional: ["loss_history", "regulatory_context"],
};
```

### Extraction Flow

```
Coordinator reads page 1-3 → "This is a homeowners policy"
  → Loads homeowners template
  → Scans full doc, builds page map
  → Dispatches in parallel:
    - extract_carrier_info (pages 1-2)
    - extract_named_insured (pages 1-2)
    - extract_coverage_limits (pages 3-5)
    - extract_premium (pages 2-4)
  → All write to shared memory
  → Coordinator checks: "Missing endorsements, no loss history found yet"
  → Dispatches:
    - extract_endorsements (pages 12-18)
    - extract_loss_history (pages 8-10)
  → Coordinator: "Document fully extracted"
  → Assemble shared memory into validated PolicyDocument
```

### Shared Memory During Extraction

In-memory store (Map or plain object) — not the persistent `MemoryStore`. Extractors write partial results keyed by extraction type. The coordinator reads this to decide what's missing. At the end, results are assembled and validated into the final document.

---

## 3. Data Contracts — Zod Schemas + Chunking

### Schemas

Every type currently defined as a TypeScript interface gets a corresponding Zod schema. Types are **derived** from schemas, not the other way around:

```ts
export const CoverageSchema = z.object({
  name: z.string(),
  limit: z.string().optional(),
  deductible: z.string().optional(),
  // ...
});
export type Coverage = z.infer<typeof CoverageSchema>;
```

This gives consumers validation, serialization, and type generation from a single source of truth.

### Chunking

The SDK exports a `chunkDocument()` function that breaks a validated document into retrieval-friendly units:

```ts
const chunks = chunkDocument(policyDocument);
// Returns:
// [
//   { id: "policy-123:carrier", type: "carrier_info", text: "...", metadata: { carrier, policyType } },
//   { id: "policy-123:coverage:gl", type: "coverage", text: "...", metadata: { coverageName, limit } },
//   { id: "policy-123:endorsement:0", type: "endorsement", text: "...", metadata: { endorsementType } },
//   ...
// ]
```

Each chunk has:
- A deterministic ID
- A type tag
- A text representation (for embedding)
- Structured metadata (for filtering)

The SDK defines chunking rules per document section. Consumers pass chunks to whatever vector store they use.

---

## 4. Storage Abstraction + Memory

### Interfaces

```ts
interface DocumentStore {
  save(doc: PolicyDocument | QuoteDocument): Promise<void>;
  get(id: string): Promise<InsuranceDocument | null>;
  query(filters: DocumentFilters): Promise<InsuranceDocument[]>;
  delete(id: string): Promise<void>;
}

interface MemoryStore {
  // Vector/semantic
  addChunks(chunks: DocumentChunk[]): Promise<void>;
  search(query: string, options?: { limit?: number; filter?: ChunkFilter }): Promise<DocumentChunk[]>;

  // Conversation memory
  addTurn(turn: ConversationTurn): Promise<void>;
  getHistory(conversationId: string, options?: { limit?: number }): Promise<ConversationTurn[]>;
  searchHistory(query: string, conversationId?: string): Promise<ConversationTurn[]>;
}
```

### Reference Implementation

One SQLite-based implementation covering both interfaces:
- SQLite JSON support for structured document queries
- Cosine similarity on stored embedding vectors for semantic search
- Consumers provide their own `EmbedText` callback (same pattern as model callbacks)

### Flow

```
Extract PDF → validated document (Zod)
           → documentStore.save(doc)
           → chunkDocument(doc) → memoryStore.addChunks(chunks)

Agent needs info → memoryStore.search("liability coverage limits")
                → documentStore.get(chunkResult.metadata.documentId)
```

### Conversation Memory

Separate from document memory but queryable through the same `MemoryStore`. A turn includes: what the user asked, what tools were called, what was returned, what the agent decided. Accumulates across conversations for long-term recall.

---

## 5. Prompt Architecture

### Current State

A few large prompt strings (120+ lines each) that try to do everything in one shot.

### New Approach

Each extractor gets a small, focused prompt paired with its Zod output schema. Prompts live in individual files organized by what they extract.

Each extractor file exports a prompt builder and a Zod schema:

```ts
// src/prompts/extractors/carrier-info.ts
export const carrierInfoSchema = z.object({
  carrierName: z.string(),
  carrierLegalName: z.string().optional(),
  naicNumber: z.string().optional(),
  amBestRating: z.string().optional(),
  admittedStatus: AdmittedStatusSchema.optional(),
});

export function buildCarrierInfoPrompt(): string {
  return `Extract the insurance carrier information from these pages. ...`;
}
```

Coordinator prompts are also small — they don't need to know extraction details, just how to read a document and decide what to extract next.

---

## 6. File Structure

```
src/
  core/
    types.ts               # GenerateText, GenerateObject, EmbedText callback types
    retry.ts               # withRetry (rate limit backoff)
    concurrency.ts         # pLimit utility
    strip-fences.ts        # stripFences utility
    sanitize.ts            # sanitizeNulls utility

  schemas/
    document.ts            # PolicyDocument, QuoteDocument Zod schemas
    coverage.ts            # Coverage, EnrichedCoverage
    endorsement.ts         # Endorsement, EndorsementParty
    declarations/
      index.ts             # Discriminated union
      shared.ts            # DwellingDetails, DriverRecord, etc.
      personal.ts          # 14 personal line schemas
      commercial.ts        # 9 commercial line schemas
    enums.ts               # All enums as Zod enums
    shared.ts              # Address, Contact, etc.
    financial.ts           # PaymentPlan, etc.
    parties.ts             # InsurerInfo, ProducerInfo
    platform.ts            # Platform, AgentContext
    condition.ts           # PolicyCondition
    exclusion.ts           # Exclusion
    loss-history.ts        # LossSummary, ClaimRecord, ExperienceMod
    underwriting.ts        # Subjectivity, Condition enrichment
    context-keys.ts        # Policy field → context key mapping

  extraction/
    coordinator.ts         # Agentic loop: classify → plan → dispatch → review → assemble
    extractor.ts           # Base extractor runner (calls GenerateObject with prompt + schema + pages)
    chunking.ts            # chunkDocument() + chunk types
    pdf.ts                 # PDF operations (pdf-lib, unchanged)

  prompts/
    extractors/
      carrier-info.ts
      named-insured.ts
      coverage-limits.ts
      endorsements.ts
      exclusions.ts
      conditions.ts
      premium-breakdown.ts
      declarations.ts
      loss-history.ts
      regulatory-context.ts
      ...
    coordinator/
      classify.ts          # Document classification prompt
      plan.ts              # Page mapping + extraction planning prompt
      review.ts            # Gap-checking prompt
    templates/
      homeowners.ts
      personal-auto.ts
      commercial-auto.ts
      general-liability.ts
      commercial-property.ts
      workers-comp.ts
      professional-liability.ts
      cyber.ts
      umbrella.ts
      ...
    agent/                 # Agent prompt modules (mostly unchanged)
      index.ts
      identity.ts
      safety.ts
      formatting.ts
      coverage-gaps.ts
      coi-routing.ts
      quotes-policies.ts
      conversation-memory.ts
      intent.ts
    application/           # Application form prompts (broken up from single file)
      classify.ts
      field-extraction.ts
      auto-fill.ts
      question-batch.ts
      answer-parsing.ts
      confirmation.ts
      batch-email.ts
      reply-intent.ts
      field-explanation.ts
      pdf-mapping.ts

  storage/
    interfaces.ts          # DocumentStore, MemoryStore interfaces
    chunk-types.ts         # DocumentChunk, ConversationTurn, filters
    sqlite/
      document-store.ts
      memory-store.ts
      migrations.ts

  tools/
    definitions.ts         # Tool schemas (unchanged)

  index.ts                 # Barrel exports
```

### What Moved Where

| v5 File | v6 Location | Notes |
|---------|------------|-------|
| `pipeline.ts` (1,320 lines) | `extraction/coordinator.ts` + `extraction/extractor.ts` + prompt files | No single file over ~300 lines |
| `types/` | `schemas/` | Zod schemas as source of truth, types derived |
| `types/models.ts` | `core/types.ts` | No more ModelConfig with LanguageModel references |
| `prompts/extraction.ts` (588 lines) | `prompts/extractors/` + `prompts/coordinator/` | Many small files |
| `prompts/application.ts` (449 lines) | `prompts/application/` | Individual prompt files |
| Utilities in pipeline.ts | `core/` | retry, concurrency, stripFences, sanitize |
| `prompts/agent.ts` (deprecated) | Removed | Only new agent/ modules remain |
| `prompts/classifier.ts` (deprecated) | Removed | |

---

## 7. Public API Surface

### Entry Points

```ts
// --- Extraction ---
import { createExtractor } from '@claritylabs/cl-sdk';

const extractor = createExtractor({
  generateText,           // Consumer's callback
  generateObject,         // Consumer's callback
  convertPdfToImages?,    // Optional, for models without native PDF support
  concurrency?: 2,        // Parallel extractor limit
  onTokenUsage?,          // Token tracking callback
  onProgress?,            // Progress callback ("extracting coverages...", "found 12 endorsements...")
});

const result = await extractor.extract(pdfBase64);
// Returns: { document: PolicyDocument | QuoteDocument, chunks: DocumentChunk[] }

// --- Storage ---
import { createSqliteStore } from '@claritylabs/cl-sdk/storage/sqlite';

const store = createSqliteStore({ path: './data.db', embed: embedFn });
await store.documents.save(result.document);
await store.memory.addChunks(result.chunks);

// --- Querying ---
const hits = await store.memory.search("what are the liability limits?");
const doc = await store.documents.get(hits[0].metadata.documentId);

// --- Schemas (for custom storage) ---
import { PolicyDocumentSchema, chunkDocument } from '@claritylabs/cl-sdk';

// --- Agent prompts ---
import { buildAgentSystemPrompt } from '@claritylabs/cl-sdk';

// --- Tools ---
import { AGENT_TOOLS } from '@claritylabs/cl-sdk';

// --- PDF operations ---
import { fillAcroForm, overlayTextOnPdf } from '@claritylabs/cl-sdk';
```

### Removed from Public API

- `ModelConfig`, `createUniformModelConfig()` — replaced by plain callbacks
- `extractFromPdf()`, `extractQuoteFromPdf()`, `extractSectionsOnly()` — replaced by `extractor.extract()`
- `ai` peer dependency — removed entirely
- All deprecated exports: `buildSystemPrompt`, `CLASSIFY_EMAIL_PROMPT`, `EXTRACTION_PROMPT`, `MODEL_TOKEN_LIMITS`
- `TokenLimits`, `resolveTokenLimits()` — token limits are now per-extractor, managed internally
- `PdfContentFormat` — simplified; `convertPdfToImages` callback presence determines format

### Unchanged

- All output types (`PolicyDocument`, `QuoteDocument`, `Coverage`, all 23 declaration types, etc.)
- Agent prompt modules (`buildAgentSystemPrompt`, all `prompts/agent/` modules)
- Tool definitions (`AGENT_TOOLS`, `DOCUMENT_LOOKUP_TOOL`, etc.)
- PDF operations (`fillAcroForm`, `overlayTextOnPdf`, `getAcroFormFields`, etc.)
- Platform/intent model (`AgentContext`, `PLATFORM_CONFIGS`)

---

## 8. Dependencies

### Peer Dependencies (v6)

- `pdf-lib` >= 1.17.0 (PDF manipulation — unchanged)
- `zod` >= 3.0.0 (schema validation — new)
- `better-sqlite3` >= 11.0.0 (reference storage — optional peer dep)

### Removed

- `ai` (Vercel AI SDK) — no longer a dependency
- `@ai-sdk/anthropic` — no longer optional peer dep
- `@ai-sdk/provider-utils` — no longer imported

---

## 9. Migration Path

This is a clean break (major version bump). Consumers need to:

1. **Replace model config** — instead of `ModelConfig` with `LanguageModel` instances, provide `generateText` and `generateObject` callbacks
2. **Replace extraction calls** — `extractFromPdf(pdf, options)` becomes `createExtractor(options).extract(pdf)`
3. **Remove deprecated imports** — all deprecated exports are gone
4. **Add `zod` dependency** — new peer dep for schema validation
5. **Optionally adopt storage** — `DocumentStore` + `MemoryStore` for persistence and agent memory

Output types are unchanged, so downstream code that consumes `PolicyDocument` / `QuoteDocument` objects needs no changes.
