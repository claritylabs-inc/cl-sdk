# CL-SDK

Deterministic insurance intelligence primitives for regulated AI agents. Pure TypeScript, provider-agnostic — bring any LLM, any embedding model, any storage backend.

**[Documentation](https://cl-sdk.claritylabs.inc/docs)** | **[npm](https://www.npmjs.com/package/@claritylabs/cl-sdk)** | **[GitHub](https://github.com/claritylabs-inc/cl-sdk)**

## Installation

```bash
npm install @claritylabs/cl-sdk pdf-lib zod
```

## What It Does

- **Document Extraction** — Deterministic extraction pipeline with focused model calls that turns insurance PDFs into structured data with page-level provenance, quality gates, first-class definitions and covered reasons, referential coverage resolution, cost-aware formatting, and automatic declarations-to-schema promotion (limits, deductibles, locations, broker, loss payees, premium, taxes/fees, summary)
- **Source Grounding** — Shared source spans, source chunks, source stores, quoted evidence validation, and deterministic evidence ordering across extraction, query, application, PCE, and case workflows
- **Query Agent** — Citation-backed question answering over stored documents, source spans, and inbound photos/PDFs/text with sub-question decomposition, bounded retrieval planning, attachment-only reasoning when retrieval is unnecessary, and grounding verification
- **Application Processing** — Bounded workflows handle intake with deterministic planning — field extraction, prior-answer backfill, context auto-fill, document lookup gating, topic-based question batching, reply parsing, source-backed field provenance, and PDF mapping
- **Policy Change Endorsements** — PCE intake, evidence collection, missing-info handling, quality gates, execution mode selection, and reviewable submission packets
- **Case Workflows** — Shared primitives for evidence-backed proposals, missing information, validation issues, stable IDs, and packet artifacts
- **Agent System** — Composable prompt modules for building insurance-aware agents across email, chat, SMS, Slack, and Discord with human-reviewable behavior
- **Storage** — DocumentStore, MemoryStore, SourceStore, and ApplicationStore interfaces with reference implementations where appropriate

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
  concurrency: 3,
  pageMapConcurrency: 3,
  extractorConcurrency: 4,
  formatConcurrency: 2,
  reviewMode: "auto",
});

const result = await extractor.extract(pdfBase64);
console.log(result.document);     // Typed InsuranceDocument
console.log(result.chunks);       // DocumentChunk[] for vector storage
console.log(result.sourceSpans);  // SourceSpan[] when supplied by the host
console.log(result.reviewReport); // Quality gate results
```

## Source Grounding

Source spans are the v1 evidence layer. Build spans from PDF text, OCR, emails, attachments, or structured fields, then pass them into extraction and downstream workflows:

```typescript
import { buildPageSourceSpans, MemorySourceStore, createExtractor } from "@claritylabs/cl-sdk";

const pageOneText = "..."; // text from your PDF text/OCR pipeline
const sourceSpans = buildPageSourceSpans([
  { documentId: "policy-123", sourceKind: "policy_pdf", pageNumber: 1, text: pageOneText },
]);

const sourceStore = new MemorySourceStore();
const extractor = createExtractor({ generateText, generateObject, sourceStore });

const result = await extractor.extract(pdfBase64, "policy-123", { sourceSpans });
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
  sourceRetriever,
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
- `providerOptions.sourceSpans` and `providerOptions.sourceChunks` for source evidence when your host passes them through

If your callback ignores those fields, the model will only see the text prompt.

## Bounded Agentic Workflows

CL-SDK uses deterministic scaffolding with agentic decision points rather than fixed all-tools-all-the-time chains:

- Extraction page mapping and review choose focused follow-up extractors from the live extractor catalog. Definitions and covered reasons can fall back through section extraction when a focused run returns no usable records.
- Supplementary extraction runs only when page assignments, form inventory, existing extracted text, or review follow-up tasks indicate regulatory, claims, notice, cancellation, or contact facts are likely present.
- Referential coverage resolution tries cheap local section/form matches first, then uses bounded target-specific actions for declarations, schedules, sections, page-location lookup, or skip.
- Page mapping, focused extractors, referential lookup, and formatting use separate concurrency controls. Page-scoped PDF and image ranges are cached so overlapping extractor tasks do not repeatedly slice or render the same pages.
- Formatting skips the LLM cleanup pass for plain prose and formats long or noisy markdown/table/list content in parallel batches.
- `reviewMode: "auto"` skips the expensive LLM review pass when deterministic checks are clean and source spans are available. Use `"always"` for maximum review coverage or `"skip"` when the host owns quality review separately.
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
