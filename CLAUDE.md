# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@claritylabs/cl-sdk` (CL-0 SDK) is an open infrastructure layer for building AI agents that work with insurance — a pure TypeScript library for policy/quote extraction, application processing, and agent prompts. It uses the Vercel AI SDK (`ai`) and pdf-lib as peer dependencies. Provider-agnostic — works with any AI provider via `LanguageModel` instances.

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
- **Pass 2 (Sections)**: Chunked extraction with `sections` model. Documents split into 15-page chunks and processed in parallel (concurrency-limited, default 2). On JSON parse failure, re-splits to 10→5 pages, then falls back to `sectionsFallback` model. `mergeChunkedSections()` combines results
- **Pass 3 (Enrichment)**: `enrichment` model enriches supplementary fields (regulatory context, contacts) from raw text. Non-fatal

Separate flows exist for policies (`extractFromPdf`) vs quotes (`extractQuoteFromPdf`). `extractSectionsOnly()` retries pass 2 using saved metadata from a prior pass 1.

### Model Configuration (`src/types/models.ts`)

Provider-agnostic via Vercel AI SDK. The pipeline accepts `ModelConfig` with `LanguageModel` instances for each role (classification, metadata, sections, sectionsFallback, enrichment). Consumers bring their own provider package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.).

- `createUniformModelConfig(model)` — same model for all roles
- `DEFAULT_TOKEN_LIMITS` — default per-role token limits; `MODEL_TOKEN_LIMITS` is a deprecated alias
- `TokenLimits` / `resolveTokenLimits(overrides?)` — override maxTokens per role via options
- `isAnthropicModel(model)` — detect if model is from Anthropic for format auto-detection

Public functions use options objects (`ExtractOptions`, `ClassifyOptions`, `ExtractSectionsOptions`) with required `models` field — no default provider is assumed. Provider-specific config (e.g. Anthropic thinking) goes through `providerOptions`. Options also include `concurrency` (parallel chunk limit, default 2) and `onTokenUsage` callback for tracking cumulative token usage.

#### PDF Content Format (`PdfContentFormat`)

The SDK supports multiple PDF input formats to work across different providers:

- `auto` (default): Auto-detects provider. Uses `anthropic-file` for Anthropic models, `image` for all others (requires `convertPdfToImages`)
- `anthropic-file`: Native Anthropic PDF format `{ type: "file", data, mediaType }` — most efficient, but Anthropic-only
- `image`: Converts PDF pages to base64 images via `convertPdfToImages` callback — works with any vision-capable model (OpenAI, Kimi, DeepSeek, etc.)

Non-Anthropic models **require** `convertPdfToImages` — the SDK throws if it's missing rather than silently falling back to text extraction (which would lose the visual layout critical for insurance documents). The callback receives `(pdfBase64, startPage, endPage)` and returns an array of `{ imageBase64, mimeType }` for each page.

**Implementation details** (`src/extraction/pipeline.ts`):
- `getEffectivePdfFormat()` — determines format based on setting + model provider
- `buildPdfContentParts()` — constructs Vercel AI SDK content parts for the selected format
- `callModel()` — accepts `pdfContentFormat` and `convertPdfToImages` params

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
- `models.ts` — `ModelConfig`, `createUniformModelConfig`, `DEFAULT_TOKEN_LIMITS`, `TokenLimits`, `resolveTokenLimits`, `PdfContentFormat`, `ConvertPdfToImagesFn`, `isAnthropicModel`

### Tool Definitions (`src/tools/`)

- `definitions.ts` — Claude `tool_use`-compatible schemas: `DOCUMENT_LOOKUP_TOOL`, `COI_GENERATION_TOOL`, `COVERAGE_COMPARISON_TOOL`, `AGENT_TOOLS`, `ToolDefinition` type

### Key Patterns

- **Null sanitization**: `sanitizeNulls()` converts null→undefined recursively for Convex compatibility
- **`stripFences()`**: Removes markdown code fences from Claude responses before JSON parsing
- **Rate-limit retry**: `withRetry()` wraps all model calls with exponential backoff (5 retries, 2-32s + jitter) on 429/rate-limit errors
- **Concurrency control**: `pLimit(n)` utility limits parallel chunk extraction (no external dependency). Default concurrency is 2
- **Token tracking**: `onTokenUsage` callback on options objects reports `{ inputTokens, outputTokens }` after each model call
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
