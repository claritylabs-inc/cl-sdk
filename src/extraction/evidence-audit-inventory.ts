import { z } from "zod";
import { InsuranceDocumentSchema } from "../schemas/document";
import {
  PolicyOperationalProfileSchema,
  type SourceSpan,
} from "../source/schemas";
import { stableHash, sourceSpanTextHash } from "../source/ids";
import { buildExtractionEvidenceLedger } from "../source/evidence-ledger";
import type {
  ExtractionAuditBinding,
  ExtractionAuditIssue,
} from "./evidence-audit-contract";

// Exclude transport/citation bookkeeping, not narrative or domain fields. These
// fields remain in the snapshot fingerprint even though they are not judgments.
const metadataKeys = new Set([
  "id",
  "recordId",
  "documentId",
  "documentNodeId",
  "sourceNodeIds",
  "sourceSpanIds",
  "sourceTextHash",
  "confidence",
  "warnings",
  "sourceTreeVersion",
  "sourceTreeCanonical",
  "agentGuidance",
  "extractorNames",
]);
export interface AuditFact {
  id: string;
  path: string;
  value: string | number | boolean;
  owner: string;
  sourceSpanIds: string[];
  citationValid: boolean;
}
const pointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

export function inventoryExtractionEvidence(binding: ExtractionAuditBinding) {
  const spans = new Map(binding.sourceSpans.map((span) => [span.id, span]));
  const nodes = new Map(binding.sourceTree.map((node) => [node.id, node]));
  const issues: ExtractionAuditIssue[] = [];
  const issue = (code: ExtractionAuditIssue["code"], targetId: string) =>
    issues.push({ code, direction: "context", targetId });
  const unrepresented = (binding.originalSourceSpans ?? []).filter(
    (span) =>
      !binding.sourceSpans.some(
        (candidate) => candidate.id === span.id && candidate.text === span.text,
      ),
  );
  const units = [...binding.sourceSpans, ...unrepresented];
  if (unrepresented.length)
    issue("source_normalization_gap", "original_source");
  if (!binding.sourceSpans.length || !binding.sourceTree.length)
    issue("missing_source", "source");
  if (
    spans.size !== binding.sourceSpans.length ||
    nodes.size !== binding.sourceTree.length
  )
    issue("invalid_source_identity", "source");
  const documentIds = new Set(
    binding.sourceSpans.map((span) => span.documentId),
  );
  if (documentIds.size !== 1) issue("invalid_source_identity", "source");
  for (const span of binding.sourceSpans) {
    if (
      span.hash !== sourceSpanTextHash(span.text) ||
      (span.textHash && span.textHash !== sourceSpanTextHash(span.text))
    )
      issue("stale_source_hash", span.id);
    for (const id of [
      span.parentSpanId,
      span.table?.rowSpanId,
      span.table?.tableSpanId,
    ]) {
      if (
        id &&
        (!spans.has(id) || spans.get(id)!.documentId !== span.documentId)
      )
        issue("invalid_source_identity", span.id);
    }
  }
  for (const node of binding.sourceTree) {
    if (
      !documentIds.has(node.documentId) ||
      node.sourceSpanIds.some(
        (id) => !spans.has(id) || spans.get(id)!.documentId !== node.documentId,
      )
    )
      issue("invalid_source_identity", node.id);
    if (node.parentId && !nodes.has(node.parentId))
      issue("invalid_source_identity", node.id);
  }
  const facts: AuditFact[] = [];
  function visit(
    value: unknown,
    path: string,
    inherited: string[],
    valid: boolean,
    owner: string,
  ) {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, `${path}/${index}`, inherited, valid, owner),
      );
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const spanIds = Array.isArray(record.sourceSpanIds)
        ? record.sourceSpanIds
        : [];
      const nodeIds = [
        ...(Array.isArray(record.sourceNodeIds) ? record.sourceNodeIds : []),
        ...(typeof record.documentNodeId === "string"
          ? [record.documentNodeId]
          : []),
      ];
      const ownValid =
        spanIds.every((id) => typeof id === "string" && spans.has(id)) &&
        nodeIds.every((id) => typeof id === "string" && nodes.has(id));
      const refs = [
        ...new Set([
          ...spanIds.filter(
            (id): id is string => typeof id === "string" && spans.has(id),
          ),
          ...nodeIds.flatMap((id) =>
            typeof id === "string" ? (nodes.get(id)?.sourceSpanIds ?? []) : [],
          ),
        ]),
      ].sort();
      // Invalid child citations cannot be rescued by valid parent citations.
      const evidence = refs.length ? refs : inherited;
      for (const [key, item] of Object.entries(record)) {
        if (!metadataKeys.has(key))
          visit(
            item,
            `${path}/${pointer(key)}`,
            evidence,
            valid && ownValid,
            path,
          );
      }
    } else if (
      (typeof value === "string" && value.trim()) ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      facts.push({
        id: `fact:${path}`,
        path,
        value,
        owner,
        sourceSpanIds: inherited,
        citationValid: valid,
      });
    }
  }
  visit(binding.profile, "/profile", [], true, "/profile");
  if (binding.document)
    visit(binding.document, "/document", [], true, "/document");
  const ledger = buildExtractionEvidenceLedger(
    binding.sourceSpans,
    binding.sourceTree,
  );
  return {
    facts,
    issues,
    spans,
    nodes,
    units,
    inputSourceFingerprint: binding.originalSourceSpans
      ? stableHash(binding.originalSourceSpans)
      : undefined,
    unrepresentedInputUnits: unrepresented.length,
    sourceFingerprint: stableHash({
      spans: binding.sourceSpans,
      tree: binding.sourceTree,
      originalSourceSpans: binding.originalSourceSpans,
    }),
    resultFingerprint: stableHash({
      profile: binding.profile,
      document: binding.document,
    }),
    profileFingerprint: stableHash(binding.profile),
    documentFingerprint: binding.document
      ? stableHash(binding.document)
      : undefined,
    evidenceLedgerHash: ledger.ledgerHash,
    forwardManifest: stableHash(facts.map((fact) => fact.id)),
    reverseManifest: stableHash(
      units.map((span) => ({ id: span.id, hash: stableHash(span) })),
    ),
  };
}

