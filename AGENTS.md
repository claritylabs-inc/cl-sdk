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
  extraction/     # Agentic extraction: coordinator, extractor, merge, assembler, formatter, chunking, pdf
  query/          # Agentic query: coordinator, retriever, reasoner, verifier
  application/    # Agentic application processing: coordinator, focused agents, store
  prompts/        # Prompt modules: coordinator/, extractors/, templates/, agent/, application/, query/
  storage/        # DocumentStore + MemoryStore interfaces, SQLite reference impl
  tools/          # Tool definitions
```

### Agentic Extraction Pipeline (`src/extraction/`)

The extraction system uses a coordinator/worker pattern with page-aware planning and merged worker outputs:

1. **Classify** (`coordinator.ts`): classify document type and policy types using `generateObject` + `ClassifyResultSchema`. The coordinator passes the full PDF via `providerOptions.pdfBase64`.
2. **Page map** (`prompts/coordinator/page-map.ts`): map each page to one or more focused extractors before building tasks. This replaces broad LLM-assigned mixed page ranges.
3. **Plan** (`coordinator.ts`): build deterministic extractor tasks from the page map. `prompts/coordinator/plan.ts` is a deprecated candidate and is no longer the active planning path.
4. **Extract** (`extractor.ts`): dispatch focused extractors in parallel. `runExtractor()` slices page ranges with `extractPageRange()` and passes the page-scoped PDF via `providerOptions.pdfBase64`, or `providerOptions.images` if `convertPdfToImages` is configured.
5. **Merge** (`merge.ts`): repeated extractor runs merge instead of overwrite. This matters for `coverage_limits`, `endorsements`, `exclusions`, `conditions`, `sections`, and `declarations`.
6. **Review** (`coordinator.ts` + `prompts/coordinator/review.ts`): review completeness and quality using the full PDF, the page-map summary, and a summary of extracted results. Review should catch generic placeholder outputs and missing declaration-grade values.
7. **Assemble** (`assembler.ts`): merge all extracted data into a final `InsuranceDocument`.
8. **Format** (`formatter.ts`): clean up markdown formatting in content-bearing fields.
9. **Chunk** (`chunking.ts`): break the formatted document into `DocumentChunk[]` for vector storage.

Entry point: `createExtractor(config)` returns `{ extract(pdfBase64, documentId?) }`.

### Provider Callbacks (`src/core/types.ts`)

Consumers provide plain callback functions:

- `GenerateText` — `(params: { prompt, system?, maxTokens, providerOptions? }) => Promise<{ text, usage? }>`
- `GenerateObject<T>` — `(params: { prompt, system?, schema: ZodSchema<T>, maxTokens, providerOptions? }) => Promise<{ object: T, usage? }>`
- `EmbedText` — `(text: string) => Promise<number[]>`
- `ConvertPdfToImagesFn` — `(pdfBase64, startPage, endPage) => Promise<Array<{ imageBase64, mimeType }>>`

Important extraction contract:

- `providerOptions.pdfBase64` carries document content for classify, page-map, review, and PDF-mode extractor calls
- `providerOptions.images` carries rendered page images for image-mode extractor calls
- the callback must translate those fields into actual file/image parts in the provider request
- if usage is omitted by the callback, extraction still works but `usageReporting.callsMissingUsage` will surface that gap

### Key Patterns

- **Merged extractor outputs**: do not assume a single extractor runs only once. The coordinator may dispatch follow-up tasks for the same extractor.
- **Page-aware planning**: preserve the `page-map` phase unless intentionally replacing it with something equally precise.
- **Review quality checks**: review is not just “are keys present”; it should catch generic form-language placeholders and weak extraction quality.
- **Strict schema compatibility**: `toStrictSchema()` auto-transforms Zod schemas before `generateObject` calls.
- **Safe generate**: `safeGenerateObject()` wraps `generateObject` with retry, strictification, and optional fallbacks.
- **Token tracking**: `tokenUsage` aggregates available usage values; `usageReporting` tells you how many calls did or did not report usage.

## Releases

Versioning and publishing are automated via `semantic-release`. Pushing to `master` triggers release automation for this repo.
