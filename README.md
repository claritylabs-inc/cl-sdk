# Cell

Cell is the intelligence engine behind [Clarity Labs](https://claritylabs.inc). It's a pure TypeScript library that encodes everything Clarity knows about insurance: how to read policies, how to extract structured data from messy PDFs, how to reason about coverage, and how to talk to humans about their insurance.

Clarity Labs builds AI-native tools for commercial insurance that let businesses manage their coverage through email, SMS, and chat — generating certificates in minutes, flagging renewals, answering coverage questions, and handling due diligence, all without requiring in-house insurance expertise.

Cell is the shared intelligence layer that makes all of this possible. Any product we build imports Cell and gets the full depth of our insurance intelligence out of the box.

## What's in Cell

### Document Extraction Pipeline

A multi-pass system that turns insurance PDFs into structured, queryable data:

- **Pass 0 — Classification**: Determines whether a document is a policy or a quote using a fast classification call (Haiku). Returns document type, confidence score, and supporting signals.

- **Pass 1 — Metadata Extraction**: Extracts high-level metadata with Sonnet — carrier, policy/quote number, effective and expiration dates, premium, insured name, coverage table with limits and deductibles, and page count. Includes an early persistence callback (`onMetadata`) so metadata is saved immediately, surviving downstream failures.

- **Pass 2 — Section Extraction**: Splits the document into page chunks (starting at 15 pages) and extracts structured sections with Haiku. Each section gets a type (declarations, insuring agreement, endorsement, exclusion, schedule, etc. for policies; terms summary, premium indication, subjectivity, coverage summary, etc. for quotes), title, page range, and full content. Adaptive fallback: if a chunk's output is truncated (JSON parse failure), it re-splits into smaller chunks (10, then 5 pages), and escalates to Sonnet as a final fallback. Results are merged across chunks.

- **Pass 3 — Enrichment**: A non-fatal pass that parses raw text blobs from the document into structured supplementary fields — regulatory context, complaint contacts, costs and fees, claims contacts.

For quotes specifically, the pipeline also extracts premium breakdowns, subjectivities (conditions that must be met before binding), and underwriting conditions.

### Application Processing

End-to-end insurance application handling — from blank PDF to filled form:

- **Application detection** — classifies whether a PDF is an insurance application form (vs. a policy, quote, certificate, etc.)
- **Field extraction** — reads every fillable field from the form as structured data (text, numeric, currency, date, yes/no, table, and declaration fields), handling grouped checkboxes, conditional fields, and complex table layouts
- **Auto-fill** — matches extracted fields against known business context to pre-populate answers
- **Question batching** — organizes unfilled fields into topic-based batches for emailing the insured, generating natural-language emails that ask for the information needed
- **Answer parsing** — parses free-text email replies back into structured field values, with intent classification (answers, questions, lookup requests, or mixed)
- **PDF filling** — maps answers back onto the original PDF, supporting both AcroForm (fillable form fields) and flat PDF overlay (text at percentage-based coordinates)
- **Field explanation** — explains what a specific field means in plain language when a user asks

### Agent System

The prompt and context system that powers our products' conversational abilities:

- **System prompt builder** — configurable for three communication modes: direct (user in-app), CC'd (user CC'd on customer email), and forwarded (user forwards a customer email to be handled). Includes coverage gap guidelines, COI request routing, quotes-vs-policies distinction, and prompt injection defenses.
- **Document context builder** — given a user's query and their full policy/quote portfolio, scores and ranks documents by relevance, selects the most relevant ones, and assembles a context window with coverage summaries, section content, and page references. Handles both policies and quotes with different scoring logic.
- **Conversation memory** — pulls past conversation threads from the organization to provide continuity across interactions, with character-limited formatting.

### Email Classification

Detects whether an inbound email is insurance-related (policies, renewals, certificates, endorsements, binders, premium notices) for routing and triage.

### Insurance Domain Types

Comprehensive TypeScript type system for the insurance domain:

- **Policy and quote document types** — full interfaces for `PolicyDocument` and `QuoteDocument` including coverages, sections with subsections, regulatory context, and quote-specific fields (subjectivities, underwriting conditions, premium breakdowns)
- **Application form types** — `FormField` union type covering simple fields, table fields, and declaration fields, with type guards
- **Industry taxonomy** — 16 industries with verticals (e.g. agriculture > crop farming, livestock, aquaculture) for B2B context
- **Domain constants** — policy type labels, section type labels with color mappings, insurance keywords, and carrier name patterns

## Usage

```typescript
import {
  // Extraction
  extractFromPdf,
  extractQuoteFromPdf,
  classifyDocumentType,

  // Agent
  buildSystemPrompt,
  buildDocumentContext,

  // Application processing
  buildFieldExtractionPrompt,
  buildAutoFillPrompt,

  // PDF operations
  fillAcroForm,
  overlayTextOnPdf,

  // Types
  type PolicyDocument,
  type QuoteDocument,
  type FormField,
} from "@claritylabs/cell";
```

## Development

```bash
npm install
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode
npm run typecheck  # Type check (tsc --noEmit)
```

Pure TypeScript — no framework dependencies. Peer dependencies on `@anthropic-ai/sdk` and `pdf-lib`.
