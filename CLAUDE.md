# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@claritylabs/cl-sdk` (CL-SDK) is an open infrastructure layer for building AI agents that work with insurance — a pure TypeScript library for policy/quote extraction, application processing, and agent prompts. Provider-agnostic via plain callback functions (`GenerateText`, `GenerateObject`) — no framework dependency. Uses Zod schemas as the source of truth for all types. Includes optional SQLite-backed storage for documents and extraction memory.

## Commands

```bash
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode (tsup --watch)
npm run typecheck  # Type check only (tsc --noEmit)
```

No test runner is configured. Validate changes with `npm run typecheck`.

## Architecture

### File Structure

```
src/
  core/           # Provider-agnostic types, retry, concurrency, utilities
  schemas/        # Zod schemas (source of truth for all types)
  extraction/     # Agentic extraction: coordinator, extractor, assembler, formatter, chunking, pdf
  query/          # Agentic query: coordinator, retriever, reasoner, verifier
  application/    # Agentic application processing: coordinator, 8 focused agents, store
  prompts/        # Prompt modules: coordinator/, extractors/, templates/, agent/, application/, query/
  storage/        # DocumentStore + MemoryStore interfaces, SQLite reference impl
  tools/          # Tool definitions (unchanged)
```

### Agentic Extraction Pipeline (`src/extraction/`)

The core extraction system uses a coordinator/worker pattern with extraction memory:

1. **Classify** (`coordinator.ts`): Classify document type and identify policy types using `generateObject` + `ClassifyResultSchema`
2. **Plan** (`coordinator.ts`): Select a line-of-business template (`prompts/templates/`) and generate an extraction plan — a list of tasks mapping focused extractors to page ranges
3. **Extract** (`extractor.ts`): Dispatch focused extractors in parallel (concurrency-limited, default 2). Each extractor (`prompts/extractors/`) targets a specific data domain (declarations, coverages, conditions, endorsements, etc.) against a page range. Results accumulate in an in-memory `Map`
4. **Review** (`coordinator.ts`): Review loop (up to `maxReviewRounds`, default 2) checks completeness against template requirements. If gaps found, dispatches additional extractors for missing data
5. **Assemble** (`assembler.ts`): Merge all extractor results into a final `InsuranceDocument`
6. **Format** (`formatter.ts`): Post-extraction pass that cleans up markdown formatting in all content-bearing fields (sections, endorsements, exclusions, conditions, summary). Fixes pipe tables missing separator rows, space-aligned tables, sub-items mixed into tables, orphaned formatting markers, and excessive whitespace. Uses `generateText` in batches of up to 20 entries. Prompt: `prompts/coordinator/format.ts`
7. **Chunk** (`chunking.ts`): Break the formatted document into `DocumentChunk[]` for vector storage

Entry point: `createExtractor(config)` returns `{ extract(pdfBase64, documentId?) }`.

### Query Agent Pipeline (`src/query/`)

The query system answers user questions against stored documents with citation-backed provenance. Same coordinator/worker pattern as extraction:

1. **Classify** (`coordinator.ts`): Determine query intent and decompose into atomic sub-questions. Each sub-question specifies chunk type filters and document filters for retrieval
2. **Retrieve** (`retriever.ts`): For each sub-question, search chunks (semantic), documents (structured), and conversation history — in parallel (concurrency-limited, default 3)
3. **Reason** (`reasoner.ts`): For each sub-question, a reasoner receives only retrieved evidence and produces a sub-answer with citations. Uses intent-specific prompts (policy questions, comparisons, claims, etc.)
4. **Verify** (`verifier.ts`): Check grounding (every claim has a citation), consistency (no contradictions), and completeness. Can trigger re-retrieval on failure (up to `maxVerifyRounds`, default 1)
5. **Respond** (`coordinator.ts`): Merge sub-answers into final response with inline citations, store conversation turns

Entry point: `createQueryAgent(config)` returns `{ query(input) }`.

Query intents: `policy_question`, `coverage_comparison`, `document_search`, `claims_inquiry`, `general_knowledge`.

Schemas: `src/schemas/query.ts` — `QueryClassifyResultSchema`, `SubAnswerSchema`, `VerifyResultSchema`, `QueryResultSchema`, `CitationSchema`.

Prompts: `src/prompts/query/` — `classify.ts`, `reason.ts`, `verify.ts`, `respond.ts`.

### Application Processing Pipeline (`src/application/`)

Agentic pipeline for processing insurance applications. Same coordinator/worker pattern:

1. **Classify** (`agents/classifier.ts`): Detect if PDF is an application form
2. **Extract** (`agents/field-extractor.ts`): Extract all fillable fields as structured data
3. **Backfill + Auto-Fill** (parallel): Vector search prior answers (`BackfillProvider`), match business context (`agents/auto-filler.ts`), search document chunks
4. **Batch** (`agents/batcher.ts`): Group unfilled fields into topic-based batches for user collection
5. **Reply Loop**: Route reply intent (`agents/reply-router.ts`) → parse answers (`agents/answer-parser.ts`) / handle lookups (`agents/lookup-filler.ts`) / generate emails (`agents/email-generator.ts`)
6. **Confirm + Map PDF** (`agents/pdf-mapper.ts`): Map filled values to PDF (flat overlay or AcroForm)

Entry point: `createApplicationPipeline(config)` returns `{ processApplication, processReply, generateCurrentBatchEmail, getConfirmationSummary }`.

Storage: `ApplicationStore` interface for persistent state, `BackfillProvider` interface for vector-based answer backfill.

Schemas: `src/schemas/application.ts` — `ApplicationField`, `ApplicationState`, `AutoFillResult`, `ReplyIntent`, `AnswerParsingResult`, etc.

