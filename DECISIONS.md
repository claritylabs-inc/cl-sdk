# Structured decisions

CL-SDK accepts an optional `decide` callback on `createExtractor`, `createQueryAgent`, `createApplicationPipeline`, and standalone `runCoverageRecovery`. Hosts supply transport, tenant context, and reasoning callbacks. The SDK has no router dependency, provider credential, or fixed model dependency.

Import decision primitives from `@claritylabs/cl-sdk/decisions` in browsers and non-Node Convex modules. This dedicated entry exports the cascade, policy parser, wire types and validators, question builders, and evaluation gate without Node or provider dependencies. Root exports remain available for existing consumers.

```ts
import { createExtractor } from "@claritylabs/cl-sdk";
import { parseDecisionPolicy, type Decide } from "@claritylabs/cl-sdk/decisions";

const decide: Decide = async ({ signal, ...request }) => {
  return decisionClient.decide({ ...request, tenantId }, { signal });
};

const extractor = createExtractor({
  generateObject,
  decide,
  decisionPolicy: parseDecisionPolicy({
    mode: "shadow",
    policyVersion: "insurance-decisions-v1",
    timeoutMs: 1000,
  }),
  onDecision(event) {
    recordDecision({ family: event.family, outcome: event.outcome, reason: event.reason });
  },
});
```

`decisionClient`, `tenantId`, `generateObject`, and `recordDecision` above are host-owned. `onDecision` is synchronous; hosts scheduling asynchronous logging must handle rejection themselves. Events contain family, mode, outcome, bounded reason, duration, policy/evaluation identifiers, and the validated response when available. Responses include model version, usage, priced/unpriced cost, and request lineage. Do not send response content to logs intended only for metadata. Failed or timed-out requests can have unknown cost; missing cost is never zero.

## Policy and cascade

```ts
type DecisionPolicy = {
  mode: "legacy" | "shadow" | "active";
  policyVersion?: string;
  timeoutMs?: number; // integer 100..900000; default 1000
  families?: Record<string, {
    mode?: "legacy" | "shadow" | "active";
    threshold?: number; // greater than 0.5, at most 1
    evaluationId?: string;
  }>;
};
```

Legacy is default. Shadow records a proposal and returns the existing result. Each active family needs an explicit calibrated threshold and evaluation ID. A global active mode does not qualify unlisted families. Family modes override global mode; rollback must clear active overrides or set those families to legacy. `parseDecisionPolicy(unknown)` rejects unknown fields, invalid modes/budgets, and incomplete active-family rules.

`runDecision<T>({ decide, policy, family, state, questions, accept, fallback, onDecision, onUsage, signal, requiredQuestionIds })` exposes the same cascade for host workflows. `accept(answers)` returns `T` or `undefined`; `fallback()` returns `Promise<T>`. `accept` runs only in active mode and must be a pure projection. Shadow validates the response and records threshold eligibility without invoking `accept`; it always executes fallback. It must enforce domain constraints such as citation integrity, source completeness, identity, freshness, eligibility and authorization.

Optional `requiredQuestionIds(answers)` selects the nonempty set of consumed question IDs for confidence checks; by default all questions are required. Unused speculative answers may be uncertain, but their contract must still be valid.

The helper validates exact question/answer and option coverage, distributions, confidence, structured score legends, and response metadata. Choice/Score confidence and Noul probability remain distinct. There is one decision attempt. Transient failures, timeout, malformed output, uncertainty and abstention use fallback once. Caller cancellation propagates to transport and rejects without starting fallback. Fallback retains its exact generic result; no Jev probabilities are invented. Observer exceptions cannot replay either path.

## Contracts and builders

Root exports `DecideRequest` / `DecideResponse`, aliases `DecisionRequest` / `DecisionResponse`, and callback types `DecisionInput` / `Decide`. Wire requests require `tenantId`. `DecisionInput` omits tenancy for a host closure and adds a local `signal` that must not be serialized.

`DecisionEntry` / `EntryType` accepts strings, objects, arrays and null; nested `DecisionJson` / `JsonValue` also includes numbers and booleans. Instructions, Choice criteria, Score levels/legends and Noul true/false criteria preserve structure. IDs are application keys; instructions must explicitly state each question.

Builders are `choiceQuestion`, `noulQuestion`, `scoreQuestion`, `modelCandidateQuestion`, `toolQuestion`, `taxonomyQuestion`, `sourceValueQuestion`, and `verificationQuestions`. Choice builders reserve `__abstain__`. Tool selection never grants execution authority.

