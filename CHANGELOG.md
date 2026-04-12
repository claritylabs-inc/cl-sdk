# Changelog

All notable changes to this project will be documented in this file.

## v0.1.0 — 2026-04-11

Version reset. All prior versions (1.x through 6.x) are deprecated. The SDK will remain below 1.0.0 until official launch.

### Current Features

- Document classification (`classifyDocumentType`)
- PDF extraction pipeline (`extractFromPdf`, `extractQuoteFromPdf`)
- Provider-agnostic model configuration via Vercel AI SDK `LanguageModel` instances
- Composable agent prompt system (`buildAgentSystemPrompt`)
- Platform and intent model for multi-channel agents
- PDF operations (AcroForm fill, text overlay, page splitting)
- Comprehensive insurance type system (42 policy types, declarations, coverages)
- Rate-limit retry with exponential backoff
- Parallel chunk extraction with configurable concurrency
- Token usage tracking via `onTokenUsage` callback
- Context key mapping for policy-to-application auto-fill
- Native PDF file support with `convertPdfToImages` fallback

## Historical Versions (Deprecated)

Versions 1.0.0 through 6.0.0 were pre-release development versions that have been deprecated. They should not be used.
