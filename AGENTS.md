# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Overview

`@claritylabs/cl-sdk` (CL-SDK) is an open infrastructure layer for building AI agents that work with insurance. It is a pure TypeScript library for policy/quote extraction, application processing, query workflows, and agent prompts. It is provider-agnostic via plain callback functions (`GenerateText`, `GenerateObject`) and uses Zod schemas as the source of truth for runtime validation and TypeScript types.

## Commands

```bash
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode (tsup --watch)
npm run typecheck  # Type check only (tsc --noEmit)
npm test           # Run vitest
```

## Architecture

### File Structure

```
src/
  core/           # Provider-agnostic types, retry, concurrency, utilities
  schemas/        # Zod schemas (source of truth for all types)
  extraction/     # Source-tree extraction coordinator, operational profile projection, legacy fallback, pdf helpers
  query/          # Agentic query: coordinator, workflow planner, retriever, reasoner, verifier
  application/    # Agentic application processing: coordinator, workflow planner, focused agents, store
  prompts/        # Prompt modules: coordinator/, extractors/, templates/, agent/, application/, query/
  storage/        # DocumentStore + MemoryStore interfaces, SQLite reference impl
  tools/          # Tool definitions
```

### Source-Tree Extraction Pipeline (`src/extraction/`, `src/source/`)

The primary extraction path is v3 source-tree extraction when source spans are available:

1. **Normalize parser input**: hosts pass parser-neutral `SourceSpan[]` from LiteParse, Docling, PDF.js, OCR, or another parser. Spans carry page ranges, table row/cell metadata, parent span IDs, stable text hashes, and optional bounding boxes.
2. **Build source tree** (`source/tree.ts`): deterministic construction creates `DocumentSourceNode[]` for document, page, page group/form/endorsement/section/schedule/clause, table, row, cell, and text levels. Nodes preserve `sourceSpanIds`, page range, bbox, order, and hierarchy path.
3. **Organize labels/groups** (`extraction/source-tree-extractor.ts`): a small model pass may relabel existing nodes or group adjacent existing nodes. It cannot invent node IDs, text, pages, source spans, or bbox locations.
4. **Operational profile** (`source/operational-profile.ts`): deterministic heuristics plus a bounded model pass extract only product-critical facts: policy metadata, parties, coverage lines, limits, deductibles, premiums, key dates, and endorsement support. Uncited facts are rejected.
5. **Compatibility projection** (`source-tree-extractor.ts`): `result.document`, `documentMetadata`, and `documentOutline` are materialized views over `sourceTree` and `operationalProfile`; `result.chunks` is empty on v3 paths.
6. **Legacy fallback** (`coordinator.ts`): if no source spans are available, the older classify/page-map/focused-extractor pipeline can still run, but new production hosts should provide source spans and treat the source tree as canonical.

Entry point: `createExtractor(config)` returns `{ extract(pdfBase64, documentId?, { sourceSpans }) }`. On v3 paths, the result includes `sourceTree`, `sourceSpans`, `operationalProfile`, `warnings`, `tokenUsage`, and `performanceReport`.

### Provider Callbacks (`src/core/types.ts`)

Consumers provide plain callback functions:

- `GenerateText` — `(params: { prompt, system?, maxTokens, providerOptions? }) => Promise<{ text, usage? }>`
- `GenerateObject<T>` — `(params: { prompt, system?, schema: ZodSchema<T>, maxTokens, providerOptions? }) => Promise<{ object: T, usage? }>`
- `EmbedText` — `(text: string) => Promise<number[]>`
- `ConvertPdfToImagesFn` — `(pdfBase64, startPage, endPage) => Promise<Array<{ imageBase64, mimeType }>>`

Important extraction contract:

- `providerOptions.pdfBase64` carries document content for classify, page-map, review, and PDF-mode extractor calls
- `providerOptions.images` carries rendered page images for image-mode extractor calls
- `providerOptions.sourceSpans` carries source evidence; source-tree organizer and operational-profile prompts may label/group or extract only from existing source node/span IDs
- the callback must translate those fields into actual file/image parts in the provider request
- if usage is omitted by the callback, extraction still works but `usageReporting.callsMissingUsage` will surface that gap
- callbacks may receive `trace` metadata identifying extractor/page range or formatting batch; hosts should preserve it in model-call telemetry

### Key Patterns

- **Parser-grounded hierarchy**: source tree nodes may be reorganized only around existing source node IDs and source span IDs.
- **Operational profile as projection**: policy facts used by products must cite source nodes/spans and should not become the canonical source of wording.
- **Legacy fallback isolation**: keep old focused extraction available only for no-source-span inputs; do not expand it as the primary path.
- **Bounded agentic workflows**: prefer deterministic scaffolding with agentic decision points. Use workflow planners/gates to avoid unnecessary extractor, retrieval, lookup, or formatting calls while preserving follow-up paths for edge cases.
- **Strict schema compatibility**: `toStrictSchema()` auto-transforms Zod schemas before `generateObject` calls.
- **Safe generate**: `safeGenerateObject()` wraps `generateObject` with retry, strictification, and optional fallbacks.
- **Output token caps**: `resolveModelBudget()` treats task budgets as preferences/diagnostics. When model capabilities provide `maxOutputTokens`, use that model maximum as the request cap so extraction does not truncate just because a cheap task preference was too low. Only explicit hard constraints should lower the cap.
- **Token tracking**: `tokenUsage` aggregates available usage values; `usageReporting` tells you how many calls did or did not report usage.

### Query and Application Workflows

- `src/query/workflow.ts` plans query actions. Retrieval is skipped when classification says document lookup is unnecessary, including attachment-only or general questions. When retrieval is needed, `SourceRetriever.searchSourceNodes` is preferred; it returns hierarchy-expanded source-node packets with exact source spans for citations.
- `src/application/workflow.ts` plans optional application actions. Backfill, context auto-fill, document search, batching, lookup, answer parsing, explanations, and next-batch email generation are gated by current state and available stores/context.
- `src/core/workflow.ts` contains generic action/budget helpers for future bounded workflows.

## Releases

Versioning and publishing are automated via `semantic-release`. Pushing to `master` triggers release automation for this repo.