Agents: 8 focused agents in `src/application/agents/` — each with simple prompts designed for small/fast models.

### Provider Callbacks (`src/core/types.ts`)

No framework coupling. Consumers provide plain callback functions:

- `GenerateText` — `(params: { prompt, system?, maxTokens, providerOptions? }) => Promise<{ text, usage? }>`
- `GenerateObject<T>` — `(params: { prompt, system?, schema: ZodSchema<T>, maxTokens, providerOptions? }) => Promise<{ object: T, usage? }>`
- `EmbedText` — `(text: string) => Promise<number[]>` (for memory store)
- `ConvertPdfToImagesFn` — `(pdfBase64, startPage, endPage) => Promise<Array<{ imageBase64, mimeType }>>` — if provided, PDF pages are sent as images instead of native PDF file

Consumers wrap their preferred provider (Anthropic, OpenAI, etc.) into these callbacks. The SDK never imports or depends on any provider package.

### Schemas (`src/schemas/`)

All types are derived from Zod schemas via `z.infer`. Schema files define both runtime validation and TypeScript types:

- `document.ts` — `InsuranceDocument`, `PolicyDocument`, `QuoteDocument` (discriminated union)
- `coverage.ts`, `condition.ts`, `exclusion.ts`, `endorsement.ts`, `financial.ts` — domain schemas
- `declarations/` — per-line-of-business declaration page schemas
- `parties.ts`, `loss-history.ts`, `underwriting.ts`, `shared.ts`, `enums.ts` — shared schemas
- `platform.ts` — `Platform`, `CommunicationIntent`, `AgentContext`, `PLATFORM_CONFIGS`
- `context-keys.ts` — extraction memory context keys
- `query.ts` — `QueryIntent`, `Citation`, `SubQuestion`, `SubAnswer`, `VerifyResult`, `QueryResult` schemas

### PDF Operations (`src/extraction/pdf.ts`)

Two modes using pdf-lib:
- **AcroForm**: Detect fields (`getAcroFormFields`), fill and flatten (`fillAcroForm`)
- **Text Overlay**: Position text at percentage-based coordinates on flat PDFs (`overlayTextOnPdf`)
- **Page extraction**: `extractPageRange()` and `getPdfPageCount()` for chunked extraction

### Prompt System (`src/prompts/`)

- `coordinator/` — classify, plan, review, format prompts for the agentic pipeline
- `extractors/` — focused extractor prompts: declarations, coverage-limits, conditions, endorsements, exclusions, loss-history, named-insured, premium-breakdown, sections, supplementary, carrier-info
- `templates/` — line-of-business templates (commercial-auto, cyber, workers-comp, homeowners, etc.) defining expected sections and page hints
- `application/` — form field extraction, auto-fill, question batching, answer parsing, PDF mapping, reply intent classification
- `query/` — classify (intent + decomposition), reason (per-intent evidence-based), verify (grounding check), respond (citation formatting)
- `agent/` — composable agent prompt modules (identity, safety, formatting, coverage-gaps, coi-routing, quotes-policies, conversation-memory, intent). `buildAgentSystemPrompt(ctx)` composes all modules
- `intent.ts` — platform-agnostic message classification with `buildClassifyMessagePrompt(platform)`

### Storage (`src/storage/`)

- `interfaces.ts` — `DocumentStore` (CRUD for `InsuranceDocument`) and `MemoryStore` (vector search over `DocumentChunk`, conversation history) interfaces
- `chunk-types.ts` — `DocumentChunk`, `ConversationTurn`, `ChunkFilter`, `DocumentFilters`
- `sqlite/` — reference SQLite implementation of both interfaces

### Tool Definitions (`src/tools/`)

- `definitions.ts` — Claude `tool_use`-compatible schemas: `DOCUMENT_LOOKUP_TOOL`, `COI_GENERATION_TOOL`, `COVERAGE_COMPARISON_TOOL`, `AGENT_TOOLS`, `ToolDefinition` type

### Key Patterns

- **Null sanitization**: `sanitizeNulls()` converts null→undefined recursively for Convex compatibility
- **`stripFences()`**: Removes markdown code fences from model responses before JSON parsing
- **Rate-limit retry**: `withRetry()` wraps all model calls with exponential backoff (5 retries, 2-32s + jitter) on 429/rate-limit errors
- **Concurrency control**: `pLimit(n)` utility limits parallel extractor dispatch (no external dependency). Default concurrency is 2
- **Token tracking**: `onTokenUsage` callback on `ExtractorConfig` reports `{ inputTokens, outputTokens }` after each model call
- **Path alias**: `@/*` maps to `src/*` in tsconfig
- **Barrel exports**: `src/index.ts` — all public API goes through here
- **Platform/Intent model**: Agent prompts use `AgentContext` with `platform` (email/chat/sms/slack/discord) and `intent` (direct/mediated/observed) instead of legacy mode strings

## Releases

Versioning and publishing are fully automated via [semantic-release](https://github.com/semantic-release/semantic-release). Pushing to `master` triggers the GitHub Actions `Release` workflow which:

1. Analyzes commit messages (conventional commits) to determine the semver bump
2. Updates `CHANGELOG.md`, `package.json`, and `package-lock.json`
3. Creates a GitHub release with auto-generated release notes
4. Commits the updated files back to `master`
5. Publishes to npm (`registry.npmjs.org`)
6. Triggers `cl-sdk-docs` rebuild

**Commit message format** (determines version bump):
- `fix: ...` → patch (0.0.x)
- `feat: ...` → minor (0.x.0)
- `feat!: ...` or `BREAKING CHANGE:` in footer → major (x.0.0)
- `chore:`, `docs:`, `refactor:`, `test:`, etc. → no release

Local dry-run: `npx semantic-release --dry-run`
