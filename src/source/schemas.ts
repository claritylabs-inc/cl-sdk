import { z } from "zod";

export const SourceSpanKindSchema = z.enum([
  "pdf_text",
  "pdf_image",
  "html",
  "markdown",
  "plain_text",
  "structured_field",
]);
export type SourceSpanKind = z.infer<typeof SourceSpanKindSchema>;

export const SourceSpanUnitSchema = z.enum([
  "page",
  "section",
  "table",
  "table_row",
  "table_cell",
  "key_value",
  "text",
]);
export type SourceSpanUnit = z.infer<typeof SourceSpanUnitSchema>;

export const SourceKindSchema = z.enum([
  "policy_pdf",
  "application_pdf",
  "email",
  "attachment",
  "manual_note",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceSpanBBoxSchema = z.object({
  page: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type SourceSpanBBox = z.infer<typeof SourceSpanBBoxSchema>;

export const SourceSpanLocationSchema = z.object({
  page: z.number().int().positive().optional(),
  startPage: z.number().int().positive().optional(),
  endPage: z.number().int().positive().optional(),
  charStart: z.number().int().nonnegative().optional(),
  charEnd: z.number().int().nonnegative().optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  fieldPath: z.string().optional(),
});
export type SourceSpanLocation = z.infer<typeof SourceSpanLocationSchema>;

export const SourceSpanTableLocationSchema = z.object({
  tableId: z.string().optional(),
  rowIndex: z.number().int().nonnegative().optional(),
  columnIndex: z.number().int().nonnegative().optional(),
  columnName: z.string().optional(),
  rowSpanId: z.string().optional(),
  tableSpanId: z.string().optional(),
  isHeader: z.boolean().optional(),
});
export type SourceSpanTableLocation = z.infer<typeof SourceSpanTableLocationSchema>;

export const SourceSpanSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  sourceKind: SourceKindSchema.optional(),
  chunkId: z.string().optional(),
  kind: SourceSpanKindSchema,
  text: z.string(),
  hash: z.string().min(1),
  textHash: z.string().optional(),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  sectionId: z.string().optional(),
  formNumber: z.string().optional(),
  sourceUnit: SourceSpanUnitSchema.optional(),
  parentSpanId: z.string().optional(),
  table: SourceSpanTableLocationSchema.optional(),
  bbox: z.array(SourceSpanBBoxSchema).optional(),
  location: SourceSpanLocationSchema.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});
export type SourceSpan = z.infer<typeof SourceSpanSchema>;

export const SourceSpanRefSchema = z.object({
  sourceSpanId: z.string().min(1),
  documentId: z.string().min(1).optional(),
  chunkId: z.string().optional(),
  quote: z.string().optional(),
  hash: z.string().optional(),
  location: SourceSpanLocationSchema.optional(),
});
export type SourceSpanRef = z.infer<typeof SourceSpanRefSchema>;

export const SourceChunkSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  sourceSpanIds: z.array(z.string().min(1)),
  text: z.string(),
  textHash: z.string().min(1),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type SourceChunk = z.infer<typeof SourceChunkSchema>;

export const DocumentSourceNodeKindSchema = z.enum([
  "document",
  "page_group",
  "page",
  "form",
  "endorsement",
  "section",
  "schedule",
  "clause",
  "table",
  "table_row",
  "table_cell",
  "text",
]);
export type DocumentSourceNodeKind = z.infer<typeof DocumentSourceNodeKindSchema>;

export const DocumentSourceNodeSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  parentId: z.string().optional(),
  kind: DocumentSourceNodeKindSchema,
  title: z.string(),
  description: z.string(),
  textExcerpt: z.string().optional(),
  sourceSpanIds: z.array(z.string().min(1)),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  bbox: z.array(SourceSpanBBoxSchema).optional(),
  order: z.number().int().nonnegative(),
  path: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DocumentSourceNode = z.infer<typeof DocumentSourceNodeSchema>;

export const SourceBackedValueSchema = z.object({
  value: z.string(),
  normalizedValue: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  sourceNodeIds: z.array(z.string().min(1)).default([]),
  sourceSpanIds: z.array(z.string().min(1)).default([]),
});
export type SourceBackedValue = z.infer<typeof SourceBackedValueSchema>;

export const OperationalCoverageTermSchema = z.object({
  kind: z.enum([
    "each_claim_limit",
    "each_occurrence_limit",
    "each_loss_limit",
    "aggregate_limit",
    "sublimit",
    "retention",
    "deductible",
    "retroactive_date",
    "premium",
    "other",
  ]).default("other"),
  label: z.string(),
  value: z.string(),
  amount: z.number().optional(),
  appliesTo: z.string().optional(),
  sourceNodeIds: z.array(z.string().min(1)).default([]),
  sourceSpanIds: z.array(z.string().min(1)).default([]),
});
export type OperationalCoverageTerm = z.infer<typeof OperationalCoverageTermSchema>;

export const OperationalCoverageLineSchema = z.object({
  name: z.string(),
  coverageCode: z.string().optional(),
  limit: z.string().optional(),
  deductible: z.string().optional(),
  premium: z.string().optional(),
  retroactiveDate: z.string().optional(),
  formNumber: z.string().optional(),
  sectionRef: z.string().optional(),
  endorsementNumber: z.string().optional(),
  limits: z.array(OperationalCoverageTermSchema).default([]),
  sourceNodeIds: z.array(z.string().min(1)).default([]),
  sourceSpanIds: z.array(z.string().min(1)).default([]),
});
export type OperationalCoverageLine = z.infer<typeof OperationalCoverageLineSchema>;

export const OperationalPartySchema = z.object({
  role: z.string(),
  name: z.string(),
  sourceNodeIds: z.array(z.string().min(1)).default([]),
  sourceSpanIds: z.array(z.string().min(1)).default([]),
});
export type OperationalParty = z.infer<typeof OperationalPartySchema>;

export const OperationalEndorsementSupportSchema = z.object({
  kind: z.string(),
  status: z.enum(["supported", "excluded", "requires_review"]),
  summary: z.string(),
  sourceNodeIds: z.array(z.string().min(1)).default([]),
  sourceSpanIds: z.array(z.string().min(1)).default([]),
});
export type OperationalEndorsementSupport = z.infer<typeof OperationalEndorsementSupportSchema>;

export const PolicyOperationalProfileSchema = z.object({
  documentType: z.enum(["policy", "quote"]).default("policy"),
  policyTypes: z.array(z.string()).default(["other"]),
  policyNumber: SourceBackedValueSchema.optional(),
  namedInsured: SourceBackedValueSchema.optional(),
  insurer: SourceBackedValueSchema.optional(),
  broker: SourceBackedValueSchema.optional(),
  effectiveDate: SourceBackedValueSchema.optional(),
  expirationDate: SourceBackedValueSchema.optional(),
  retroactiveDate: SourceBackedValueSchema.optional(),
  premium: SourceBackedValueSchema.optional(),
  coverages: z.array(OperationalCoverageLineSchema).default([]),
  parties: z.array(OperationalPartySchema).default([]),
  endorsementSupport: z.array(OperationalEndorsementSupportSchema).default([]),
  sourceNodeIds: z.array(z.string().min(1)).default([]),
  sourceSpanIds: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string()).default([]),
});
export type PolicyOperationalProfile = z.infer<typeof PolicyOperationalProfileSchema>;
