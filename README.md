# CL-0 SDK

[Clarity Labs](https://claritylabs.inc) allows insurers to understand their clients as well as they know themselves. Having a better understanding of clients means insurers can automate servicing to reduce costs and identify coverage gaps to cross-sell products.

CL-0 SDK is the open infrastructure layer that makes this possible: a shared intelligence system that any product or agent can import to understand, reason about, and act on insurance documents and workflows.

## Installation

```bash
npm install @claritylabs/cl-sdk
```

### Peer Dependencies

CL-0 SDK requires the [AI SDK](https://sdk.vercel.ai) (from Vercel) and pdf-lib:

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
import { extractFromPdf, createUniformModelConfig } from "@claritylabs/cl-sdk";

const anthropic = createAnthropic();
const pdfBase64 = "..."; // base64-encoded PDF

const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(anthropic("claude-sonnet-4-6")),
});
```

### Any Provider

CL-0 SDK is provider-agnostic — PDFs are sent as native files by default, which most providers support (Anthropic, Google, OpenAI, Mistral, Bedrock, Azure):

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import { extractFromPdf, createUniformModelConfig } from "@claritylabs/cl-sdk";

const openai = createOpenAI();
const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(openai("gpt-4o")),
});
```

If your model doesn't support native PDF input, set `pdfContentFormat: "image"` and provide a `convertPdfToImages` callback:

```typescript
const { extracted } = await extractFromPdf(pdfBase64, {
  models: createUniformModelConfig(yourModel),
  pdfContentFormat: "image",
  convertPdfToImages: async (pdfBase64, startPage, endPage) => {
    // Return one { imageBase64, mimeType } per page
    return pages;
  },
});
```

### Fine-Grained Model Config

Assign different models per pipeline role:

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { extractFromPdf, type ModelConfig } from "@claritylabs/cl-sdk";

