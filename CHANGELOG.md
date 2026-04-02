# [1.3.0](https://github.com/claritylabs-inc/cl-sdk/compare/v1.2.0...v1.3.0) (2026-04-02)


### Features

* add comprehensive enum/union types for insurance data model ([088ab06](https://github.com/claritylabs-inc/cl-sdk/commit/088ab06822105033486952fb637919b2b3ca7d20))
* add context key mapping for policy-to-application auto-fill ([4ff7689](https://github.com/claritylabs-inc/cl-sdk/commit/4ff76891a1afcb3a0b61ca7596e93d37385f93fe))
* add coverage, parties, financial, loss-history, and underwriting types ([199a89e](https://github.com/claritylabs-inc/cl-sdk/commit/199a89e2ed424679e8ce16d53e5477d4b87c595a))
* add declarations types (limits, deductibles, locations, vehicles, classifications) ([ba98795](https://github.com/claritylabs-inc/cl-sdk/commit/ba9879519c69686563821b387aa2c8495a7f56da))
* add endorsement, exclusion, and condition types ([340f246](https://github.com/claritylabs-inc/cl-sdk/commit/340f24685aab9f600599c522f2f6a8d59d2a67c3))
* add enriched fields to BaseDocument, PolicyDocument, QuoteDocument ([1a9dce1](https://github.com/claritylabs-inc/cl-sdk/commit/1a9dce18e1da60d362d355a09114257271bdefef))
* add shared interfaces (Address, Contact, FormReference, etc.) ([05b5303](https://github.com/claritylabs-inc/cl-sdk/commit/05b53031e0a008345693384cc4f4973980050c9c))
* expand extraction prompts with enriched structured fields ([96a26b1](https://github.com/claritylabs-inc/cl-sdk/commit/96a26b1bc7f2bd670633679bbdcbef3d15af3f72))
* export all new types from barrel index ([29c18c0](https://github.com/claritylabs-inc/cl-sdk/commit/29c18c0224ee49db4e4be77f7d7236619aac7a76))
* update pipeline to extract and merge enriched structured data ([55e16ca](https://github.com/claritylabs-inc/cl-sdk/commit/55e16caebe1b76558bc848c5e4976de910b52fac))

# [1.2.0](https://github.com/claritylabs-inc/cl-sdk/compare/v1.1.4...v1.2.0) (2026-04-02)


### Features

* add PDF page splitting to reduce API token usage ([ced0e37](https://github.com/claritylabs-inc/cl-sdk/commit/ced0e37fbaed08fc8c14ace51cf3a44aeef3c3a0))

## [1.1.4](https://github.com/claritylabs-inc/cl-sdk/compare/v1.1.3...v1.1.4) (2026-04-02)


### Bug Fixes

* add repository.url for npm provenance verification ([f7e5b73](https://github.com/claritylabs-inc/cl-sdk/commit/f7e5b73cbe3124d1b02210cfbb731c630512c202))

## [1.1.3](https://github.com/claritylabs-inc/cl-sdk/compare/v1.1.2...v1.1.3) (2026-04-02)


### Bug Fixes

* restore --provenance now that repo is public ([0f75e4c](https://github.com/claritylabs-inc/cl-sdk/commit/0f75e4cddbca516ef23e4a560f99bca11bbfe2f9))

## [1.1.2](https://github.com/claritylabs-inc/cl-sdk/compare/v1.1.1...v1.1.2) (2026-04-02)


### Bug Fixes

* remove --provenance flag (requires public repo) ([8243815](https://github.com/claritylabs-inc/cl-sdk/commit/8243815c186931a8010a363767808e958bc56f23))

## [1.1.1](https://github.com/claritylabs-inc/cl-sdk/compare/v1.1.0...v1.1.1) (2026-04-02)


### Bug Fixes

* upgrade to Node 24 for npm trusted publishing support ([d52646f](https://github.com/claritylabs-inc/cl-sdk/commit/d52646fac8ab74cc8c1b4ed27157ff31a093bdbb))

# [1.1.0](https://github.com/claritylabs-inc/cl-sdk/compare/v1.0.1...v1.1.0) (2026-04-02)


### Features

* add rate-limit retry, parallel chunk extraction, and token tracking ([e8e51af](https://github.com/claritylabs-inc/cl-sdk/commit/e8e51af00e0e3cde5925598dd27d6b0aa216b8b4))

## [1.0.1](https://github.com/claritylabs-inc/cl-sdk/compare/v1.0.0...v1.0.1) (2026-03-22)


### Bug Fixes

* split npm publish from semantic-release for OIDC trusted publishing ([ac80ca7](https://github.com/claritylabs-inc/cl-sdk/commit/ac80ca74d8cce2e9656e1fd08b4c6ba8090c7dc4))
* use npm trusted publishing (OIDC) instead of NPM_TOKEN ([14ba8a8](https://github.com/claritylabs-inc/cl-sdk/commit/14ba8a834ef0072c8f53a0308d9021e7969ea8a4))

# [1.0.0](https://github.com/claritylabs-inc/cl-sdk/compare/v0.3.0...v1.0.0) (2026-03-22)


* feat!: publish to npm as @claritylabs/cl-sdk under Apache-2.0 ([5006185](https://github.com/claritylabs-inc/cl-sdk/commit/5006185d2f4e28a5365a1c13cd5f697641a73c3f))


### BREAKING CHANGES

* Package is now published as @claritylabs/cl-sdk on npm instead of @claritylabs-inc/cl-sdk on GitHub Packages.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>

# [0.3.0](https://github.com/claritylabs-inc/cell/compare/v0.2.5...v0.3.0) (2026-03-20)


### Features

* rebrand from Cell to CL-0 SDK ([e430073](https://github.com/claritylabs-inc/cell/commit/e4300733dfd3c97a8181a5eeab48c4da3a565729))

## [0.2.5](https://github.com/claritylabs-inc/cell/compare/v0.2.4...v0.2.5) (2026-03-16)


### Bug Fixes

* clean up publish.yml encoding ([7b2008b](https://github.com/claritylabs-inc/cell/commit/7b2008b3d2e30bf20105262bf32efeab0384d457))

## [0.2.4](https://github.com/claritylabs-inc/cell/compare/v0.2.3...v0.2.4) (2026-03-16)


### Bug Fixes

* make agent name configurable instead of hardcoding "Clarity Agent" ([9dbb850](https://github.com/claritylabs-inc/cell/commit/9dbb85030bb176058ae038d7779f5c6ad035b14c))

## [0.2.3](https://github.com/claritylabs-inc/cell/compare/v0.2.2...v0.2.3) (2026-03-16)


### Bug Fixes

* make document link guidance configurable in agent prompts ([20049b4](https://github.com/claritylabs-inc/cell/commit/20049b4f99c0a0fab7fe809e3a665c3255ffd898))

## [0.2.2](https://github.com/claritylabs-inc/cell/compare/v0.2.1...v0.2.2) (2026-03-15)


### Bug Fixes

* **ci:** add issues and pull-requests write permissions for semantic-release ([da032a2](https://github.com/claritylabs-inc/cell/commit/da032a280e6ef2fefa459e87c8f7a226936c8d17))

## [0.2.1](https://github.com/claritylabs-inc/cell/compare/v0.2.0...v0.2.1) (2026-03-15)


### Bug Fixes

* **ci:** bump Node version to 22 for semantic-release v25 ([251dcf0](https://github.com/claritylabs-inc/cell/commit/251dcf04a9e4fe8f8b94d0642e4d3642b75a4716))
