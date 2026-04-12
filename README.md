# CL-SDK

Open infrastructure for building AI agents that work with insurance. Pure TypeScript, provider-agnostic — bring any LLM, any embedding model, any storage backend.

**[Documentation](https://cl-sdk.claritylabs.inc/docs)** | **[npm](https://www.npmjs.com/package/@claritylabs/cl-sdk)** | **[GitHub](https://github.com/claritylabs-inc/cl-sdk)**

## Installation

```bash
npm install @claritylabs/cl-sdk pdf-lib zod
```

## What It Does

- **Document Extraction** — Agentic pipeline with 11 focused extractors that turns insurance PDFs into structured data with page-level provenance and quality gates
- **Query Agent** — Citation-backed question answering over stored documents with sub-question decomposition and grounding verification
- **Application Processing** — Eight focused agents handle intake — field extraction, auto-fill from prior answers, topic-based question batching, and PDF mapping
- **Agent System** — Composable prompt modules for building insurance-aware conversational agents across email, chat, SMS, Slack, and Discord
- **Storage** — DocumentStore and MemoryStore interfaces with SQLite reference implementation

## Quick Start

```typescript
import { createExtractor } from "@claritylabs/cl-sdk";

const extractor = createExtractor({
  generateText: async ({ prompt, system, maxTokens, providerOptions }) => {
    const result = await yourProvider.generate({ prompt, system, maxTokens, providerOptions });
    return { text: result.text, usage: result.usage };
  },
  generateObject: async ({ prompt, system, schema, maxTokens, providerOptions }) => {
    // Pass providerOptions.pdfBase64 and/or providerOptions.images to your model
    const result = await yourProvider.generateStructured({ prompt, system, schema, maxTokens, providerOptions });
    return { object: result.object, usage: result.usage };
  },
});

const result = await extractor.extract(pdfBase64);
console.log(result.document);     // Typed InsuranceDocument
console.log(result.chunks);       // DocumentChunk[] for vector storage
console.log(result.reviewReport); // Quality gate results
```

See the [full documentation](https://cl-sdk.claritylabs.inc/docs) for architecture, provider setup, API reference, and more.

## Development

```bash
npm install
npm run build      # ESM + CJS + types via tsup
npm run dev        # Watch mode
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

Zero framework dependencies. Peer deps: `pdf-lib`, `zod`. Optional: `better-sqlite3`.

## License

Apache-2.0
