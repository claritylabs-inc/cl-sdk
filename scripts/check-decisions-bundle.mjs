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
  assert.deepEqual(output.imports, [], "Decision bundle must have no external imports");
}

// No process, require, Buffer, or other Node globals are available here.
const context = { AbortController, setTimeout, clearTimeout };
runInNewContext(bundle.outputFiles[0].text, context);
const browser = context.decisions;
const esm = await import("@claritylabs/cl-sdk/decisions");
const cjs = createRequire(import.meta.url)("@claritylabs/cl-sdk/decisions");
for (const name of Object.keys(esm)) {
  assert.equal(typeof browser[name], typeof esm[name], `Browser export ${name}`);
  assert.equal(typeof cjs[name], typeof esm[name], `CJS export ${name}`);
}
for (const name of [
  "runDecision", "parseDecisionPolicy", "parseDecideRequest", "parseDecideResponse",
  "validateDecisionAnswers", "sourceValueQuestion", "verificationQuestions", "evaluateDecisionGate",
]) {
  assert.equal(typeof browser[name], "function", `Required export ${name}`);
}
const fallback = { source: "reasoning" };
const result = await browser.runDecision({
  family: "bundle-smoke",
  policy: browser.parseDecisionPolicy({ mode: "legacy" }),
  state: null,
  questions: { supported: browser.noulQuestion("Is the evidence supported?") },
  accept: () => { throw new Error("Legacy mode must not accept a decision"); },
  fallback: async () => fallback,
});
assert.equal(result, fallback);
const accepted = { source: "decision" };
assert.equal(await browser.runDecision({
  family: "bundle-smoke",
  policy: browser.parseDecisionPolicy({
    mode: "active",
    families: { "bundle-smoke": { threshold: 0.99, evaluationId: "synthetic-bundle-test" } },
  }),
  state: { nested: [true, 1, null] },
  questions: { supported: browser.noulQuestion("Is the evidence supported?") },
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
  fallback: async () => { throw new Error("Valid active decision must be accepted"); },
}), accepted);
console.log("Decision subpath: browser bundle has no external imports; browser execution and ESM/CJS exports passed.");

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
  assert.deepEqual(output.imports, [], "Audit browser bundle must have no external imports");
}
const auditContext = { AbortController, setTimeout, clearTimeout, TextEncoder };
runInNewContext(auditBundle.outputFiles[0].text, auditContext);
const auditEsm = await import("@claritylabs/cl-sdk/extraction-audit");
const auditCjs = createRequire(import.meta.url)("@claritylabs/cl-sdk/extraction-audit");
for (const name of Object.keys(auditEsm)) {
  assert.equal(typeof auditContext.audit[name], typeof auditEsm[name]);
  assert.equal(typeof auditCjs[name], typeof auditEsm[name]);
}
for (const name of ["auditExtractionEvidence", "parseExtractionEvidenceAudit", "validateExtractionAuditBinding"]) {
  assert.equal(typeof auditContext.audit[name], "function");
}
const auditSmoke = await auditContext.audit.auditExtractionEvidence({
  profile: { documentType: "policy", linesOfBusiness: [], sourceSpanIds: [], sourceNodeIds: [],
    declarationFacts: [], coverages: [], parties: [], endorsementSupport: [], warnings: [] },
  sourceSpans: [], sourceTree: [],
});
assert.equal(auditSmoke.audit.status, "not_run");
assert.equal(auditSmoke.audit.visualCompleteness, "not_assessed");
console.log("Extraction audit subpath: browser bundle, execution, and ESM/CJS exports passed.");