const anthropic = createAnthropic();
const models: ModelConfig = {
  classification: anthropic("claude-haiku-4-5"),   // fast, cheap
  metadata: anthropic("claude-sonnet-4-6"),        // capable
  sections: anthropic("claude-haiku-4-5"),         // fast, cheap
  sectionsFallback: anthropic("claude-sonnet-4-6"), // capable (fallback)
  enrichment: anthropic("claude-haiku-4-5"),       // fast, cheap
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

A multi-pass system that turns insurance PDFs into structured data:

- **Pass 0 — Classification**: Determines document type (policy/quote) with confidence score
- **Pass 1 — Metadata Extraction**: Extracts carrier, dates, premium, coverages. Includes `onMetadata` callback for early persistence
- **Pass 2 — Section Extraction**: Processes page chunks in parallel (configurable concurrency) with adaptive fallback on truncation
- **Pass 3 — Enrichment**: Non-fatal pass for supplementary fields (regulatory context, contacts, fees)

For quotes: also extracts premium breakdowns, subjectivities, and underwriting conditions.

### Application Processing

End-to-end insurance application handling:

- **Application detection** — classifies PDF as insurance application form
- **Field extraction** — reads all fillable fields (text, numeric, currency, date, yes/no, table)
- **Auto-fill** — matches fields against business context to pre-populate
- **Question batching** — organizes unfilled fields for emailing the insured
- **Answer parsing** — parses free-text replies into structured values
- **PDF filling** — fills both AcroForm and flat PDFs

### Agent System

Composable prompt system for conversational AI:

- **Multi-platform support** — email, chat, SMS, Slack, Discord
- **Communication intents** — direct, mediated, observed
- **Composable modules** — identity, safety, formatting, coverage gaps, COI routing, conversation memory
- **Document context builder** — ranks policies/quotes by relevance
- **Tool definitions** — schemas for document lookup, COI generation, coverage comparison

### Insurance Domain Types

Comprehensive TypeScript types:

- **Documents** — `PolicyDocument`, `QuoteDocument`, `InsuranceDocument` (discriminated union)
- **Declarations** — typed unions for 20+ line types (Homeowners, Auto, GL, Property, etc.)
- **Coverages** — enriched coverage with limits, deductibles, sublimits
- **Endorsements, Exclusions, Conditions**
- **Financial** — payment plans, premiums, fees
- **Platform** — `Platform`, `CommunicationIntent`, `AgentContext`
- **Models** — `ModelConfig`, `TokenLimits`, `PdfContentFormat`

## API Reference

### Extraction Functions

| Function | Description |
|----------|-------------|
| `classifyDocumentType(pdf, options)` | Classify document as policy or quote |
| `extractFromPdf(pdf, options)` | Full policy extraction (passes 0-3) |
| `extractQuoteFromPdf(pdf, options)` | Full quote extraction (passes 0-2) |
| `extractSectionsOnly(pdf, metadata, options)` | Retry pass 2 using saved metadata |
| `applyExtracted(extracted)` | Map extraction to persistence fields |
| `applyExtractedQuote(extracted)` | Map quote extraction to persistence fields |

### Extraction Options

```typescript
interface ExtractOptions {
  models: ModelConfig;                    // required
  log?: LogFn;
  onMetadata?: (raw: string) => Promise<void>;
  metadataProviderOptions?: ProviderOptions;
  fallbackProviderOptions?: ProviderOptions;
  concurrency?: number;                   // default: 2
  tokenLimits?: TokenLimits;
  onTokenUsage?: (usage: TokenUsage) => void;
  pdfContentFormat?: "file" | "image";    // default: "file"
  convertPdfToImages?: ConvertPdfToImagesFn;
}

interface ModelConfig {
  classification: LanguageModel;   // Pass 0
  metadata: LanguageModel;         // Pass 1
  sections: LanguageModel;         // Pass 2
  sectionsFallback: LanguageModel; // Pass 2 fallback
  enrichment: LanguageModel;       // Pass 3
}

interface TokenLimits {
  classification?: number;  // default: 512
  metadata?: number;        // default: 16384
  sections?: number;        // default: 8192
  sectionsFallback?: number; // default: 16384
  enrichment?: number;      // default: 4096
}

type ConvertPdfToImagesFn = (
  pdfBase64: string,
  startPage: number,
  endPage: number,
) => Promise<Array<{ imageBase64: string; mimeType: string }>>;
```

### PDF Content Formats

| Format | Description | Providers |
|--------|-------------|-----------|
| `file` (default) | Native PDF file input | Anthropic, Google, OpenAI, Mistral, Bedrock, Azure |
| `image` | Converted to base64 images | Fallback for other providers |

### Rate-Limit Resilience

All model calls automatically retry on rate-limit errors with exponential backoff — up to 5 retries with delays of 2s, 4s, 8s, 16s, 32s (plus jitter).

### Agent Functions

| Function | Description |
|----------|-------------|
| `buildAgentSystemPrompt(ctx)` | Full system prompt from `AgentContext` |
| `buildDocumentContext(docs, query)` | Ranked document context for query |
| `buildClassifyMessagePrompt(platform)` | Intent classification prompt |

### PDF Operations

| Function | Description |
|----------|-------------|
| `getAcroFormFields(pdfBytes)` | Detect fillable form fields |
| `fillAcroForm(pdfBytes, mappings)` | Fill and flatten AcroForm fields |
| `overlayTextOnPdf(pdfBytes, overlays)` | Position text on flat PDFs |
| `getPdfPageCount(pdfBytes)` | Get total page count |
| `extractPageRange(pdfBytes, start, end)` | Extract page range as new PDF |

### Prompts (Advanced)

All prompts are exported for customization:

```typescript
// Extraction
EXTRACTION_PROMPT
CLASSIFY_DOCUMENT_PROMPT
METADATA_PROMPT
QUOTE_METADATA_PROMPT
buildSectionsPrompt(metadata)
buildPolicySectionsPrompt(metadata)
buildQuoteSectionsPrompt(metadata)

// Application
APPLICATION_CLASSIFY_PROMPT
buildFieldExtractionPrompt(fields)
buildAutoFillPrompt(fields, context)
buildQuestionBatchPrompt(fields)

// Agent (composable)
buildIdentityPrompt(ctx)
buildSafetyPrompt(ctx)
buildFormattingPrompt(platform)
buildCoverageGapPrompt(ctx)
buildCoiRoutingPrompt(ctx)
```

### Tool Definitions

```typescript
import { AGENT_TOOLS, DOCUMENT_LOOKUP_TOOL, COI_GENERATION_TOOL, COVERAGE_COMPARISON_TOOL } from "@claritylabs/cl-sdk";

// AGENT_TOOLS is an array of all tool definitions
// Individual tools available for selective use
```

## Development

```bash
npm install
npm run build      # Build ESM + CJS + types via tsup
npm run dev        # Watch mode
npm run typecheck  # Type check (tsc --noEmit)
```

Pure TypeScript — no framework dependencies. Peer dependencies on `ai` (AI SDK) and `pdf-lib`. Model-agnostic — bring any provider (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc.).

## License

Apache-2.0
