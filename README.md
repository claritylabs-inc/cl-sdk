# CL-SDK

Open infrastructure for building AI agents that work with insurance. Pure TypeScript, provider-agnostic — bring any LLM, any embedding model, any storage backend.

**[Documentation](https://cl-sdk.claritylabs.inc/docs)** | **[npm](https://www.npmjs.com/package/@claritylabs/cl-sdk)** | **[GitHub](https://github.com/claritylabs-inc/cl-sdk)**

## Installation

```bash
npm install @claritylabs/cl-sdk pdf-lib zod
```

## What It Does

- **Document Extraction** — Agentic pipeline with 13 focused extractors that turns insurance PDFs into structured data with page-level provenance, quality gates, first-class definitions and covered reasons, referential coverage resolution, cost-aware formatting, and automatic declarations-to-schema promotion (limits, deductibles, locations, broker, loss payees, premium, taxes/fees, summary)
- **Query Agent** — Citation-backed question answering over stored documents and inbound photos/PDFs/text with sub-question decomposition, bounded retrieval planning, attachment-only reasoning when retrieval is unnecessary, and grounding verification
- **Application Processing** — Focused agents handle intake with bounded workflow planning — field extraction, prior-answer backfill, context auto-fill, document lookup gating, topic-based question batching, reply parsing, and PDF mapping
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

The query workflow first interprets each attachment into structured evidence, then uses the query classifier to decide whether stored-document retrieval is needed. Simple or attachment-only questions can skip retrieval and reason over the available evidence directly; document-backed questions still retrieve chunks, reason over citations, and run grounding verification. Verification can request targeted retry retrieval for weak sub-answers.

Important: your `generateObject` callback must actually forward multimodal payloads from `providerOptions` to the model request:

- `providerOptions.attachments` for generic image/pdf/text inputs
- `providerOptions.pdfBase64` for PDF inputs
- `providerOptions.images` for image inputs

If your callback ignores those fields, the model will only see the text prompt.

## Bounded Agentic Workflows

CL-SDK uses deterministic scaffolding with agentic decision points rather than fixed all-tools-all-the-time chains:

- Extraction page mapping and review choose focused follow-up extractors from the live extractor catalog. Definitions and covered reasons can fall back through section extraction when a focused run returns no usable records.
- Supplementary extraction runs only when page assignments, form inventory, existing extracted text, or review follow-up tasks indicate regulatory, claims, notice, cancellation, or contact facts are likely present.
- Referential coverage resolution tries cheap local section/form matches first, then uses bounded target-specific actions for declarations, schedules, sections, page-location lookup, or skip.
- Formatting skips the LLM cleanup pass for plain prose and only formats long or noisy content that looks likely to contain markdown, spacing, list, heading, or table artifacts.
- Application processing plans optional backfill, context auto-fill, document search, batching, reply parsing, lookup, explanations, and next-batch email generation based on current state.

These gates reduce unnecessary provider calls while preserving reliability for edge cases where additional focused extraction or retrieval is needed.

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
