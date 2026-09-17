import { z } from "zod";
import type { InsuranceDocument } from "../schemas/document";
import type {
  DocumentSourceNode,
  PolicyOperationalProfile,
  SourceSpan,
} from "../source/schemas";
import { inventoryExtractionEvidence } from "./evidence-audit-inventory";

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
export const ExtractionAuditIssueSchema = z
  .object({
    code: z.enum([
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
    ]),
    direction: z.enum(["forward", "reverse", "context"]),
    targetId: z.string().min(1).max(2048),
  })
  .strict();
export type ExtractionAuditIssue = z.infer<typeof ExtractionAuditIssueSchema>;
const batch = z
  .object({
    round: count.max(1),
    questionCount: count.max(128),
    requestBytes: count.max(4 * 1024 * 1024),
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
export const ExtractionEvidenceAuditSchema = z
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
      new Set(value.auditedSnapshots).size !== value.auditedSnapshots.length ||
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
        !value.metrics.requestCount)
    )
      bad("Incomplete audit cannot be verified");
    if (
      value.metrics.requestCount !== value.metrics.batches.length ||
      value.metrics.questionCount !==
        value.metrics.batches.reduce((n, b) => n + b.questionCount, 0) ||
      value.metrics.requestBytes !==
        value.metrics.batches.reduce((n, b) => n + b.requestBytes, 0)
    )
      bad("Invalid request accounting");
  });
export type ExtractionEvidenceAudit = z.infer<
  typeof ExtractionEvidenceAuditSchema
>;
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
  const parsed = ExtractionEvidenceAuditSchema.parse(value);
  if (binding) validateExtractionAuditBinding(parsed, binding);
  return parsed;
}

/** Reject changed snapshots and invented traversal totals/manifests before persistence. */
export function validateExtractionAuditBinding(
  audit: ExtractionEvidenceAudit,
  binding: ExtractionAuditBinding,
): void {
  ExtractionEvidenceAuditSchema.parse(audit);
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
  if (audit.status === "verified_text" && expected.issues.length)
    throw new Error("Invalid source cannot be verified");
}
