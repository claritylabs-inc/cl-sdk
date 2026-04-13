# CL-SDK

Open infrastructure for building AI agents that work with insurance. Pure TypeScript, provider-agnostic — bring any LLM, any embedding model, any storage backend.

**[Documentation](https://cl-sdk.claritylabs.inc/docs)** | **[npm](https://www.npmjs.com/package/@claritylabs/cl-sdk)** | **[GitHub](https://github.com/claritylabs-inc/cl-sdk)**

## Installation

```bash
npm install @claritylabs/cl-sdk pdf-lib zod
```

## What It Does

- **Document Extraction** — Agentic pipeline with 11 focused extractors that turns insurance PDFs into structured data with page-level provenance, quality gates, and automatic declarations-to-schema promotion (limits, deductibles, locations, broker, loss payees, summary)
- **Query Agent** — Citation-backed question answering over stored documents and inbound photos/PDFs/text with sub-question decomposition and grounding verification
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

## Multimodal Querying

`createQueryAgent()` now accepts user-supplied attachments on each query. This is meant for flows like:

- an SMS user texting a photo of apartment damage
- a broker or insured emailing a COI or other PDF for context
- a caller pasting text from an email thread alongside a question

```typescript
import { createQueryAgent } from "@claritylabs/cl-sdk";

const agent = createQueryAgent({
  generateText,
  generateObject,
  documentStore,
  memoryStore,
});

const result = await agent.query({
  question: "What details do we still need, and does this relate to the stored policy?",
  conversationId: "conv-123",
  attachments: [
    {
      kind: "image",
      name: "damage.jpg",
      mimeType: "image/jpeg",
      base64: damagePhotoBase64,
    },
    {
      kind: "pdf",
      name: "coi.pdf",
      mimeType: "application/pdf",
      base64: coiPdfBase64,
    },
  ],
});
```

The query pipeline first interprets each attachment into structured evidence, then combines that with retrieved chunks, document lookups, and conversation history before answering.

Important: your `generateObject` callback must actually forward multimodal payloads from `providerOptions` to the model request:

- `providerOptions.attachments` for generic image/pdf/text inputs
- `providerOptions.pdfBase64` for PDF inputs
- `providerOptions.images` for image inputs

If your callback ignores those fields, the model will only see the text prompt.

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
