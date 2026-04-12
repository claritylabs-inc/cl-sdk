---
name: v6 agentic refactor
description: Major refactor in progress — removing Vercel AI SDK, adding agentic extraction, Zod schemas, storage layer
type: project
---

cl-sdk v6 is a clean-break major version refactor. Key decisions:

- Remove `ai` (Vercel AI SDK) peer dependency entirely — use plain `GenerateText`/`GenerateObject` callbacks instead of `LanguageModel`
- Replace fixed 4-pass pipeline with agentic coordinator/worker extraction
- Convert all TypeScript interfaces to Zod schemas (types derived via `z.infer`)
- Add `DocumentStore` + `MemoryStore` interfaces with SQLite reference implementation
- Add document chunking for vector retrieval
- Add conversation memory for agent state across turns
- Document-type templates (hybrid approach) guide the coordinator

**Why:** Consumer flexibility (any provider stack), better extraction accuracy (focused small prompts), persistent memory for agents

**How to apply:** All v5 exports are removed. New entry point is `createExtractor({ generateText, generateObject })`. Spec at `docs/superpowers/specs/2026-04-11-v6-agentic-refactor-design.md`, plan at `docs/superpowers/plans/2026-04-11-v6-agentic-refactor.md`.
