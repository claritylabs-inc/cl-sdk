# CL-0 SDK

[Clarity Labs](https://claritylabs.inc) allows insurers to understand their clients as well as they know themselves. Having a better understanding of clients means insurers can automate servicing to reduce costs and identify coverage gaps to cross-sell products.

CL-0 SDK is the open infrastructure layer that makes this possible: a shared intelligence system that any product or agent can import to understand, reason about, and act on insurance documents and workflows.

## Installation

```bash
npm install @claritylabs/cl-sdk
```

### Peer Dependencies

```bash
npm install pdf-lib zod
```

Optional (for SQLite storage):
```bash
npm install better-sqlite3
```

## Quick Start

### Document Extraction

The v6 extraction pipeline uses a coordinator/worker pattern with provider-agnostic callbacks:

```typescript
import { createExtractor } from "@claritylabs/cl-sdk";
import { anthropic } from "@ai-sdk/anthropic"; // or any provider
import { generateText, generateObject } from "ai";

const extract = createExtractor({
  generateText: async ({ prompt, system, maxTokens }) => {
    const { text, usage } = await generateText({
      model: anthropic("claude-sonnet-4-6"),
      prompt,
      system,
      maxTokens,
    });
    return { text, usage };
  },
  generateObject: async ({ prompt, system, schema, maxTokens }) => {
    const { object, usage } = await generateObject({
      model: anthropic("claude-sonnet-4-6"),
      prompt,
      system,
      schema,
      maxTokens,
    });
    return { object, usage };
  },
});

const pdfBase64 = "..."; // base64-encoded PDF
const result = await extract.extract(pdfBase64);
console.log(result.document); // Structured InsuranceDocument
```

### With PDF to Image Conversion

For providers that don't support native PDF input:

```typescript
const extract = createExtractor({
  generateText: /* ... */,
  generateObject: /* ... */,
  convertPdfToImages: async (pdfBase64, startPage, endPage) => {
    // Convert PDF pages to images using your preferred library
    return [
      { imageBase64: "...", mimeType: "image/png" },
      // ... one per page
    ];
  },
});
```

### Storage (Optional)

```typescript
import { createExtractor } from "@claritylabs/cl-sdk";
import { SQLiteDocumentStore, SQLiteMemoryStore } from "@claritylabs/cl-sdk/storage/sqlite";

const documentStore = new SQLiteDocumentStore("./docs.db");
const memoryStore = new SQLiteMemoryStore("./memory.db");

const extract = createExtractor({
  generateText: /* ... */,
  generateObject: /* ... */,
  documentStore,
  memoryStore,
});
```

## Architecture

### Provider-Agnostic Design

CL-0 SDK has **zero framework dependencies**. You provide simple callback functions:

```typescript
type GenerateText = (params: {
  prompt: string;
  system?: string;
  maxTokens: number;
}) => Promise<{ text: string; usage?: TokenUsage }>;

type GenerateObject<T> = (params: {
  prompt: string;
  system?: string;
  schema: ZodSchema<T>;
  maxTokens: number;
}) => Promise<{ object: T; usage?: TokenUsage }>;
```

Works with any provider: OpenAI, Anthropic, Google, Mistral, Bedrock, Azure, Ollama, etc.

### Extraction Pipeline

The `createExtractor` function returns an extraction engine:

1. **Classify** — Determine document type (policy/quote) and line of business
2. **Plan** — Generate extraction plan using line-specific templates
3. **Extract** — Dispatch focused extractors in parallel (concurrency-limited, default 2)
4. **Review** — Check completeness against template requirements (up to 2 review rounds)
5. **Assemble** — Merge results into final `InsuranceDocument`

```typescript
const extract = createExtractor({
  generateText,
  generateObject,
  concurrency: 2,           // Parallel extractor limit
  maxReviewRounds: 2,       // Review loop iterations
  onTokenUsage: (usage) => {
    console.log(`${usage.inputTokens} in, ${usage.outputTokens} out`);
  },
});
```

### Document Types

Comprehensive TypeScript types for the insurance domain:

```typescript
import type {
  InsuranceDocument,      // PolicyDocument | QuoteDocument
  PolicyDocument,
  QuoteDocument,
  Coverage,
  Endorsement,
  Declaration,            // 20+ line types
  Platform,
  AgentContext,
} from "@claritylabs/cl-sdk";
```

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `createExtractor(config)` | Create extraction engine with callbacks |
| `extract.extract(pdfBase64, documentId?)` | Run full extraction pipeline |
| `chunkDocument(text, maxChunkSize?)` | Chunk text for vector storage |

### Agent System

```typescript
import {
  buildAgentSystemPrompt,
  buildIdentityPrompt,
  buildSafetyPrompt,
  buildCoverageGapPrompt,
} from "@claritylabs/cl-sdk";

const systemPrompt = buildAgentSystemPrompt({
  platform: "email",
  intent: "direct",
  userName: "John",
  companyName: "Acme Insurance",
});
```

### Tool Definitions

```typescript
import {
  AGENT_TOOLS,
  DOCUMENT_LOOKUP_TOOL,
  COI_GENERATION_TOOL,
} from "@claritylabs/cl-sdk";
```

### PDF Operations

```typescript
import {
  getAcroFormFields,
  fillAcroForm,
  overlayTextOnPdf,
} from "@claritylabs/cl-sdk";
```

### Storage

```typescript
import { SQLiteDocumentStore, SQLiteMemoryStore } from "@claritylabs/cl-sdk/storage/sqlite";
```

## Development

```bash
npm install
npm run build      # Build ESM + CJS + types
npm run dev        # Watch mode
npm run typecheck  # Type check
npm run test       # Run tests (vitest)
```

Zero framework dependencies. Peer deps: `pdf-lib`, `zod`. Optional: `better-sqlite3`.

## License

Apache-2.0
