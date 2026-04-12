## [0.2.1](https://github.com/claritylabs-inc/cl-sdk/compare/v0.2.0...v0.2.1) (2026-04-12)


### Bug Fixes

* trigger patch release for README update ([f67d463](https://github.com/claritylabs-inc/cl-sdk/commit/f67d463b88d33f3dba5a275388bc61ee38fcf9bb))

# [0.2.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.1.0...v0.2.0) (2026-04-12)


### Documentation

* fix all documentation to match SDK v0.1.0 API ([0e6b23e](https://github.com/claritylabs-inc/cl-sdk/commit/0e6b23ef8af7491beaf7abc52595107a2bc39b6a))


### BREAKING CHANGES

* Documentation now correctly reflects that models is required

- Fix models parameter from optional to required in all option types
- Remove non-existent createDefaultModelConfig() references
- Remove non-existent SONNET_MODEL and HAIKU_MODEL constants
- Fix metadata token limit to 16384 (was 4096)
- Add missing pdfContentFormat, convertPdfToImages, tokenLimits fields
- Fix enrichSupplementaryFields signature
- Update all quickstart examples with createUniformModelConfig
- Rewrite models.mdx to explain models is required
- Fix application prompt function signatures
- Mark MODEL_TOKEN_LIMITS as deprecated
- Update changelog for v0.2.0 and version reset

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
