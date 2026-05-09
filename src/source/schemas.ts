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
