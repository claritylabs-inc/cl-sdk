[Clarity Labs](https://claritylabs.inc) is an applied AI research lab building the infrastructure for AI to work safely with insurance.

AI agents are already executing complex tasks autonomously across industries, but insurance requires context, safeguards, and systems that don't exist yet. Cell fills that gap: a shared intelligence layer that any product or agent can import to understand, reason about, and act on insurance.

## Installation

```bash
npm install @claritylabs-inc/cell
```

### Peer Dependencies

Cell requires the [Vercel AI SDK](https://sdk.vercel.ai) and pdf-lib:

```bash
npm install ai pdf-lib
```

Then install a provider package for your model of choice:

```bash
# Anthropic (default)
npm install @ai-sdk/anthropic

# OpenAI
npm install @ai-sdk/openai

# Google
npm install @ai-sdk/google
```

## Quick Start

### Default (Anthropic)

```typescript
import { classifyDocumentType, extractFromPdf, applyExtracted } from "@claritylabs-inc/cell";

const pdfBase64 = "..."; // base64-encoded PDF

// Classify + extract with default Anthropic models
const { documentType } = await classifyDocumentType(pdfBase64);
const { extracted } = await extractFromPdf(pdfBase64);
const fields = applyExtracted(extracted);
```

No model configuration needed — `createDefaultModelConfig()` is called automatically, using `@ai-sdk/anthropic` under the hood.

### Custom Models

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { extractFromPdf, createUniformModelConfig } from "@claritylabs-inc/cell";

const anthropic = createAnthropic();

// Use the same model for every pipeline pass
const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(anthropic("claude-sonnet-4-6")),
});
```

### Any Provider

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { extractFromPdf, createUniformModelConfig } from "@claritylabs-inc/cell";

const openai = createOpenAI();
const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(openai("gpt-4o")),
  metadataProviderOptions: {},  // disable Anthropic-specific thinking
});
```

### Fine-Grained Model Config

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { extractFromPdf, type ModelConfig } from "@claritylabs-inc/cell";

const anthropic = createAnthropic();
const models: ModelConfig = {
  classification: anthropic("claude-haiku-4-5-20251001"),
  metadata: anthropic("claude-sonnet-4-6"),
  sections: anthropic("claude-haiku-4-5-20251001"),
  sectionsFallback: anthropic("claude-sonnet-4-6"),
  enrichment: anthropic("claude-haiku-4-5-20251001"),
};

const { extracted } = await extractFromPdf(pdfBase64, { models });
```

## What's Inside

### Document Extraction Pipeline

A multi-pass system that turns insurance PDFs into structured, queryable data:

- **Pass 0 — Classification**: Determines whether a document is a policy or a quote. Returns document type, confidence score, and supporting signals.
- **Pass 1 — Metadata Extraction**: Extracts high-level metadata — carrier, policy/quote number, dates, premium, insured name, coverage table with limits and deductibles. Includes an early persistence callback (`onMetadata`) so metadata is saved immediately, surviving downstream failures.
- **Pass 2 — Section Extraction**: Splits the document into page chunks (starting at 15 pages) and extracts structured sections. Adaptive fallback: if a chunk's output is truncated (JSON parse failure), it re-splits into smaller chunks (10, then 5 pages), and escalates to the fallback model. Results are merged across chunks.
- **Pass 3 — Enrichment**: A non-fatal pass that parses raw text into structured supplementary fields — regulatory context, complaint contacts, costs and fees, claims contacts.

For quotes specifically, the pipeline also extracts premium breakdowns, subjectivities (conditions that must be met before binding), and underwriting conditions.

### Application Processing

End-to-end insurance application handling — from blank PDF to filled form:

- **Application detection** — classifies whether a PDF is an insurance application form
- **Field extraction** — reads every fillable field as structured data (text, numeric, currency, date, yes/no, table, and declaration fields)
- **Auto-fill** — matches extracted fields against known business context to pre-populate answers
- **Question batching** — organizes unfilled fields into topic-based batches for emailing the insured
- **Answer parsing** — parses free-text replies back into structured field values
- **PDF filling** — maps answers back onto the original PDF, supporting both AcroForm and flat PDF overlay

### Agent System

A composable prompt system that powers conversational AI across platforms:

- **Multi-platform support** — email, chat, SMS, Slack, Discord with platform-aware formatting
- **Communication intents** — direct (user-facing), mediated (forwarded), observed (CC'd)
- **Composable modules** — identity, safety, formatting, coverage gaps, COI routing, quotes-vs-policies, conversation memory, and intent-specific instructions
- **`buildAgentSystemPrompt(ctx)`** — composes all modules into a complete system prompt
- **Document context builder** — scores and ranks policies/quotes by relevance to a query
- **Tool definitions** — `tool_use`-compatible schemas for document lookup, COI generation, and coverage comparison

### Intent Classification

Platform-agnostic message classification with `buildClassifyMessagePrompt(platform)` — determines whether an incoming message is insurance-related and suggests an intent.

### Insurance Domain Types

Comprehensive TypeScript type system for the insurance domain:

- **Document types** — `PolicyDocument`, `QuoteDocument`, and `InsuranceDocument` discriminated union
- **Platform types** — `Platform`, `CommunicationIntent`, `PlatformConfig`, `AgentContext`
- **Model types** — `ModelConfig`, `createUniformModelConfig`, `createDefaultModelConfig`

## API Reference

### Extraction

| Function | Description |
|----------|-------------|
| `classifyDocumentType(pdf, options?)` | Classify document as policy or quote |
| `extractFromPdf(pdf, options?)` | Full policy extraction (passes 1-3) |
| `extractQuoteFromPdf(pdf, options?)` | Full quote extraction (passes 1-2) |
| `extractSectionsOnly(pdf, metadata, options?)` | Retry pass 2 using saved metadata |
| `applyExtracted(extracted)` | Map extraction JSON to persistence fields |
| `applyExtractedQuote(extracted)` | Map quote extraction JSON to persistence fields |

### Options

```typescript
interface ExtractOptions {
  log?: LogFn;
  onMetadata?: (raw: string) => Promise<void>;
  models?: ModelConfig;
  metadataProviderOptions?: ProviderOptions;
  fallbackProviderOptions?: ProviderOptions;
}

interface ClassifyOptions {
  log?: LogFn;
  models?: ModelConfig;
}
```

### Agent

| Function | Description |
|----------|-------------|
| `buildAgentSystemPrompt(ctx)` | Full system prompt from `AgentContext` |
| `buildDocumentContext(docs, query)` | Ranked document context for a query |
| `buildClassifyMessagePrompt(platform)` | Intent classification prompt |

### PDF Operations

| Function | Description |
|----------|-------------|
| `getAcroFormFields(pdfBytes)` | Detect fillable form fields |
| `fillAcroForm(pdfBytes, mappings)` | Fill and flatten form fields |
| `overlayTextOnPdf(pdfBytes, overlays)` | Position text on flat PDFs |

## Development

```bash
npm install
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode
npm run typecheck  # Type check (tsc --noEmit)
```

Pure TypeScript — no framework dependencies. Peer dependencies on `ai` (Vercel AI SDK) and `pdf-lib`. The `@ai-sdk/anthropic` provider is optional (needed only for `createDefaultModelConfig()`).
