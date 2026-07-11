# CL-SDK

Deterministic insurance intelligence primitives for regulated AI agents.

**[Documentation](https://cl-sdk.claritylabs.inc/docs)** | **[npm](https://www.npmjs.com/package/@claritylabs/cl-sdk)** | **[GitHub](https://github.com/claritylabs-inc/cl-sdk)**

## Installation

```bash
npm install @claritylabs/cl-sdk pdf-lib zod
```

## What It Does

- **Document Extraction** — Source-tree extraction that turns parser-provided PDF spans into a canonical hierarchy of document, page group, form, endorsement, section, schedule, clause, table, row, cell, and text nodes. Form-inventory page ranges and parser title elements guide the hierarchy, but every node remains backed by real source spans. Operational policy facts are model-extracted, source-cited projections from that tree, not the canonical source of truth.
- **Source Grounding** — Shared source spans, source nodes, hierarchical table row/cell evidence, source stores, quoted evidence validation, and deterministic evidence ordering across extraction, query, application, PCE, and case workflows.
- **Query Agent** — Citation-backed question answering over stored source nodes, exact source spans, and inbound photos/PDFs/text with sub-question decomposition, bounded retrieval planning, attachment-only reasoning when retrieval is unnecessary, and grounding verification.
- **Application Processing** — Bounded workflows handle intake with deterministic planning — versioned question graphs, conditional/repeatable question projection, prior-answer backfill, context auto-fill, source-backed document backfill, topic-based question batching, reply parsing, context proposals, packet assembly, and PDF mapping helpers
- **Policy Change Endorsements** — PCE intake, evidence collection, missing-info handling, quality gates, execution mode selection, and reviewable submission packets
- **Case Workflows** — Shared primitives for evidence-backed proposals, missing information, validation issues, stable IDs, and packet artifacts
- **Agent System** — Composable prompt modules for building insurance-aware agents across email, chat, SMS, Slack, and Discord with human-reviewable behavior
- **Storage** — DocumentStore, MemoryStore, SourceStore, and ApplicationStore interfaces with reference implementations where appropriate

## Quick Start

```typescript
import { buildPageSourceSpans, createExtractor } from "@claritylabs/cl-sdk";

const extractor = createExtractor({
  generateObject: async ({ prompt, system, schema, maxTokens, taskKind, budgetDiagnostics, providerOptions }) => {
    const result = await yourProvider.generateStructured({ prompt, system, schema, maxTokens, taskKind, budgetDiagnostics, providerOptions });
    return { object: result.object, usage: result.usage };
  },
});

const sourceSpans = buildPageSourceSpans([
  { documentId: "policy-123", sourceKind: "policy_pdf", pageNumber: 1, text: pageOneText },
]);

const result = await extractor.extract(pdfBase64, "policy-123", { sourceSpans });
console.log(result.sourceTree);          // DocumentSourceNode[] canonical hierarchy
console.log(result.sourceSpans);         // SourceSpan[] smallest PDF evidence units
console.log(result.operationalProfile);  // Source-backed facts for policy lists, COIs, compliance
console.log(result.document);            // Compatibility InsuranceDocument projection
console.log(result.chunks);              // [] on v3 source-tree extraction paths
```

### Optional Docling input

If your host pre-processes a PDF with [Docling](https://github.com/docling-project/docling), pass the serialized `DoclingDocument` JSON instead of a PDF. CL-SDK does not install or run Python Docling; it consumes the parsed document, builds source spans, constructs the same source tree, and asks the configured model to extract operational facts with citations to those nodes and spans. Docling tables are represented as table, row, and cell source spans; row spans are treated as the canonical evidence for extracted table facts.

```typescript
const result = await extractor.extract({
  kind: "docling_document",
  document: doclingDocumentJson,
  sourceKind: "policy_pdf",
}, "policy-123");
```

## Source Grounding

Source spans are the smallest evidence layer. Build spans from PDF text, OCR, emails, attachments, or structured fields, then pass them into extraction and downstream workflows. The v3 extractor builds `DocumentSourceNode` hierarchy from those spans and returns an `operationalProfile` for product-critical facts:

```typescript
import { buildPageSourceSpans, MemorySourceStore, createExtractor } from "@claritylabs/cl-sdk";

const pageOneText = "..."; // text from your PDF text/OCR pipeline
const sourceSpans = buildPageSourceSpans([
  { documentId: "policy-123", sourceKind: "policy_pdf", pageNumber: 1, text: pageOneText },
]);

const sourceStore = new MemorySourceStore();
const extractor = createExtractor({ generateObject, sourceStore });

const result = await extractor.extract(pdfBase64, "policy-123", { sourceSpans });
```

When source spans are available, extraction returns `sourceTree`, `sourceSpans`, `operationalProfile`, `warnings`, `tokenUsage`, and `performanceReport`. The source tree is canonical for policy wording and hierarchy. The extractor groups parser-provided page, title, table, row, and text spans into declarations, policy forms, endorsements, sections, and schedules without running a separate form-inventory, page-map, or source-tree-organizer model call. The operational profile model receives a bounded packet of high-value declaration, schedule, premium, policy-party, operations-description, endorsement, and coverage evidence rather than the full document wording. The operational profile contains model-extracted policy metadata, ACORD `linesOfBusiness`, a source-backed insured operations description, policy-scoped parties and their available structured addresses, coverage units, nested coverage limit terms, deductibles/retentions, premiums, key dates, endorsement-support facts, and source-backed `declarationFacts` for named-insured identity details such as mailing address, DBA, entity type, tax ID, and additional named insured rows. Each fact keeps `sourceNodeIds` and `sourceSpanIds`. The compatibility document projection materializes complete named-insured, producer, and insurer addresses while partial and MGA/administrator addresses remain available in `operationalProfile.parties`. Source-backed identity records such as insurer, producer, contacts, named insured rows, endorsement parties, standalone insured addresses, and declaration facts must include non-empty `sourceSpanIds`. After extraction, a bounded model cleanup pass may keep, drop, or update existing coverage rows and terms by index; the SDK enforces the schema and rejects source IDs that are not present in the current source tree/spans. Endorsement schedules are modeled as whole endorsement coverage units with their own `limits[]` terms instead of unrelated flat rows like `Aggregate Limit`.

CL SDK 4.0 replaces the old `PolicyType` enum and operational-profile `policyTypes` field with ACORD line of business codes. Use `AcordLobCode`, `AcordLobCodeSchema`, `ACORD_LOB_CODES`, `ACORD_LOB_LABELS`, `LEGACY_POLICY_TYPE_TO_LOB`, `PERSONAL_LOB_CODES`, `normalizeOperationalLinesOfBusiness`, and `resolveOperationalProfileLinesOfBusiness`. Serialized legacy profiles with `policyTypes` are still accepted by `PolicyOperationalProfileSchema` and normalize to `linesOfBusiness`.

Store `result.sourceTree` in a retrievable node index and embed node `description` values for search. Keep `result.sourceSpans` as the exact PDF highlighting layer. `result.document` and its `documentOutline` remain compatibility projections for existing host screens; do not treat broad structured policy JSON as canonical extraction truth.

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
- `providerOptions.doclingText` for host-provided Docling document inputs
- `providerOptions.sourceSpans` and `providerOptions.sourceChunks` for source evidence when your host passes them through

If your callback ignores those fields, the model will only see the text prompt.

## Model routing metadata

Every SDK model callback may receive `taskKind`, `budgetDiagnostics`, and `trace`. Hosts can use these provider-agnostic fields for cheap-first routing, fallback, and telemetry without the SDK hardcoding model names. Example task kinds include `extraction_operational_profile`, `extraction_coverage_cleanup`, `query_reason`, `application_extract_fields`, and `pce_impact_analysis`. `budgetDiagnostics` includes the resolved output-token budget, preferred task budget, truncation-risk warnings, and any model/provider caps that constrained the current subtask. `maxOutputTokens` is treated as a ceiling, not a default request size, so small classifier and lookup calls stay small even on models with large output windows. `trace` identifies the current source-backed or workflow call so host logs can show what was being generated instead of a generic model-call label.

## Bounded Agentic Workflows

CL-SDK uses deterministic scaffolding with agentic decision points rather than fixed all-tools-all-the-time chains:

- Policy extraction requires caller-provided source spans and does not run the older form-inventory, page-map, focused-extractor, or source-tree-organizer model calls.
- Source-tree construction stays deterministic from parser spans; the model is used for the operational profile and optional coverage cleanup because those are end-user facts.
- Referential coverage resolution and application/query workflows still use bounded target-specific actions when those workflows need lookup or explanation steps.
- Formatting skips the LLM cleanup pass for plain prose and formats long or noisy markdown/table/list content in parallel batches outside the v3 source-span extraction path.
- Application processing plans optional backfill, context auto-fill, document search, batching, reply parsing, lookup, explanations, and next-batch email generation based on current active question state. Conditional fields that are not active are skipped until their parent answers trigger them.

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
