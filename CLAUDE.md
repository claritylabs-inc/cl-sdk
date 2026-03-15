# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@claritylabs/cell` is an insurance intelligence engine — a pure TypeScript library for policy/quote extraction, application processing, and agent prompts. It uses the Vercel AI SDK (`ai`) and pdf-lib as peer dependencies. Provider-agnostic — works with any AI provider via `LanguageModel` instances.

## Commands

```bash
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode (tsup --watch)
npm run typecheck  # Type check only (tsc --noEmit)
```

No test runner is configured. Validate changes with `npm run typecheck`.

## Architecture

### Multi-Pass Extraction Pipeline (`src/extraction/pipeline.ts`)

The core extraction system processes insurance PDFs in 3 passes with adaptive fallback:

- **Pass 0 (Classification)**: `classification` model classifies document as policy or quote
- **Pass 1 (Metadata)**: `metadata` model extracts high-level metadata (carrier, dates, premium, coverages). Includes `onMetadata?()` callback for early persistence — if pass 2 fails, metadata is already saved
- **Pass 2 (Sections)**: Chunked extraction with `sections` model. Documents split into 15-page chunks; on JSON parse failure, re-splits to 10→5 pages, then falls back to `sectionsFallback` model. `mergeChunkedSections()` combines results
- **Pass 3 (Enrichment)**: `enrichment` model enriches supplementary fields (regulatory context, contacts) from raw text. Non-fatal

Separate flows exist for policies (`extractFromPdf`) vs quotes (`extractQuoteFromPdf`). `extractSectionsOnly()` retries pass 2 using saved metadata from a prior pass 1.

### Model Configuration (`src/types/models.ts`)

Provider-agnostic via Vercel AI SDK. The pipeline accepts `ModelConfig` with `LanguageModel` instances for each role (classification, metadata, sections, sectionsFallback, enrichment). Consumers bring their own provider package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.).

- `createDefaultModelConfig()` — Anthropic defaults (requires `@ai-sdk/anthropic`, lazy-imported)
- `createUniformModelConfig(model)` — same model for all roles
- `MODEL_TOKEN_LIMITS` — per-role token limits (task-determined, not provider-determined)
- `HAIKU_MODEL` / `SONNET_MODEL` — string constants for default model IDs

Public functions use options objects (`ExtractOptions`, `ClassifyOptions`, `ExtractSectionsOptions`) with optional `models` field. Provider-specific config (e.g. Anthropic thinking) goes through `providerOptions`.

### PDF Operations (`src/extraction/pdf.ts`)

Two modes using pdf-lib:
- **AcroForm**: Detect fields (`getAcroFormFields`), fill and flatten (`fillAcroForm`)
- **Text Overlay**: Position text at percentage-based coordinates on flat PDFs (`overlayTextOnPdf`)

### Prompt System (`src/prompts/`)

- `extraction.ts` — document classification, metadata, section extraction, enrichment
- `application.ts` — form field detection, auto-fill, question batching, answer parsing, PDF mapping
- `agent/` — composable agent prompt modules (identity, safety, formatting, coverage-gaps, coi-routing, quotes-policies, conversation-memory, intent). `buildAgentSystemPrompt(ctx)` composes all modules.
- `agent.ts` — legacy `buildSystemPrompt()` (deprecated, delegates to `agent/`), `buildDocumentContext`, `buildConversationMemoryContext`
- `intent.ts` — platform-agnostic message classification with `buildClassifyMessagePrompt(platform)`
- `classifier.ts` — legacy `CLASSIFY_EMAIL_PROMPT` (deprecated)

### Type System (`src/types/`)

- `document.ts` — `BaseDocument`, `PolicyDocument`, `QuoteDocument`, `InsuranceDocument` (discriminated union), `Coverage`, `Section`, `Subsection`, `Subjectivity`, `UnderwritingCondition`, `PremiumLine`
- `platform.ts` — `Platform`, `CommunicationIntent`, `PlatformConfig`, `AgentContext`, `PLATFORM_CONFIGS`
- `models.ts` — `ModelConfig`, `createUniformModelConfig`, `createDefaultModelConfig`, `MODEL_TOKEN_LIMITS`

### Tool Definitions (`src/tools/`)

- `definitions.ts` — Claude `tool_use`-compatible schemas: `DOCUMENT_LOOKUP_TOOL`, `COI_GENERATION_TOOL`, `COVERAGE_COMPARISON_TOOL`, `AGENT_TOOLS`, `ToolDefinition` type

### Key Patterns

- **Null sanitization**: `sanitizeNulls()` converts null→undefined recursively for Convex compatibility
- **`stripFences()`**: Removes markdown code fences from Claude responses before JSON parsing
- **Path alias**: `@/*` maps to `src/*` in tsconfig
- **Barrel exports**: `src/index.ts` — all public API goes through here
- **Platform/Intent model**: Agent prompts use `AgentContext` with `platform` (email/chat/sms/slack/discord) and `intent` (direct/mediated/observed) instead of legacy mode strings
