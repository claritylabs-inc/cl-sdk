import { z } from "zod";
import type { InsuranceDocument } from "../schemas/document";
import type {
  DocumentSourceNode,
  PolicyOperationalProfile,
  SourceSpan,
} from "../source/schemas";
import {
  inventoryExtractionEvidence,
  readableAuditSpan,
} from "./evidence-audit-inventory";
import { stableHash } from "../source/ids";

export interface ExtractionAuditSnapshot {
  profile: PolicyOperationalProfile;
  document?: InsuranceDocument;
}
export interface ExtractionAuditBinding extends ExtractionAuditSnapshot {
  sourceSpans: SourceSpan[];
  sourceTree: DocumentSourceNode[];
  /** Original parser units, when normalization changed the completion's spans. */
  originalSourceSpans?: SourceSpan[];
}
export interface ExtractionAuditOptions {
  maxQuestionsPerCall?: number;
  maxRequestBytes?: number;
  concurrency?: number;
  maxRequests?: number;
  executionBudgetMs?: number;
  maxRepairRounds?: number;
  signal?: AbortSignal;
}
const count = z.number().int().nonnegative();
const fingerprint = z.string().regex(/^[a-f0-9]{16}$/);
const traversal = z
  .object({
    total: count,
    attempted: count,
    verified: count,
    unresolved: count,
    manifestFingerprint: fingerprint,
  })
  .strict()
  .refine(
    (v) =>
      v.attempted <= v.total &&
      v.verified <= v.attempted &&
      v.unresolved === v.total - v.verified,
    "Invalid traversal counts",
  );
const auditIssueCodes = [
  "missing_source",
  "invalid_source_identity",
  "stale_source_hash",
  "invalid_citation",
  "missing_citation",
  "unreadable_source",
  "oversized_context",
  "request_limit",
  "deadline",
  "decision_uncertain",
  "unsupported_fact",
  "contradiction",
  "missing_fact",
  "unsupported_class",
  "incomplete_context",
  "cross_unit_context",
  "snapshot_changed",
  "repair_failed",
  "repair_scope_changed",
  "source_normalization_gap",
] as const;
export interface ExtractionAuditIssue {
  code: (typeof auditIssueCodes)[number];
  direction: "forward" | "reverse" | "context";
  targetId: string;
}
export interface ExtractionAuditTraversal {
  total: number;
  attempted: number;
  verified: number;
  unresolved: number;
  manifestFingerprint: string;
}
export interface ExtractionAuditBatch {
  round: number;
  questionCount: number;
  requestBytes: number;
  forwardUnitIds: string[];
  uncitedFactUnitIds: string[];
  reverseUnitIds: string[];
  sourceContextFingerprint: string;
  durationMs: number;
  outcome: "accepted" | "fallback" | "shadow" | "bypass" | "aborted";
  requestId?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  cost?: { status: "priced" | "unpriced"; costNanoUsd: number | null };
}
export interface ExtractionEvidenceAudit {
  version: "extraction-evidence-audit-v1";
  status: "not_run" | "shadow" | "verified_text" | "unresolved";
  scope: "provided_source_text";
  visualCompleteness: "not_assessed";
  auditedSnapshots: ("profile" | "document")[];
  sourceFingerprint: string;
  resultFingerprint: string;
  profileFingerprint: string;
  documentFingerprint?: string;
  evidenceLedgerHash: string;
  inputSourceFingerprint?: string;
  unrepresentedInputUnits: number;
  forward: ExtractionAuditTraversal;
  reverse: ExtractionAuditTraversal;
  issueCount: number;
  issues: ExtractionAuditIssue[];
  issuesTruncated: boolean;
  repairRounds: number;
  metrics: {
    requestCount: number;
    questionCount: number;
    requestBytes: number;
    durationMs: number;
    maxConcurrency: number;
    batches: ExtractionAuditBatch[];
  };
  policyVersion?: string;
  evaluationId?: string;
  acceptanceThreshold?: number;
}
export const ExtractionAuditIssueSchema: z.ZodType<ExtractionAuditIssue> = z
  .object({
    code: z.enum(auditIssueCodes),
    direction: z.enum(["forward", "reverse", "context"]),
    targetId: z.string().min(1).max(2048),
  })
  .strict();