Dependency-free parsers are `parseDecisionEntry`, `parseDecisionQuestion`, `parseDecideRequest`, and `parseDecideResponse`; the response parser can receive the original request to check lineage and answers. `validateDecideRequest` and `validateDecideResponse` are aliases. `validateDecisionAnswers` throws; `validDecisionAnswers` returns a boolean. The SDK accepts any nonempty resolved model ID; a host adapter enforces its version pin.

## Callsite inventory

| Family | Implementation | Retained path |
| --- | --- | --- |
| `extraction.cleanup` | Source-tree cleanup selects keep/drop/update by original coverage index, term actions/kinds, ACORD LOB and verbatim source values. | Missing candidates, contradictions, absent support, large contexts and question-budget overflow use existing cleanup. Novel names/terms and unsupported corrections remain reasoning work. |
| `extraction.recovery_regions` | Every discovery page receives a coverage/financial question with source text and neighboring context. Selected ranges include adjacent pages. | Uncertainty uses existing discovery. Region extraction and citation/value validation remain unchanged. |
| `extraction.audit` | Final bidirectional audit of the merged, recovered, cleaned profile and materialized document in both v1/v2. Batches atomic support/contradiction checks with per-source-unit completeness checks. | One optional contextual reasoning repair, then reverify. Missing context/citations, unsupported classes, normalization gaps and unreadable units remain unresolved. New evaluation qualification is required; the former pre-shard `extraction.verify` callsites are retired. |
| `query.classify` | Atomic intent, document-evidence need and history need. | Decomposition, comparisons, generated filters and ambiguous context use the existing classifier. |
| `query.verify` | Support, contradiction, missing evidence and original-question completeness. | Invalid citation IDs/quotes or uncertain support use existing verification and targeted retrieval/reasoning retries. Verifier failure remains unapproved. |
| `query.relevance` | Reorders retrieved packets without dropping passages or changing citation identities. | Existing retrieval, limits and ordering remain fallback. |
| `application.field_match` | Copies exact context values into matching fields. | Unknown matches and incompatible allowed values use the matching agent. |
| `application.reply_intent` | Answers-only intent and answer presence. | Questions, mixed replies and lookup instructions retain narrative extraction. |
| `application.bounded_answers` | Selects explicit allowed/yes-no values or unanswered. | Free-form, declaration and explanation-bearing answers retain parsing. |
| `application.lookup_match` | Selects verbatim labeled lookup values. | Missing candidates and nonstandard interpretation use the lookup filler. |

Source trees, source spans, evidence ledgers, shard assignment, finalization requirements and resume fingerprints are code-owned. Candidate enumeration never becomes a policy fact without a judgment. Novel operational extraction, PDF form extraction/classification, batching, email/prose, arithmetic and deterministic intake validation retain their current paths. Resumed completed extraction sections are not replayed. The final assembled snapshot receives a fresh audit when that family is enabled.

The current SDK has no mailbox, company research/memory, tool execution registry, certificate issuance, proposal review, or security classifier runtime. Those approved-plan batches belong to host repositories; exported builders support them without creating duplicate SDK workflows. Query/application savings remain separate from immediate Spot savings because the audit found no current Spot callers of those coordinators.

## Evaluation and release

`evaluateDecisionGate` evaluates paired calibration/held-out workflow samples. It rejects leaked splits, synthetic corpora, unknown total workflow costs, inadequate sample counts, consequential false acceptance, and accuracy regression beyond the chosen allowance (zero consequential; five percentage points reversible). Sample requirements and corpus representativeness still require independent review. It reports latency p50/p95 and total costs; it does not assert a latency benefit.

The checked-in synthetic fixtures and live smoke report demonstrate API behavior and control-flow boundaries, not production quality. They do not authorize an evaluation ID for activation. Representative held-out insurance documents and threads, a paired reasoning baseline, total fallback cost, and source-coverage review remain required. Families remain legacy/shadow until qualified.

The authoritative baseline for this change is SDK 4.6.0, commit `1527a28597c1e403a391bc033d440bc67a3a80f2` on `master`. The workspace's initial `main` was stale. Release uses the existing semantic-release workflow on `master`, after independent manager review. Do not manually bump versions or publish locally. Update host and worker dependency specs together after publication.


