# @claritylabs/cell

Clarity's insurance intelligence engine — the core IP powering policy extraction, application processing, and agent prompts.

## What's inside

- **Prompts** — Extraction, application, agent, and classifier prompts
- **Extraction** — PDF extraction pipeline with multi-pass Claude calls
- **Types** — Insurance domain types (policies, quotes, applications, industries)

## Usage

```typescript
import {
  extractFromPdf,
  buildSystemPrompt,
  POLICY_TYPE_LABELS,
} from "@claritylabs/cell";
```

## Development

```bash
npm install
npm run build    # Build ESM + CJS + types
npm run dev      # Watch mode
npm run typecheck
```

## Architecture

Pure TypeScript — no framework dependencies. Peer deps on `@anthropic-ai/sdk` and `pdf-lib`.
