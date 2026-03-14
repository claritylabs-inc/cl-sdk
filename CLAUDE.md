# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@claritylabs/cell` is an insurance intelligence engine — a pure TypeScript library for policy/quote extraction, application processing, and agent prompts. It uses the Anthropic Claude API and pdf-lib as peer dependencies.

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

- **Pass 0 (Classification)**: Haiku classifies document as policy or quote
- **Pass 1 (Metadata)**: Sonnet extracts high-level metadata (carrier, dates, premium, coverages). Includes `onMetadata?()` callback for early persistence — if pass 2 fails, metadata is already saved
- **Pass 2 (Sections)**: Chunked extraction with Haiku. Documents split into 15-page chunks; on JSON parse failure, re-splits to 10→5 pages, then falls back to Sonnet. `mergeChunkedSections()` combines results
- **Pass 3 (Enrichment)**: Haiku enriches supplementary fields (regulatory context, contacts) from raw text. Non-fatal

Separate flows exist for policies (`extractFromPdf`) vs quotes (`extractQuoteFromPdf`). `extractSectionsOnly()` retries pass 2 using saved metadata from a prior pass 1.

### Multi-Model Strategy

- `HAIKU_MODEL` = `claude-haiku-4-5-20251001` — classification, chunked sections, enrichment (~80% of calls)
- `SONNET_MODEL` = `claude-sonnet-4-6` — metadata extraction, fallback for large chunks

### PDF Operations (`src/extraction/pdf.ts`)

Two modes using pdf-lib:
- **AcroForm**: Detect fields (`getAcroFormFields`), fill and flatten (`fillAcroForm`)
- **Text Overlay**: Position text at percentage-based coordinates on flat PDFs (`overlayTextOnPdf`)

### Prompt System (`src/prompts/`)

Four prompt modules, each with static prompts and/or builder functions:
- `extraction.ts` — document classification, metadata, section extraction, enrichment
- `application.ts` — form field detection, auto-fill, question batching, answer parsing, PDF mapping
- `agent.ts` — policy assistant system prompt with modes (direct/cc/forward), document context scoring, conversation memory
- `classifier.ts` — email classification

### Type System (`src/types/`)

- `policy.ts` — `PolicyDocument`, `QuoteDocument`, coverages, sections, policy type labels/colors, insurance keywords
- `application.ts` — `FormField` (union of `SimpleField | TableField | DeclarationField`), `QuestionBatch`, type guards
- `industry.ts` — 16 industries with verticals for B2B context

### Key Patterns

- **Null sanitization**: `sanitizeNulls()` converts null→undefined recursively for Convex compatibility
- **`stripFences()`**: Removes markdown code fences from Claude responses before JSON parsing
- **Path alias**: `@/*` maps to `src/*` in tsconfig
- **Barrel exports**: `src/index.ts` exports ~104 items — all public API goes through here