/** The schema catalog includes absent supported fields, not only extracted keys. */
export function auditSchemaCatalog(includeDocument: boolean): string[] {
  const paths = new Set<string>();
  function visit(
    schema: z.ZodTypeAny,
    path: string,
    ancestors: Set<z.ZodTypeAny>,
  ) {
    if (ancestors.has(schema)) {
      paths.add(`${path}/** (recursive)`);
      return;
    }
    const next = new Set(ancestors).add(schema);
    if (schema instanceof z.ZodEffects)
      return visit(schema.innerType(), path, next);
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
      return visit(schema.unwrap(), path, next);
    if (schema instanceof z.ZodDefault)
      return visit(schema.removeDefault(), path, next);
    if (schema instanceof z.ZodLazy) return visit(schema.schema, path, next);
    if (schema instanceof z.ZodObject) {
      for (const [key, child] of Object.entries(schema.shape))
        if (!metadataKeys.has(key))
          visit(child as z.ZodTypeAny, `${path}/${key}`, next);
    } else if (schema instanceof z.ZodArray)
      visit(schema.element, `${path}/*`, next);
    else if (
      schema instanceof z.ZodUnion ||
      schema instanceof z.ZodDiscriminatedUnion
    ) {
      for (const option of schema.options) visit(option, path, next);
    } else paths.add(path);
  }
  visit(PolicyOperationalProfileSchema, "/profile", new Set());
  if (includeDocument) visit(InsuranceDocumentSchema, "/document", new Set());
  return [...paths].sort();
}

export function readableAuditSpan(span: SourceSpan): boolean {
  return span.kind !== "pdf_image" && span.text.trim().length > 0;
}
