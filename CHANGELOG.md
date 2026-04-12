## [0.7.4](https://github.com/claritylabs-inc/cl-sdk/compare/v0.7.3...v0.7.4) (2026-04-12)


### Bug Fixes

* align extractor schemas with document types and preserve describe metadata ([e6b8f74](https://github.com/claritylabs-inc/cl-sdk/commit/e6b8f744973b61ce3271f7e33d44514896d3dcc0))

## [0.7.3](https://github.com/claritylabs-inc/cl-sdk/compare/v0.7.2...v0.7.3) (2026-04-12)


### Bug Fixes

* auto-transform schemas for strict structured output compatibility ([ed29a72](https://github.com/claritylabs-inc/cl-sdk/commit/ed29a72717236bf40fe3791b136e7a39d3bfe61c))

## [0.7.2](https://github.com/claritylabs-inc/cl-sdk/compare/v0.7.1...v0.7.2) (2026-04-12)


### Bug Fixes

* retry on transient provider errors (grammar timeout, 5xx, overloaded) ([104ef3f](https://github.com/claritylabs-inc/cl-sdk/commit/104ef3fc7db41b1f12b7ff4739a814c430b5cdf8))

## [0.7.1](https://github.com/claritylabs-inc/cl-sdk/compare/v0.7.0...v0.7.1) (2026-04-12)


### Bug Fixes

* replace z.record() in declarations extractor schema ([d57adf5](https://github.com/claritylabs-inc/cl-sdk/commit/d57adf52c36e9111b4e6a1f1d25d7a913d9d01da))

# [0.7.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.6.0...v0.7.0) (2026-04-12)


### Bug Fixes

* replace z.record() with array schemas for structured output compatibility ([e2f9828](https://github.com/claritylabs-inc/cl-sdk/commit/e2f9828fac8df5ccda3447cb9cf858ec4dc10179))


### Features

* add safeGenerateObject wrapper and pipeline checkpoint system ([206c766](https://github.com/claritylabs-inc/cl-sdk/commit/206c766989bdbbf9fd44451d289b62b25a0e77f9))

# [0.6.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.5.0...v0.6.0) (2026-04-12)


### Features

* add post-extraction markdown formatting pass ([964c1d1](https://github.com/claritylabs-inc/cl-sdk/commit/964c1d1db33e667e01c2a78a6598f7d2fa2f1c60))

# [0.5.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.4.0...v0.5.0) (2026-04-12)


### Bug Fixes

* **ci:** rename workflow to publish.yml to match npm trusted publisher config ([192d034](https://github.com/claritylabs-inc/cl-sdk/commit/192d034ef130491475b8560be62e0ffa9499897e))


### Features

* add application processing pipeline with persistent state and vector backfill ([45cd487](https://github.com/claritylabs-inc/cl-sdk/commit/45cd487f6ade472347856b8f1e888a81e300bc11))

# [0.4.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.3.1...v0.4.0) (2026-04-12)


### Features

* add query agent pipeline with citation-backed provenance ([9b65b76](https://github.com/claritylabs-inc/cl-sdk/commit/9b65b767cf29dc94357773413da2d57fbd52013f))

# [0.3.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.2.1...v0.3.0) (2026-04-12)


* feat!: merge v6 agentic refactor to master ([792ca72](https://github.com/claritylabs-inc/cl-sdk/commit/792ca72127a9a246da55cfd68be63c73c9fd8df8))
* feat!: new barrel exports for v6 — remove all v5 deprecated exports ([8280e0c](https://github.com/claritylabs-inc/cl-sdk/commit/8280e0c5d625a27e99bc1342aa0296d065c33a3c))
* feat!: remove v5 source files — types/, pipeline.ts, monolithic prompts, deprecated exports ([fcd8c22](https://github.com/claritylabs-inc/cl-sdk/commit/fcd8c22136f07c3fb7477b94f1453b6494fb8380))


### Features

* add coordinator prompts — classify, plan, review ([3917f4e](https://github.com/claritylabs-inc/cl-sdk/commit/3917f4e8cc848560a4c0d32690f4cb19ab56eab3))
* add document chunking for vector retrieval + chunk types ([e672870](https://github.com/claritylabs-inc/cl-sdk/commit/e6728705bf010f834ca17dbca11307cdd1407a0d))
* add document type templates for agentic extraction ([2c261f6](https://github.com/claritylabs-inc/cl-sdk/commit/2c261f63dcf7e70ae80cd69f48ebebb00a229124))
* add focused extractor prompts — split monolithic extraction prompt into 11 modules ([b026dcb](https://github.com/claritylabs-inc/cl-sdk/commit/b026dcb67c6686ec3cbba0379f4e48897225c715))
* add storage interfaces + SQLite reference implementation ([9078792](https://github.com/claritylabs-inc/cl-sdk/commit/9078792f20ed041e7c1477bf2fad0acd56e891a0))
* migrate agent, application, and intent prompts — split application.ts into modules ([eb06447](https://github.com/claritylabs-inc/cl-sdk/commit/eb064472d5cc5e09c90278a3c54ee0c7e88a3eb5))


### BREAKING CHANGES

* Complete v6 rewrite with new API

- Remove ai SDK peer dependency (now provider-agnostic callbacks)
- New peer deps: pdf-lib, zod
- New extraction pipeline: coordinator/worker pattern with agentic review
- Provider-agnostic: works with any LLM provider via simple callbacks
- Add Zod schemas for all types (23 declaration types as discriminated union)
- Add storage interfaces with SQLite reference implementation
- Add document chunking for vector retrieval
- New exports: createExtractor, chunkDocument, storage interfaces
- Remove old exports: extractFromPdf, classifyDocumentType, etc.
- Version bumped to 0.3.0

The old 6.0.0 npm version was from an incorrect release and is now deprecated.
* All v5 modules are removed. Consumers must use v6 APIs.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
* All v5 exports from types/, pipeline.ts, and legacy
prompts are removed. Consumers must migrate to v6 APIs.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

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
