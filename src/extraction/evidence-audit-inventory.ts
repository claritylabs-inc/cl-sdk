import type { z } from "zod";
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
  assertAuditJson({
    profile: binding.profile,
    document: binding.document,
    sourceSpans: binding.sourceSpans,
    sourceTree: binding.sourceTree,
    originalSourceSpans: binding.originalSourceSpans,
  });
  const spans = new Map(binding.sourceSpans.map((span) => [span.id, span]));
  const nodes = new Map(binding.sourceTree.map((node) => [node.id, node]));
  const issues: ExtractionAuditIssue[] = [];
  const issue = (code: ExtractionAuditIssue["code"], targetId: string) =>
    issues.push({ code, direction: "context", targetId });
  const unrepresented = (binding.originalSourceSpans ?? []).filter(
    (span) =>
      !binding.sourceSpans.some(
        (candidate) => stableHash(candidate) === stableHash(span),
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
  if (binding.document && !documentIds.has(binding.document.id))
    issue("invalid_source_identity", "document");
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
      const own = (key: string) =>
        Object.prototype.hasOwnProperty.call(record, key);
      const spanIds =
        own("sourceSpanIds") && Array.isArray(record.sourceSpanIds)
          ? record.sourceSpanIds
          : [];
      const nodeIds = [
        ...(own("sourceNodeIds") && Array.isArray(record.sourceNodeIds)
          ? record.sourceNodeIds
          : []),
        ...(own("documentNodeId") && typeof record.documentNodeId === "string"
          ? [record.documentNodeId]
          : []),
      ];
      const ownValid =
        (!own("sourceSpanIds") || Array.isArray(record.sourceSpanIds)) &&
        (!own("sourceNodeIds") || Array.isArray(record.sourceNodeIds)) &&
        (!own("documentNodeId") ||
          record.documentNodeId === undefined ||
          typeof record.documentNodeId === "string") &&
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
    // Zod 3 uses typeName/schema; Zod 4 uses type/pipe. Avoid constructors
    // removed by a supported peer version.
    const def = schema._def as unknown as Record<string, unknown>;
    const kind =
      typeof def.typeName === "string"
        ? def.typeName.slice(3).toLowerCase()
        : def.type;
    const child = (value: unknown, childPath = path) =>
      visit(value as z.ZodTypeAny, childPath, next);
    if (kind === "effects") child(def.schema);
    else if (kind === "pipe") child(def.out);
    else if (
      ["optional", "nullable", "default", "readonly", "catch"].includes(
        String(kind),
      )
    )
      child(def.innerType);
    else if (kind === "lazy") child((def.getter as () => unknown)());
    else if (kind === "object") {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      for (const [key, value] of Object.entries(
        shape as Record<string, unknown>,
      ))
        if (!metadataKeys.has(key)) child(value, `${path}/${key}`);
    } else if (kind === "array") child(def.element ?? def.type, `${path}/*`);
    else if (kind === "union" || kind === "discriminatedunion") {
      for (const option of def.options as unknown[]) child(option);
    } else paths.add(path);
  }
  visit(PolicyOperationalProfileSchema, "/profile", new Set());
  if (includeDocument) visit(InsuranceDocumentSchema, "/document", new Set());
  return [...paths].sort();
}

export function readableAuditSpan(span: SourceSpan): boolean {
  return span.kind !== "pdf_image" && span.text.trim().length > 0;
}

function assertAuditJson(value: unknown): void {
  const ancestors = new Set<object>();
  let visited = 0;
  function visit(item: unknown, depth: number) {
    if (++visited > 1_000_000 || depth > 64)
      throw new Error("Extraction audit input exceeds structural bounds");
    if (
      item === undefined ||
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    )
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || ancestors.has(item))
      throw new Error("Extraction audit requires acyclic JSON input");
    ancestors.add(item);
    for (const child of Object.values(item)) visit(child, depth + 1);
    ancestors.delete(item);
  }
  visit(value, 0);
}
