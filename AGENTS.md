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
  extraction/     # Agentic extraction: coordinator, planning, focused dispatch, referential workflow, formatter, chunking, pdf
  query/          # Agentic query: coordinator, workflow planner, retriever, reasoner, verifier
  application/    # Agentic application processing: coordinator, workflow planner, focused agents, store
  prompts/        # Prompt modules: coordinator/, extractors/, templates/, agent/, application/, query/
  storage/        # DocumentStore + MemoryStore interfaces, SQLite reference impl
  tools/          # Tool definitions
```

### Agentic Extraction Pipeline (`src/extraction/`)

The extraction system uses a coordinator/worker pattern with page-aware planning and merged worker outputs:

1. **Classify** (`coordinator.ts`): classify document type and policy types using `generateObject` + `ClassifyResultSchema`. The coordinator passes the full PDF via `providerOptions.pdfBase64`.
2. **Page map** (`prompts/coordinator/page-map.ts`): map each page to one or more focused extractors before building tasks. This replaces broad LLM-assigned mixed page ranges.
3. **Plan** (`coordinator.ts`): build deterministic extractor tasks from the page map. `prompts/coordinator/plan.ts` is a deprecated candidate and is no longer the active planning path.
4. **Extract** (`extractor.ts`, `focused-dispatch.ts`): dispatch focused extractors in parallel. `runExtractor()` slices page ranges with `extractPageRange()` and passes the page-scoped PDF via `providerOptions.pdfBase64`, or `providerOptions.images` if `convertPdfToImages` is configured. Focused extractors can declare fallback behavior; definitions and covered reasons fall back through section extraction when no usable records are produced.
5. **Merge** (`merge.ts`): repeated extractor runs merge instead of overwrite. This matters for `coverage_limits`, `endorsements`, `exclusions`, `conditions`, `sections`, and `declarations`.
6. **Supplementary gating** (`coordinator.ts`): supplementary extraction is conditional. It runs when page assignments, form inventory, existing extracted text, or review follow-up tasks indicate regulatory, claims, notice, cancellation/nonrenewal, contact, or TPA facts are likely present.
7. **Referential resolution** (`resolve-referential.ts`, `referential-workflow.ts`): resolve referential coverage values with cheap local section/form matches first, then bounded target-specific actions for declarations, schedules, sections, page-location lookup, or skip.
8. **Review** (`coordinator.ts` + `prompts/coordinator/review.ts`): review completeness and quality using the full PDF, the page-map summary, the live extractor catalog, and a summary of extracted results. Review should catch generic placeholder outputs and missing declaration-grade values, and can request follow-up tasks from registered extractors.
9. **Assemble** (`assembler.ts`): merge all extracted data into a final `InsuranceDocument`.
10. **Format** (`formatter.ts`): cost-aware markdown cleanup for content-bearing fields. Plain prose skips the LLM formatting pass; long/noisy markdown, list, heading, spacing, or table-like content is formatted.
11. **Chunk** (`chunking.ts`): break the formatted document into `DocumentChunk[]` for vector storage.

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
- **Bounded agentic workflows**: prefer deterministic scaffolding with agentic decision points. Use workflow planners/gates to avoid unnecessary extractor, retrieval, lookup, or formatting calls while preserving follow-up paths for edge cases.
- **Review quality checks**: review is not just “are keys present”; it should catch generic form-language placeholders and weak extraction quality, then request focused follow-up tasks from the registered extractor catalog.
- **Strict schema compatibility**: `toStrictSchema()` auto-transforms Zod schemas before `generateObject` calls.
- **Safe generate**: `safeGenerateObject()` wraps `generateObject` with retry, strictification, and optional fallbacks.
- **Token tracking**: `tokenUsage` aggregates available usage values; `usageReporting` tells you how many calls did or did not report usage.

### Query and Application Workflows

- `src/query/workflow.ts` plans query actions. Retrieval is skipped when classification says document/chunk lookup is unnecessary, including attachment-only or general questions. Verification can still request targeted retrieval/reasoning retries when evidence is weak.
- `src/application/workflow.ts` plans optional application actions. Backfill, context auto-fill, document search, batching, lookup, answer parsing, explanations, and next-batch email generation are gated by current state and available stores/context.
- `src/core/workflow.ts` contains generic action/budget helpers for future bounded workflows.

## Releases

Versioning and publishing are automated via `semantic-release`. Pushing to `master` triggers release automation for this repo.
