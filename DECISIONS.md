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
| `extraction.verify` | Checks populated fields and omitted-fact signals against full source spans in both v1 and v2. | Uncertain batches trigger one reasoning repair with affected paths. Existing failure/degradation and independent source-coverage gates remain. |
| `query.classify` | Atomic intent, document-evidence need and history need. | Decomposition, comparisons, generated filters and ambiguous context use the existing classifier. |
| `query.verify` | Support, contradiction, missing evidence and original-question completeness. | Invalid citation IDs/quotes or uncertain support use existing verification and targeted retrieval/reasoning retries. Verifier failure remains unapproved. |
| `query.relevance` | Reorders retrieved packets without dropping passages or changing citation identities. | Existing retrieval, limits and ordering remain fallback. |
| `application.field_match` | Copies exact context values into matching fields. | Unknown matches and incompatible allowed values use the matching agent. |
| `application.reply_intent` | Answers-only intent and answer presence. | Questions, mixed replies and lookup instructions retain narrative extraction. |
| `application.bounded_answers` | Selects explicit allowed/yes-no values or unanswered. | Free-form, declaration and explanation-bearing answers retain parsing. |
| `application.lookup_match` | Selects verbatim labeled lookup values. | Missing candidates and nonstandard interpretation use the lookup filler. |

Source trees, source spans, evidence ledgers, shard assignment, finalization requirements and resume fingerprints are code-owned. Candidate enumeration never becomes a policy fact without a judgment. Novel operational extraction, PDF form extraction/classification, batching, email/prose, arithmetic and deterministic intake validation retain their current paths. Resumed completed sections are not replayed for decision inference.

The current SDK has no mailbox, company research/memory, tool execution registry, certificate issuance, proposal review, or security classifier runtime. Those approved-plan batches belong to host repositories; exported builders support them without creating duplicate SDK workflows. Query/application savings remain separate from immediate Spot savings because the audit found no current Spot callers of those coordinators.

## Evaluation and release

`evaluateDecisionGate` evaluates paired calibration/held-out workflow samples. It rejects leaked splits, synthetic corpora, unknown total workflow costs, inadequate sample counts, consequential false acceptance, and accuracy regression beyond the chosen allowance (zero consequential; five percentage points reversible). Sample requirements and corpus representativeness still require independent review. It reports latency p50/p95 and total costs; it does not assert a latency benefit.

The checked-in synthetic fixtures and live smoke report demonstrate API behavior and control-flow boundaries, not production quality. They do not authorize an evaluation ID for activation. Representative held-out insurance documents and threads, a paired reasoning baseline, total fallback cost, and source-coverage review remain required. Families remain legacy/shadow until qualified.

The authoritative baseline for this change is SDK 4.6.0, commit `1527a28597c1e403a391bc033d440bc67a3a80f2` on `master`. The workspace's initial `main` was stale. Release uses the existing semantic-release workflow on `master`, after independent manager review. Do not manually bump versions or publish locally. Update host and worker dependency specs together after publication.
