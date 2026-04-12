# CL-SDK

[Clarity Labs](https://claritylabs.inc) allows insurers to understand their clients as well as they know themselves. A better understanding of clients means insurers can automate servicing to reduce costs and identify coverage gaps to cross-sell products.

CL-SDK is the open infrastructure layer that makes this possible — a pure TypeScript library for extracting, reasoning about, and acting on insurance documents. Provider-agnostic by design: bring any LLM, any embedding model, any storage backend.

## Installation

```bash
npm install @claritylabs/cl-sdk
```

### Peer Dependencies

```bash
npm install pdf-lib zod
```

Optional (for SQLite storage):
```bash
npm install better-sqlite3
```

## Quick Start

### Document Extraction

CL-SDK extracts structured data from insurance PDFs using a multi-agent pipeline. You provide two callback functions — `generateText` and `generateObject` — and the SDK handles the rest:

```typescript
import { createExtractor } from "@claritylabs/cl-sdk";

const extractor = createExtractor({
  generateText: async ({ prompt, system, maxTokens, providerOptions }) => {
    // Wrap your preferred LLM provider
    const result = await yourProvider.generate({ prompt, system, maxTokens, providerOptions });
    return { text: result.text, usage: result.usage };
  },
  generateObject: async ({ prompt, system, schema, maxTokens, providerOptions }) => {
    // schema is a Zod schema — use it for structured output
    // IMPORTANT: pass providerOptions.pdfBase64 and/or providerOptions.images
    // through to your model as file/image message parts.
    const result = await yourProvider.generateStructured({
      prompt,
      system,
      schema,
      maxTokens,
      providerOptions,
    });
    return { object: result.object, usage: result.usage };
  },
});

const pdfBase64 = "..."; // base64-encoded insurance PDF
const result = await extractor.extract(pdfBase64);
console.log(result.document); // Typed InsuranceDocument (policy or quote)
console.log(result.chunks);   // DocumentChunk[] ready for vector storage
```

### With PDF-to-Image Conversion

For providers that don't support native PDF input (e.g., OpenAI):

```typescript
const extractor = createExtractor({
  generateText: /* ... */,
  generateObject: /* ... */,
  convertPdfToImages: async (pdfBase64, startPage, endPage) => {
    // Convert PDF pages to images using your preferred library
    return [{ imageBase64: "...", mimeType: "image/png" }]; // one per page
  },
});
```

## Architecture

### Provider-Agnostic Callbacks

CL-SDK has **zero framework dependencies**. All LLM interaction happens through two callback types:

```typescript
type GenerateText = (params: {
  prompt: string;
  system?: string;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;

type GenerateObject<T> = (params: {
  prompt: string;
  system?: string;
  schema: ZodSchema<T>;
  maxTokens: number;
  providerOptions?: Record<string, unknown>;
}) => Promise<{ object: T; usage?: { inputTokens: number; outputTokens: number } }>;
```

For extraction calls, `providerOptions` can carry document content:

- `providerOptions.pdfBase64` — the PDF to send as a file part
- `providerOptions.images` — page images to send as image parts

The coordinator passes the full PDF to classify and plan. Worker extractors pass a page-scoped PDF produced by `extractPageRange()` unless `convertPdfToImages` is enabled, in which case they pass page images instead. Your callback must include that content in the actual model request; the prompt text alone is not sufficient.

Works with any provider: Anthropic, OpenAI, Google, Mistral, Bedrock, Azure, Ollama, etc. You write the adapter once; the SDK calls it throughout the pipeline.

> **Strict structured output compatibility:** The SDK automatically transforms Zod schemas before passing them to `generateObject` — converting `.optional()` fields to `.nullable()` so all properties appear in the JSON Schema `required` array. This ensures compatibility with providers like OpenAI that enforce strict structured output validation. No adapter changes needed on your end.

### Extraction Pipeline

The extraction system uses a **coordinator/worker pattern** — a coordinator agent plans the work, specialized extractor agents execute in parallel, and a review loop ensures completeness.

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────────┐
│  1. CLASSIFY │────▶│  2. PLAN    │────▶│  3. EXTRACT (parallel)│
│              │     │             │     │                      │
│  Document    │     │  Select     │     │  Run focused         │
│  type, line  │     │  template,  │     │  extractors against  │
│  of business │     │  assign     │     │  assigned page       │
│              │     │  extractors │     │  ranges              │
│              │     │  to pages   │     │                      │
└─────────────┘     └─────────────┘     └──────────┬───────────┘
                                                   │
┌─────────────┐     ┌─────────────┐     ┌──────────▼───────────┐
│ 6. FORMAT   │◀────│ 5. ASSEMBLE │◀────│  4. REVIEW           │
│             │     │             │     │                      │
│  Clean up   │     │  Merge all  │     │  Check completeness  │
│  markdown   │     │  results    │     │  against template,   │
│  tables,    │     │  into final │     │  dispatch follow-up  │
│  spacing    │     │  document   │     │  extractors for gaps │
└──────┬──────┘     └─────────────┘     └──────────────────────┘
       │
┌──────▼──────┐
│ 7. CHUNK    │
│  Break into │
│  retrieval- │
│  ready      │
│  chunks     │
└─────────────┘
```

#### Phase 1: Classify

The coordinator sends the document to `generateObject` with the `ClassifyResultSchema`. It determines:
- **Document type** — policy or quote
- **Policy types** — one or more lines of business (e.g., `general_liability`, `workers_comp`)
- **Confidence score**

The full document is passed through `providerOptions.pdfBase64` for this step, so your callback must attach that PDF to the model request as a real document/file part.

#### Phase 2: Plan

Based on the classification, the coordinator selects a **line-of-business template** (e.g., `workers_comp`, `cyber`, `homeowners_ho3`) that defines expected sections and page hints. It then generates an **extraction plan** — a list of tasks that map specific extractors to page ranges within the PDF.

The planner also receives the full document through `providerOptions.pdfBase64`, not just prompt text.

#### Phase 3: Extract

Focused extractor agents are dispatched **in parallel** (concurrency-limited, default 2). Each extractor targets a specific data domain against its assigned page range. The 11 extractor types are:

| Extractor | What It Extracts |
|-----------|-----------------|
| `carrier_info` | Carrier name, NAIC, AM Best rating, MGA, underwriter, broker |
| `named_insured` | Insured name, DBA, address, entity type, FEIN, SIC/NAICS |
| `declarations` | Line-specific structured declarations (varies by policy type) |
| `coverage_limits` | Coverage names, limits, deductibles, forms, triggers |
| `endorsements` | Form numbers, titles, types, content, affected parties |
| `exclusions` | Exclusion titles, content, applicability |
| `conditions` | Duties after loss, cancellation, other insurance, etc. |
| `premium_breakdown` | Premium amounts, taxes, fees, payment plans, rating basis |
| `loss_history` | Loss runs, claim records, experience modification |
| `supplementary` | Regulatory context, contacts, TPA, claims contacts |
| `sections` | Raw section content (fallback for unmatched sections) |

Each extractor writes its results to an in-memory `Map`. Results accumulate across all extractors.

Before each worker call, the SDK slices the requested page range with `extractPageRange()` and passes that page-scoped PDF through `providerOptions.pdfBase64`. If `convertPdfToImages` is configured, it passes `providerOptions.images` instead. The callback layer is responsible for actually including that content in the model input.

#### Phase 4: Review

After initial extraction, a review loop (up to `maxReviewRounds`, default 2) checks completeness against the template's expected sections. If gaps are found, additional extractor tasks are dispatched to fill missing data. This iterative refinement ensures comprehensive extraction.

#### Phase 5: Assemble

All extractor results are merged into a final validated `InsuranceDocument`.

#### Phase 6: Format

A formatting agent pass cleans up markdown in all content-bearing string fields (sections, subsections, endorsements, exclusions, conditions, summary). It fixes:

- **Pipe tables missing separator rows** — adds `| --- | --- |` and leading/trailing pipes
- **Space-aligned tables** — converts whitespace-padded columns into proper markdown tables
- **Sub-items mixed into tables** — pulls indented sub-items out of tables into lists
- **Mixed table/prose content** — handles each segment independently
- **General cleanup** — excessive blank lines, trailing whitespace, orphaned formatting markers

Content is batched (up to 20 fields per call) and sent through `generateText` for formatting cleanup. Token usage is tracked the same as other pipeline steps.

#### Phase 7: Chunk

The formatted document is chunked into `DocumentChunk[]` for vector storage. Chunks are deterministically IDed as `${documentId}:${type}:${index}`.

### Configuration

```typescript
const extractor = createExtractor({
  // Required: LLM callbacks
  generateText,
  generateObject,

  // Optional: PDF vision mode
  convertPdfToImages: async (pdfBase64, startPage, endPage) => [...],

  // Optional: storage backends
  documentStore,  // Persist extracted documents
  memoryStore,    // Vector search over chunks + conversation history

  // Optional: tuning
  concurrency: 2,        // Max parallel extractors (default: 2)
  maxReviewRounds: 2,    // Review loop iterations (default: 2)

  // Optional: observability
  onTokenUsage: (usage) => console.log(`${usage.inputTokens} in, ${usage.outputTokens} out`),
  onProgress: (message) => console.log(message),
  log: async (message) => logger.info(message),
  providerOptions: {},   // Passed through to every LLM call
});
```

### Line-of-Business Templates

Templates define what the extraction pipeline expects for each policy type. Each template specifies expected sections, page hints, and required vs. optional fields.

**Personal lines:** homeowners (HO-3, HO-5), renters (HO-4), condo (HO-6), dwelling fire, personal auto, personal umbrella, personal inland marine, flood (NFIP + private), earthquake, watercraft, recreational vehicle, farm/ranch, mobile home

**Commercial lines:** general liability, commercial property, commercial auto, workers' comp, umbrella/excess, professional liability, cyber, directors & officers, crime/fidelity

## Storage

CL-SDK defines two storage interfaces (`DocumentStore` and `MemoryStore`) and ships a reference SQLite implementation. You can implement these interfaces with any backend.

### DocumentStore

CRUD for extracted `InsuranceDocument` objects:

```typescript
interface DocumentStore {
  save(doc: InsuranceDocument): Promise<void>;
  get(id: string): Promise<InsuranceDocument | null>;
  query(filters: DocumentFilters): Promise<InsuranceDocument[]>;
  delete(id: string): Promise<void>;
}
```

Filters support: `type` (policy/quote), `carrier` (fuzzy), `insuredName` (fuzzy), `policyNumber` (exact), `quoteNumber` (exact).

### MemoryStore

Vector-searchable storage for document chunks and conversation history. Requires an `EmbedText` callback for generating embeddings:

```typescript
type EmbedText = (text: string) => Promise<number[]>;

interface MemoryStore {
  // Document chunks with embeddings
  addChunks(chunks: DocumentChunk[]): Promise<void>;
  search(query: string, options?: { limit?: number; filter?: ChunkFilter }): Promise<DocumentChunk[]>;

  // Conversation turns with embeddings
  addTurn(turn: ConversationTurn): Promise<void>;
  getHistory(conversationId: string, options?: { limit?: number }): Promise<ConversationTurn[]>;
  searchHistory(query: string, conversationId?: string): Promise<ConversationTurn[]>;
}
```

Search uses **cosine similarity** over embeddings to find semantically relevant chunks or conversation turns. Embedding failures are non-fatal — chunks are still stored, just not searchable by vector.

### SQLite Reference Implementation

```typescript
import { createSqliteStore } from "@claritylabs/cl-sdk/storage/sqlite";

const store = createSqliteStore({
  path: "./cl-sdk.db",
  embed: async (text) => {
    // Your embedding function (OpenAI, Cohere, local model, etc.)
    return await yourEmbeddingProvider.embed(text);
  },
});

// Use with extractor
const extractor = createExtractor({
  generateText,
  generateObject,
  documentStore: store.documents,
  memoryStore: store.memory,
});

// Or use standalone
await store.documents.save(document);
const results = await store.memory.search("what is the deductible?", { limit: 5 });

// Clean up
store.close();
```

## Agent System

CL-SDK includes a composable prompt system for building insurance-aware AI agents. The `buildAgentSystemPrompt` function assembles modular prompt segments based on the agent's context:

```typescript
import { buildAgentSystemPrompt } from "@claritylabs/cl-sdk";

const systemPrompt = buildAgentSystemPrompt({
  platform: "email",       // email | chat | sms | slack | discord
  intent: "direct",        // direct | mediated | observed
  userName: "John",
  companyName: "Acme Insurance",
});
```

### Prompt Modules

The system prompt is composed from these modules:

| Module | Purpose |
|--------|---------|
| **identity** | Agent role, company context, professional persona |
| **intent** | Behavioral rules based on platform and interaction mode |
| **formatting** | Output formatting rules (markdown for chat, plaintext for email/SMS) |
| **safety** | Security guardrails, prompt injection resistance, data handling |
| **coverage-gaps** | Coverage gap disclosure rules (only in mediated/observed mode) |
| **coi-routing** | Certificate of Insurance request handling |
| **quotes-policies** | Guidance for distinguishing quotes vs. active policies |
| **conversation-memory** | Context about conversation history and document retrieval |

### Message Intent Classification

Classify incoming messages to route them appropriately:

```typescript
import { buildClassifyMessagePrompt } from "@claritylabs/cl-sdk";

const prompt = buildClassifyMessagePrompt("email");
// Returns classification prompt for intents:
// policy_question, coi_request, renewal_inquiry, claim_report,
// coverage_shopping, general, unrelated
```

## Application Processing Pipeline

The application pipeline processes insurance applications through an agentic coordinator/worker system — small focused agents handle classification, field extraction, auto-fill, question batching, reply routing, and PDF mapping. Supports persistent state and vector-based answer backfill from prior applications.

### Quick Start

```typescript
import { createApplicationPipeline } from "@claritylabs/cl-sdk";

const pipeline = createApplicationPipeline({
  generateText,
  generateObject,
  applicationStore,      // persistent state storage
  documentStore,         // for policy/quote lookups during auto-fill
  memoryStore,           // for vector-based answer backfill
  orgContext: [           // business context for auto-fill
    { key: "company_name", value: "Acme Corp", category: "company_info" },
    { key: "company_address", value: "123 Main St", category: "company_info" },
  ],
});

// Process a new application PDF
const { state } = await pipeline.processApplication({
  pdfBase64: "...",
  applicationId: "app-123",
});
// state.fields → extracted fields, some already auto-filled
// state.batches → question batches ready for user collection

// Generate email for current batch
const { text: emailBody } = await pipeline.generateCurrentBatchEmail("app-123", {
  companyName: "Acme Corp",
});

// Process user's reply
const { state: updated, fieldsFilled, responseText } = await pipeline.processReply({
  applicationId: "app-123",
  replyText: "1. Yes\n2. $1,000,000\n3. Check our website for revenue",
});
```

### Pipeline Phases

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ 1. CLASSIFY  │────>│ 2. EXTRACT   │────>│ 3. BACKFILL +       │
│              │     │    FIELDS    │     │    AUTO-FILL         │
│ Is this an   │     │              │     │    (parallel)        │
│ application? │     │ All fillable │     │                     │
│              │     │ fields as    │     │ • vector backfill   │
│              │     │ structured   │     │ • context auto-fill │
│              │     │ data         │     │ • document search   │
└──────────────┘     └──────────────┘     └──────────┬──────────┘
                                                     │
                     ┌──────────────┐     ┌──────────v──────────┐
                     │ REPLY LOOP   │<────│ 4. BATCH QUESTIONS  │
                     │              │     │                     │
                     │ Route intent │     │ Group unfilled      │
                     │ Parse answers│     │ fields by topic     │
                     │ Handle lookup│     │ Generate emails     │
                     │ Explain field│     │                     │
                     └──────┬───────┘     └─────────────────────┘
                            │
                     ┌──────v───────┐
                     │ 5. CONFIRM + │
                     │    MAP PDF   │
                     └──────────────┘
```

### Focused Agents (8 types)

| Agent | Task | Model Size |
|-------|------|-----------|
| `classifier` | Detect if PDF is an application | Tiny |
| `field-extractor` | Extract all form fields | Medium |
| `auto-filler` | Match fields to business context | Small |
| `batcher` | Group fields into topic batches | Small |
| `reply-router` | Classify reply intent | Tiny |
| `answer-parser` | Extract answers from replies | Small |
| `lookup-filler` | Fill from policy/record lookups | Small |
| `email-generator` | Generate professional batch emails | Small |

### Vector-Based Answer Backfill

The `BackfillProvider` interface enables searching prior application answers and extracted document data to pre-fill new applications:

```typescript
interface BackfillProvider {
  searchPriorAnswers(
    fields: { id: string; label: string; section: string; fieldType: string }[],
    options?: { limit?: number },
  ): Promise<PriorAnswer[]>;
}
```

This runs in parallel with context-based auto-fill, so the pipeline fills as many fields as possible before asking the user anything.

### Application Prompts (for advanced use)

The individual prompt functions are still exported for custom pipelines:

```typescript
import {
  buildFieldExtractionPrompt,
  buildAutoFillPrompt,
  buildQuestionBatchPrompt,
  buildAnswerParsingPrompt,
  buildConfirmationSummaryPrompt,
  buildBatchEmailGenerationPrompt,
  buildReplyIntentClassificationPrompt,
  buildFieldExplanationPrompt,
  buildFlatPdfMappingPrompt,
  buildAcroFormMappingPrompt,
  buildLookupFillPrompt,
} from "@claritylabs/cl-sdk";
```

## Query Agent Pipeline

The query agent answers user questions against stored documents with citation-backed provenance. It mirrors the extraction pipeline's coordinator/worker pattern: a classifier decomposes questions, retrievers pull evidence in parallel, reasoners answer from evidence only, and a verifier checks grounding.

### Quick Start

```typescript
import { createQueryAgent } from "@claritylabs/cl-sdk";

const agent = createQueryAgent({
  generateText,
  generateObject,
  documentStore,    // where extracted documents are stored
  memoryStore,      // where document chunks + conversation history live
});

const result = await agent.query({
  question: "What is the deductible on our GL policy?",
  conversationId: "conv-123",
});

console.log(result.answer);     // Natural language answer
console.log(result.citations);  // Source references with exact quotes
console.log(result.confidence); // 0-1 confidence score
```

### Pipeline Phases

```
┌─────────────┐     ┌──────────────┐     ┌────────────────────┐
│ 1. CLASSIFY  │────>│ 2. RETRIEVE  │────>│ 3. REASON          │
│              │     │  (parallel)  │     │    (parallel)       │
│ Intent +     │     │              │     │                    │
│ sub-question │     │ chunk search │     │ Answer each sub-Q  │
│ decomposition│     │ doc lookup   │     │ from evidence only │
│              │     │ conv history │     │                    │
└──────────────┘     └──────────────┘     └─────────┬──────────┘
                                                    │
                     ┌──────────────┐     ┌─────────v──────────┐
                     │ 5. RESPOND   │<────│ 4. VERIFY          │
                     │              │     │                    │
                     │ Format with  │     │ Grounding check    │
                     │ citations,   │     │ Consistency check  │
                     │ store turn   │     │ Completeness check │
                     └──────────────┘     └────────────────────┘
```

**Phase 1 — Classify:** Determines intent (`policy_question`, `coverage_comparison`, `document_search`, `claims_inquiry`, `general_knowledge`) and decomposes complex questions into atomic sub-questions. Each sub-question specifies which chunk types and document filters to use for retrieval.

**Phase 2 — Retrieve (parallel):** For each sub-question, a retriever searches chunk embeddings, does structured document lookups, and pulls conversation history — all in parallel. Returns ranked evidence items.

**Phase 3 — Reason (parallel):** For each sub-question, a reasoner receives only the retrieved evidence (never the full document) and produces a sub-answer with citations. Intent-specific prompts guide reasoning (e.g., coverage questions get prompts tuned for interpreting limits and endorsements).

**Phase 4 — Verify:** The verifier checks that every claim is grounded in a citation, sub-answers don't contradict each other, and no evidence was overlooked. If issues are found, it can trigger re-retrieval with broader context.

**Phase 5 — Respond:** Merges verified sub-answers into a single natural-language response with inline citations (`[1]`, `[2]`), deduplicates references, and stores the exchange as conversation turns.

### Configuration

```typescript
const agent = createQueryAgent({
  // Required
  generateText,
  generateObject,
  documentStore,
  memoryStore,

  // Optional: tuning
  concurrency: 3,        // max parallel retrievers/reasoners (default: 3)
  maxVerifyRounds: 1,    // verification loop iterations (default: 1)
  retrievalLimit: 10,    // max evidence items per sub-question (default: 10)

  // Optional: observability
  onTokenUsage: (usage) => console.log(`${usage.inputTokens} in, ${usage.outputTokens} out`),
  onProgress: (message) => console.log(message),
  log: async (message) => logger.info(message),
  providerOptions: {},
});
```

### Citations

Every factual claim in the answer references its source:

```typescript
interface Citation {
  index: number;         // [1], [2], etc.
  chunkId: string;       // e.g. "doc-123:coverage:2"
  documentId: string;
  documentType?: "policy" | "quote";
  field?: string;        // e.g. "coverages[0].deductible"
  quote: string;         // exact text from source
  relevance: number;     // 0-1 similarity score
}
```

## PDF Operations

```typescript
import {
  extractPageRange,    // Extract specific pages from a PDF
  getPdfPageCount,     // Get total page count
  getAcroFormFields,   // Enumerate form fields (text, checkbox, dropdown, radio)
  fillAcroForm,        // Fill and flatten AcroForm fields
  overlayTextOnPdf,    // Overlay text at coordinates on flat PDFs
} from "@claritylabs/cl-sdk";
```

## Tool Definitions

Claude `tool_use`-compatible schemas for agent integrations:

```typescript
import {
  AGENT_TOOLS,              // All tools as an array
  DOCUMENT_LOOKUP_TOOL,     // Search/retrieve policies and quotes
  COI_GENERATION_TOOL,      // Generate Certificates of Insurance
  COVERAGE_COMPARISON_TOOL, // Compare coverages across documents
} from "@claritylabs/cl-sdk";
```

These are schema-only definitions (input schemas + descriptions). You provide the implementations that call your storage and PDF layers.

## Document Types

All types are derived from Zod schemas, providing both runtime validation and TypeScript types:

```typescript
import type {
  InsuranceDocument,   // PolicyDocument | QuoteDocument (discriminated union)
  PolicyDocument,      // Extracted policy with all enrichments
  QuoteDocument,       // Extracted quote with subjectivities, premium breakdown
  Coverage,            // Coverage name, limits, deductibles, form
  EnrichedCoverage,    // Coverage + additional metadata
  Endorsement,         // Form number, title, type, content
  Exclusion,           // Title, content, applicability
  Condition,           // Type, title, content
  Declaration,         // Line-specific declarations (19 types)
  Platform,            // email | chat | sms | slack | discord
  AgentContext,        // Platform + intent + user/company context
} from "@claritylabs/cl-sdk";
```

### Supported Policy Types

42 policy types across personal and commercial lines — including general liability, commercial property, workers' comp, cyber, D&O, homeowners (HO-3/HO-5/HO-4/HO-6), personal auto, flood (NFIP + private), earthquake, and more.

## Core Utilities

```typescript
import {
  withRetry,            // Exponential backoff with jitter (5 retries, 2–32s) for rate limits + transient errors
  pLimit,               // Concurrency limiter for parallel async tasks
  sanitizeNulls,        // Recursively convert null → undefined (for database compatibility)
  stripFences,          // Remove markdown code fences from LLM JSON responses
  safeGenerateObject,   // generateObject wrapper with retry, schema strictification, and fallback
  toStrictSchema,       // Convert .optional() → .nullable() for strict structured output APIs
} from "@claritylabs/cl-sdk";
```

### Schema Compatibility

The SDK automatically handles schema compatibility with strict structured output APIs (like OpenAI). Two key mechanisms:

**`toStrictSchema(schema)`** — Recursively transforms Zod schemas so `.optional()` properties become `.nullable()`. This ensures all properties appear in the JSON Schema `required` array, which OpenAI requires. Applied automatically inside the pipeline — you don't need to call this yourself unless building custom pipelines.

**`safeGenerateObject(generateObject, params, options?)`** — Wraps a `generateObject` call with:
1. Automatic schema strictification via `toStrictSchema`
2. Retry on schema validation errors and transient API failures
3. Optional fallback value when all retries are exhausted

```typescript
import { safeGenerateObject } from "@claritylabs/cl-sdk";

const { object, usage } = await safeGenerateObject(
  myGenerateObject,
  { prompt: "...", schema: MySchema, maxTokens: 1024 },
  {
    fallback: { field: "default" },  // Return this if all retries fail
    maxRetries: 2,                    // Schema validation retries (default: 1)
    log: async (msg) => console.log(msg),
  },
);
```

## Development

```bash
npm install
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode
npm run typecheck  # Type check (tsc --noEmit)
```

Zero framework dependencies. Peer deps: `pdf-lib`, `zod`. Optional: `better-sqlite3`.

## License

Apache-2.0
