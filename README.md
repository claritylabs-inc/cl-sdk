[Clarity Labs](https://claritylabs.inc) is an applied AI research lab building the infrastructure for AI to work safely with insurance.

AI agents are already executing complex tasks autonomously across industries, but insurance requires context, safeguards, and systems that don't exist yet. CL-0 SDK fills that gap: a shared intelligence layer that any product or agent can import to understand, reason about, and act on insurance.

## Installation

```bash
npm install @claritylabs/cl-sdk
```

### Peer Dependencies

CL-0 SDK requires the [Vercel AI SDK](https://sdk.vercel.ai) and pdf-lib:

```bash
npm install ai pdf-lib
```

Then install a provider package for your model of choice:

```bash
# Anthropic
npm install @ai-sdk/anthropic

# OpenAI
npm install @ai-sdk/openai

# Google
npm install @ai-sdk/google
```

## Quick Start

### Uniform Model (same model for all passes)

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { extractFromPdf, createUniformModelConfig, applyExtracted } from "@claritylabs/cl-sdk";

const anthropic = createAnthropic();
const pdfBase64 = "..."; // base64-encoded PDF

const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(anthropic("claude-sonnet-4-6")),
});
const fields = applyExtracted(extracted);
```

### Any Provider

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { extractFromPdf, createUniformModelConfig } from "@claritylabs/cl-sdk";

const openai = createOpenAI();
const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(openai("gpt-4o")),
});
```

### Fine-Grained Model Config

Assign different models per pipeline role — use a fast model for classification/sections and a capable model for metadata/fallback:

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { extractFromPdf, type ModelConfig } from "@claritylabs/cl-sdk";

const anthropic = createAnthropic();
const models: ModelConfig = {
  classification: anthropic("claude-haiku-4-5-20251001"),  // fast, cheap
  metadata: anthropic("claude-sonnet-4-6"),                // capable
  sections: anthropic("claude-haiku-4-5-20251001"),        // fast, cheap
  sectionsFallback: anthropic("claude-sonnet-4-6"),        // capable (fallback)
  enrichment: anthropic("claude-haiku-4-5-20251001"),      // fast, cheap
};

const { extracted } = await extractFromPdf(pdfBase64, { models });
```

### Mixed Providers

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { extractFromPdf, type ModelConfig } from "@claritylabs/cl-sdk";

const anthropic = createAnthropic();
const openai = createOpenAI();

const models: ModelConfig = {
  classification: openai("gpt-4o-mini"),
  metadata: anthropic("claude-sonnet-4-6"),
  sections: openai("gpt-4o-mini"),
  sectionsFallback: anthropic("claude-sonnet-4-6"),
  enrichment: openai("gpt-4o-mini"),
};

const { extracted } = await extractFromPdf(pdfBase64, { models });
```

## What's Inside

### Document Extraction Pipeline

A multi-pass system that turns insurance PDFs into structured, queryable data:

- **Pass 0 — Classification**: Determines whether a document is a policy or a quote. Returns document type, confidence score, and supporting signals.
- **Pass 1 — Metadata Extraction**: Extracts high-level metadata — carrier, policy/quote number, dates, premium, insured name, coverage table with limits and deductibles. Includes an early persistence callback (`onMetadata`) so metadata is saved immediately, surviving downstream failures.
- **Pass 2 — Section Extraction**: Splits the document into page chunks (starting at 15 pages) and extracts structured sections in parallel (concurrency-limited, default 2). All model calls automatically retry on rate-limit errors with exponential backoff. Adaptive fallback: if a chunk's output is truncated (JSON parse failure), it re-splits into smaller chunks (10, then 5 pages), and escalates to the fallback model. Results are merged across chunks.
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
- **Model types** — `ModelConfig`, `createUniformModelConfig`

## API Reference

### Extraction

| Function | Description |
|----------|-------------|
| `classifyDocumentType(pdf, options)` | Classify document as policy or quote |
| `extractFromPdf(pdf, options)` | Full policy extraction (passes 1-3) |
| `extractQuoteFromPdf(pdf, options)` | Full quote extraction (passes 1-2) |
| `extractSectionsOnly(pdf, metadata, options)` | Retry pass 2 using saved metadata |
| `applyExtracted(extracted)` | Map extraction JSON to persistence fields |
| `applyExtractedQuote(extracted)` | Map quote extraction JSON to persistence fields |

### Options

```typescript
interface ExtractOptions {
  log?: LogFn;
  onMetadata?: (raw: string) => Promise<void>;
  models: ModelConfig;             // required — bring your own models
  metadataProviderOptions?: ProviderOptions;
  fallbackProviderOptions?: ProviderOptions;
  concurrency?: number;            // parallel chunk limit (default: 2)
  onTokenUsage?: (usage: TokenUsage) => void;
}

interface ExtractSectionsOptions {
  log?: LogFn;
  promptBuilder?: PromptBuilder;
  models: ModelConfig;             // required — bring your own models
  fallbackProviderOptions?: ProviderOptions;
  concurrency?: number;            // parallel chunk limit (default: 2)
  onTokenUsage?: (usage: TokenUsage) => void;
}

interface ClassifyOptions {
  log?: LogFn;
  models: ModelConfig;             // required — bring your own models
  onTokenUsage?: (usage: TokenUsage) => void;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
```

### Rate-Limit Resilience

All model calls automatically retry on rate-limit errors (HTTP 429 or "rate limit" in error message) with exponential backoff — up to 5 retries with delays of 2s, 4s, 8s, 16s, 32s (plus jitter). Non-rate-limit errors are re-thrown immediately.

### Parallel Chunk Extraction

Pass 2 section extraction processes page chunks in parallel with a configurable concurrency limit (default: 2). This balances throughput against rate limits. Sub-chunk retries on truncation are also parallelized.

```typescript
// Track token usage across all passes
let totalInput = 0, totalOutput = 0;

const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(yourModel),
  concurrency: 3,
  onTokenUsage: ({ inputTokens, outputTokens }) => {
    totalInput += inputTokens;
    totalOutput += outputTokens;
  },
});

console.log(`Total: ${totalInput} input, ${totalOutput} output tokens`);
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

Pure TypeScript — no framework dependencies. Peer dependencies on `ai` (Vercel AI SDK) and `pdf-lib`. Model-agnostic — bring any provider (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc.).