## Final bidirectional evidence audit

The `@claritylabs/cl-sdk/extraction-audit` entry (also exported from the root) supports browser/non-Node hosts. It depends on Zod and pure SDK modules, with no PDF, provider, or Node runtime. The separate `/decisions` entry remains dependency-free.

`auditExtractionEvidence({profile, document?, sourceSpans, sourceTree, originalSourceSpans?, decisions?, options?, repair?})` returns `{profile, document?, audit}`. `createExtractor` invokes it after cleanup and materialization and returns the diagnostic as `result.evidenceAudit`; per-call limits go in `ExtractOptions.evidenceAudit`. `extraction.audit` has independent policy qualification. Legacy is default; shadow keeps the existing result and never repairs. The former `extraction.verify` family no longer authorizes extraction verification.

Forward traversal recursively enumerates populated string/number/boolean leaves in both snapshots, including narratives, identities, dates, nested terms, schedules and financials. Null/empty values are not asserted facts. Citation IDs/hashes, infrastructure IDs, confidence, warnings, generated agent guidance and extraction bookkeeping are not semantic facts; they still affect the snapshot fingerprint. Every supplied source unit enters reverse traversal. The schema catalog includes absent fields and is derived from the schemas, rather than a small operational whitelist. Unsupported fact classes remain unresolved.

Questions share a complete compact global fact index and full untruncated local source units. A source category and its speculative omission/contradiction/context questions share one request with independent forward questions. Only consumed branch confidence matters; all answers still require full contract validation. If the complete fact index or one source unit cannot fit, it is unresolved. Local contexts cannot establish policy-wide endorsement precedence: any batch without the complete cross-unit text context records `cross_unit_context`, even if local support was confident. This conservative limitation can require reasoning on large documents; no savings or full-document semantic coverage is claimed.

Defaults are 96 questions/request (maximum 128), 65,536 serialized request bytes including a 1,024-byte host envelope reserve, concurrency 4, 64 requests across both rounds, 30 seconds total, and at most one repair. Limits only reduce work when exhausted; unsent units never count verified. Host adapters must enforce actual wire-envelope size. `signal` cancellation rejects without reasoning fallback. The shared deadline also bounds non-cooperative repair callbacks. Metrics record actual callback invocations, question counts, serialized SDK bytes plus reserve, observed batch/wall durations, usage and priced/unpriced cost when provided. They are not a paired quality/cost evaluation.

`ExtractionEvidenceAudit` has `status: not_run | shadow | verified_text | unresolved`, `scope: provided_source_text`, and `visualCompleteness: not_assessed`. No caller metadata can upgrade text to visual completeness. SDK repair preserves original PDF/file/image provider options, uses full source context and targeted findings, and is reaudited. Images/blank text and missing original context stay unresolved even after a PDF reasoning repair; Jev text judgments cannot certify the visuals.

The bounded report includes source/result/profile/document fingerprints, the evidence ledger hash, forward/reverse totals and traversal manifests, up to 64 issue records with a full issue count, batch metrics, policy/evaluation IDs, and `acceptanceThreshold`. `originalSourceSpans` binds original parser input, including units dropped/retexted by normalization. Gaps are recorded with `inputSourceFingerprint`, `unrepresentedInputUnits`, and `source_normalization_gap`; omitting original units later cannot validate a report that bound them. `parseExtractionEvidenceAudit(value, binding?)` validates report structure; `validateExtractionAuditBinding(report, binding)` throws for changed sources/results, invented traversal totals/manifests, or missing originally bound input. Fingerprints are deterministic consistency checks, not signatures or proof that model judgments are correct. Stored diagnostics never grant promotion authority.

The profile and document returned by the audit are the exact audited snapshot. Downstream normalization or policy projection invalidates its binding; hosts must label that output unaudited or rerun the public entry on the final snapshot. Reuse also requires current policy/evaluation IDs and acceptance threshold equality. Existing v2 completion manifests describe extraction/source traversal, not semantic verification. After bounded repair, active unresolved produces a blocking review issue: default warn/off return the snapshot and report, while the existing strict quality gate throws. Shadow/not_run do not change quality behavior.

The follow-up baseline is published 4.7.1 (`a8d0fb5bb9c2007a27a21b63a340ed3a1ceb315b`). Synthetic adversarial tests and the bounded System One endorsement fixture check control flow and question design only. They do not qualify active use.