const batch = z
  .object({
    round: count.max(1),
    questionCount: count.min(1).max(128),
    requestBytes: count.min(1024).max(4 * 1024 * 1024),
    forwardUnitIds: z.array(z.string().regex(/^f(?:0|[1-9]\d*)$/)).max(128),
    uncitedFactUnitIds: z.array(z.string().regex(/^f(?:0|[1-9]\d*)$/)).max(128),
    reverseUnitIds: z.array(z.string().regex(/^s(?:0|[1-9]\d*)$/)).max(128),
    sourceContextFingerprint: fingerprint,
    durationMs: count,
    outcome: z.enum(["accepted", "fallback", "shadow", "bypass", "aborted"]),
    requestId: z.string().max(256).optional(),
    model: z.string().max(256).optional(),
    usage: z
      .object({ inputTokens: count, outputTokens: count })
      .strict()
      .optional(),
    cost: z
      .object({
        status: z.enum(["priced", "unpriced"]),
        costNanoUsd: count.nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const ExtractionEvidenceAuditSchema: z.ZodType<ExtractionEvidenceAudit> =
  z
    .object({
      version: z.literal("extraction-evidence-audit-v1"),
      status: z.enum(["not_run", "shadow", "verified_text", "unresolved"]),
      scope: z.literal("provided_source_text"),
      visualCompleteness: z.literal("not_assessed"),
      auditedSnapshots: z
        .array(z.enum(["profile", "document"]))
        .min(1)
        .max(2),
      sourceFingerprint: fingerprint,
      resultFingerprint: fingerprint,
      profileFingerprint: fingerprint,
      documentFingerprint: fingerprint.optional(),
      evidenceLedgerHash: fingerprint,
      inputSourceFingerprint: fingerprint.optional(),
      unrepresentedInputUnits: count,
      forward: traversal,
      reverse: traversal,
      issueCount: count,
      issues: z.array(ExtractionAuditIssueSchema).max(64),
      issuesTruncated: z.boolean(),
      repairRounds: count.max(1),
      metrics: z
        .object({
          requestCount: count.max(64),
          questionCount: count,
          requestBytes: count,
          durationMs: count,
          maxConcurrency: count.max(4),
          batches: z.array(batch).max(64),
        })
        .strict(),
      policyVersion: z.string().max(256).optional(),
      evaluationId: z.string().max(256).optional(),
      acceptanceThreshold: z.number().gt(0.5).max(1).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const bad = (message: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      if (
        new Set(value.auditedSnapshots).size !==
          value.auditedSnapshots.length ||
        value.auditedSnapshots[0] !== "profile" ||
        value.auditedSnapshots.includes("document") !==
          !!value.documentFingerprint
      )
        bad("Invalid audited snapshot scope");
      if (
        value.issueCount < value.issues.length ||
        value.issuesTruncated !== value.issueCount > value.issues.length
      )
        bad("Invalid issue counts");
      if (
        value.status === "verified_text" &&
        (value.issueCount ||
          value.forward.unresolved ||
          value.reverse.unresolved ||
          value.unrepresentedInputUnits ||
          !value.reverse.total ||
          !value.evaluationId ||
          !value.acceptanceThreshold ||
          !value.metrics.requestCount ||
          !value.metrics.maxConcurrency)
      )
        bad("Incomplete audit cannot be verified");
      if (
        value.metrics.requestCount !== value.metrics.batches.length ||
        value.metrics.maxConcurrency > value.metrics.requestCount ||
        value.metrics.questionCount !==
          value.metrics.batches.reduce((n, b) => n + b.questionCount, 0) ||
        value.metrics.requestBytes !==
          value.metrics.batches.reduce((n, b) => n + b.requestBytes, 0)
      )
        bad("Invalid request accounting");
      for (const batch of value.metrics.batches) {
        if (
          batch.cost &&
          (batch.cost.status === "unpriced") !==
            (batch.cost.costNanoUsd === null)
        )
          bad("Invalid batch cost");
        if (
          batch.questionCount !==
            batch.forwardUnitIds.length * 3 + batch.reverseUnitIds.length * 4 ||
          new Set(batch.forwardUnitIds).size !== batch.forwardUnitIds.length ||
          new Set(batch.uncitedFactUnitIds).size !==
            batch.uncitedFactUnitIds.length ||
          batch.uncitedFactUnitIds.some(
            (id) => !batch.forwardUnitIds.includes(id),
          ) ||
          new Set(batch.reverseUnitIds).size !== batch.reverseUnitIds.length ||
          batch.round > value.repairRounds
        )
          bad("Invalid batch traversal");
      }
      if (value.status === "verified_text") {
        const finalBatches = value.metrics.batches.filter(
          (batch) => batch.round === value.repairRounds,
        );
        if (
          !finalBatches.length ||
          finalBatches.some(
            (batch) =>
              batch.outcome !== "accepted" || !batch.requestId || !batch.model,
          )
        )
          bad("Verification requires accepted final-round responses");
        for (const [prefix, traversal] of [
          ["f", value.forward],
          ["s", value.reverse],
        ] as const) {
          const ids = finalBatches.flatMap((batch) =>
            prefix === "f" ? batch.forwardUnitIds : batch.reverseUnitIds,
          );
          if (
            ids.length !== traversal.total ||
            new Set(ids).size !== ids.length ||
            ids.some((id) => Number(id.slice(1)) >= traversal.total)
          )
            bad("Incomplete verified traversal");
        }
      }
    });
export interface ExtractionAuditRepairRequest {
  snapshot: ExtractionAuditSnapshot;
  issues: ExtractionAuditIssue[];
  factPaths: string[];
  sourceSpanIds: string[];
  sourceFingerprint: string;
  resultFingerprint: string;
  signal: AbortSignal;
}

/** Validates diagnostic structure; never constitutes authorization or model proof. */
export function parseExtractionEvidenceAudit(
  value: unknown,
  binding?: ExtractionAuditBinding,
): ExtractionEvidenceAudit {
  const parsed = ExtractionEvidenceAuditSchema.parse(ownReportValue(value));
  if (binding) validateExtractionAuditBinding(parsed, binding);
  return parsed;
}

/** Reject changed snapshots and invented traversal totals/manifests before persistence. */
export function validateExtractionAuditBinding(
  audit: ExtractionEvidenceAudit,
  binding: ExtractionAuditBinding,
): void {
  ExtractionEvidenceAuditSchema.parse(ownReportValue(audit));
  const expected = inventoryExtractionEvidence(binding);
  const matches =
    audit.sourceFingerprint === expected.sourceFingerprint &&
    audit.resultFingerprint === expected.resultFingerprint &&
    audit.profileFingerprint === expected.profileFingerprint &&
    audit.documentFingerprint === expected.documentFingerprint &&
    audit.evidenceLedgerHash === expected.evidenceLedgerHash &&
    audit.inputSourceFingerprint === expected.inputSourceFingerprint &&
    audit.unrepresentedInputUnits === expected.unrepresentedInputUnits &&
    audit.forward.total === expected.facts.length &&
    audit.reverse.total === expected.units.length &&
    audit.forward.manifestFingerprint === expected.forwardManifest &&
    audit.reverse.manifestFingerprint === expected.reverseManifest;
  if (!matches || !binding.sourceSpans.length || !binding.sourceTree.length)
    throw new Error("Extraction audit snapshot binding mismatch");
  if (
    audit.status === "verified_text" &&
    (expected.issues.length ||
      expected.facts.some((fact) => !fact.citationValid) ||
      expected.units.some((span) => !readableAuditSpan(span)) ||
      audit.metrics.batches
        .filter((batch) => batch.round === audit.repairRounds)
        .some(
          (batch) =>
            batch.sourceContextFingerprint !== stableHash(expected.units),
        ))
  )
    throw new Error("Invalid or incomplete evidence cannot be verified");
  if (audit.status === "verified_text") {
    const finalBatches = audit.metrics.batches.filter(
      (batch) => batch.round === audit.repairRounds,
    );
    for (const batch of finalBatches) {
      const expectedUncited = batch.forwardUnitIds.filter(
        (id) => !expected.facts[Number(id.slice(1))].sourceSpanIds.length,
      );
      if (
        stableHash([...batch.uncitedFactUnitIds].sort()) !==
        stableHash(expectedUncited.sort())
      )
        throw new Error("Invalid uncited fact receipt");
    }
  }
}

// Reports are JSON values; prototype properties cannot supply required fields.
function ownReportValue(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error("Invalid extraction audit report depth");
  if (Array.isArray(value))
    return value.map((item) => ownReportValue(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        ownReportValue(item, depth + 1),
      ]),
    );
  return value;
}
