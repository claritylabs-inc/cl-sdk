import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Resolve the real package export and retain every export so tree shaking cannot
// conceal an accidental dependency on PDF helpers or another Node-only module.
const bundle = await build({
  stdin: {
    contents: 'export * from "@claritylabs/cl-sdk/decisions";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "decisions",
  write: false,
  metafile: true,
});
for (const output of Object.values(bundle.metafile.outputs)) {
  assert.deepEqual(
    output.imports,
    [],
    "Decision bundle must have no external imports",
  );
}

// No process, require, Buffer, or other Node globals are available here.
const context = { AbortController, setTimeout, clearTimeout };
runInNewContext(bundle.outputFiles[0].text, context);
const browser = context.decisions;
const esm = await import("@claritylabs/cl-sdk/decisions");
const cjs = createRequire(import.meta.url)("@claritylabs/cl-sdk/decisions");
for (const name of Object.keys(esm)) {
  assert.equal(
    typeof browser[name],
    typeof esm[name],
    `Browser export ${name}`,
  );
  assert.equal(typeof cjs[name], typeof esm[name], `CJS export ${name}`);
}
for (const name of [
  "runDecision",
  "parseDecisionPolicy",
  "parseDecideRequest",
  "parseDecideResponse",
  "validateDecisionAnswers",
  "sourceValueQuestion",
  "verificationQuestions",
  "evaluateDecisionGate",
]) {
  assert.equal(typeof browser[name], "function", `Required export ${name}`);
}
const fallback = { source: "reasoning" };
const result = await browser.runDecision({
  family: "bundle-smoke",
  policy: browser.parseDecisionPolicy({ mode: "legacy" }),
  state: null,
  questions: { supported: browser.noulQuestion("Is the evidence supported?") },
  accept: () => {
    throw new Error("Legacy mode must not accept a decision");
  },
  fallback: async () => fallback,
});
assert.equal(result, fallback);
const accepted = { source: "decision" };
assert.equal(
  await browser.runDecision({
    family: "bundle-smoke",
    policy: browser.parseDecisionPolicy({
      mode: "active",
      families: {
        "bundle-smoke": {
          threshold: 0.99,
          evaluationId: "synthetic-bundle-test",
        },
      },
    }),
    state: { nested: [true, 1, null] },
    questions: {
      supported: browser.noulQuestion("Is the evidence supported?"),
    },
    decide: async () => ({
      contractVersion: 1,
      requestId: "bundle-smoke",
      model: "synthetic-test",
      answers: { supported: { type: "noul", noul: 1 } },
      usage: { inputTokens: 1, outputTokens: 0 },
      cost: { status: "unpriced", costNanoUsd: null },
      durationMs: 1,
    }),
    accept: () => accepted,
    fallback: async () => {
      throw new Error("Valid active decision must be accepted");
    },
  }),
  accepted,
);
console.log(
  "Decision subpath: browser bundle has no external imports; browser execution and ESM/CJS exports passed.",
);

// The audit entry may bundle Zod, but it must not import Node/PDF/provider code.
const auditBundle = await build({
  stdin: {
    contents: 'export * from "@claritylabs/cl-sdk/extraction-audit";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "audit",
  write: false,
  metafile: true,
});
for (const output of Object.values(auditBundle.metafile.outputs)) {
  assert.deepEqual(
    output.imports,
    [],
    "Audit browser bundle must have no external imports",
  );
}
const auditContext = { AbortController, setTimeout, clearTimeout, TextEncoder };
runInNewContext(auditBundle.outputFiles[0].text, auditContext);
const auditEsm = await import("@claritylabs/cl-sdk/extraction-audit");
const auditCjs = createRequire(import.meta.url)(
  "@claritylabs/cl-sdk/extraction-audit",
);
for (const name of Object.keys(auditEsm)) {
  assert.equal(typeof auditContext.audit[name], typeof auditEsm[name]);
  assert.equal(typeof auditCjs[name], typeof auditEsm[name]);
}
for (const name of [
  "auditExtractionEvidence",
  "parseExtractionEvidenceAudit",
  "validateExtractionAuditBinding",
]) {
  assert.equal(typeof auditContext.audit[name], "function");
}
const auditSmoke = await auditContext.audit.auditExtractionEvidence({
  profile: {
    documentType: "policy",
    linesOfBusiness: [],
    sourceSpanIds: [],
    sourceNodeIds: [],
    declarationFacts: [],
    coverages: [],
    parties: [],
    endorsementSupport: [],
    warnings: [],
  },
  sourceSpans: [],
  sourceTree: [],
});
assert.equal(auditSmoke.audit.status, "not_run");
assert.equal(auditSmoke.audit.visualCompleteness, "not_assessed");
console.log(
  "Extraction audit subpath: browser bundle, execution, and ESM/CJS exports passed.",
);

// Exercise schema catalog discovery and accepted uncited-fact traversal with the
// installed Zod peer. Synthetic answers test mechanics, not semantic accuracy.
const binding = {
  profile: {
    documentType: "policy",
    linesOfBusiness: [],
    policyNumber: { value: "ABC" },
    namedInsured: { value: "Acme" },
    sourceSpanIds: [],
    sourceNodeIds: [],
    declarationFacts: [],
    coverages: [],
    parties: [],
    endorsementSupport: [],
    warnings: [],
  },
  document: {
    id: "d",
    type: "policy",
    carrier: "Acme",
    insuredName: "Acme",
    policyNumber: "ABC",
    coverages: [],
    documentOutline: [],
    documentMetadata: {
      agentGuidance: [
        { kind: "coverage", title: "Policy identity", detail: "Acme insured." },
      ],
    },
  },
  sourceSpans: [
    {
      id: "s1",
      documentId: "d",
      sourceKind: "policy_pdf",
      kind: "pdf_text",
      text: "Policy ABC. Acme insured.",
      hash: "be2d6269d3591722",
      pageStart: 1,
    },
  ],
  sourceTree: [
    {
      id: "root",
      documentId: "d",
      kind: "document",
      title: "Document",
      sourceSpanIds: ["s1"],
      order: 0,
      path: "1",
    },
  ],
};
for (const [name, api] of [
  ["browser", auditContext.audit],
  ["ESM", auditEsm],
  ["CJS", auditCjs],
]) {
  let calls = 0;
  const result = await api.auditExtractionEvidence({
    ...binding,
    decisions: {
      decisionPolicy: {
        mode: "active",
        families: {
          "extraction.audit": {
            threshold: 0.99,
            evaluationId: "synthetic-peer-smoke-only",
          },
        },
      },
      decide: async (request) => {
        calls++;
        assert.ok(
          request.state.schemaCatalog.includes(
            "/document/documentMetadata/agentGuidance/*/detail",
          ),
        );
        assert.equal(request.state.sourceContextComplete, true);
        return {
          contractVersion: 1,
          requestId: "synthetic-audit-peer-smoke",
          model: "synthetic-test",
          answers: Object.fromEntries(
            Object.entries(request.questions).map(([id, question]) => [
              id,
              question.type === "choice"
                ? {
                    type: "choice",
                    choice: "supported_class",
                    confidence: 1,
                    probabilities: Object.fromEntries(
                      Object.keys(question.criteria).map((key) => [
                        key,
                        key === "supported_class" ? 1 : 0,
                      ]),
                    ),
                  }
                : {
                    type: "noul",
                    noul:
                      id.endsWith("supported") || id.endsWith("context")
                        ? 1
                        : 0,
                  },
            ]),
          ),
          usage: { inputTokens: 1, outputTokens: 1 },
          cost: { status: "unpriced", costNanoUsd: null },
          durationMs: 0,
        };
      },
    },
  });
  assert.equal(result.audit.status, "verified_text", name);
  assert.equal(calls, 1, `${name}: facts and source units share one request`);
  assert.ok(result.audit.metrics.batches[0].uncitedFactUnitIds.length > 0);
  api.validateExtractionAuditBinding(result.audit, binding);
  assert.equal(
    api.parseExtractionEvidenceAudit(result.audit, binding).status,
    "verified_text",
  );
}
console.log(
  "Extraction audit: browser/ESM/CJS active execution, schema catalog, and exact uncited binding passed.",
);
