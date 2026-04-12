import { z } from "zod";

// ── Field Types ──

export const FieldTypeSchema = z.enum([
  "text",
  "numeric",
  "currency",
  "date",
  "yes_no",
  "table",
  "declaration",
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

// ── Application Field (extracted from PDF) ──

export const ApplicationFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  section: z.string(),
  fieldType: FieldTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  columns: z.array(z.string()).optional(),
  requiresExplanationIfYes: z.boolean().optional(),
  condition: z
    .object({
      dependsOn: z.string(),
      whenValue: z.string(),
    })
    .optional(),
  value: z.string().optional(),
  source: z.string().optional().describe("Where the value came from: auto-fill, user, lookup"),
  confidence: z.enum(["confirmed", "high", "medium", "low"]).optional(),
});
export type ApplicationField = z.infer<typeof ApplicationFieldSchema>;

// ── Classify Result ──

export const ApplicationClassifyResultSchema = z.object({
  isApplication: z.boolean(),
  confidence: z.number().min(0).max(1),
  applicationType: z.string().nullable(),
});
export type ApplicationClassifyResult = z.infer<typeof ApplicationClassifyResultSchema>;

// ── Field Extraction Result ──

export const FieldExtractionResultSchema = z.object({
  fields: z.array(ApplicationFieldSchema),
});
export type FieldExtractionResult = z.infer<typeof FieldExtractionResultSchema>;

// ── Auto-Fill Match ──

export const AutoFillMatchSchema = z.object({
  fieldId: z.string(),
  value: z.string(),
  confidence: z.enum(["confirmed"]),
  contextKey: z.string(),
});
export type AutoFillMatch = z.infer<typeof AutoFillMatchSchema>;

export const AutoFillResultSchema = z.object({
  matches: z.array(AutoFillMatchSchema),
});
export type AutoFillResult = z.infer<typeof AutoFillResultSchema>;

// ── Question Batch ──

export const QuestionBatchResultSchema = z.object({
  batches: z.array(z.array(z.string()).describe("Array of field IDs in this batch")),
});
export type QuestionBatchResult = z.infer<typeof QuestionBatchResultSchema>;

// ── Reply Intent ──

export const LookupRequestSchema = z.object({
  type: z.string().describe("Type of lookup: 'records', 'website', 'policy'"),
  description: z.string(),
  url: z.string().optional(),
  targetFieldIds: z.array(z.string()),
});
export type LookupRequest = z.infer<typeof LookupRequestSchema>;

export const ReplyIntentSchema = z.object({
  primaryIntent: z.enum(["answers_only", "question", "lookup_request", "mixed"]),
  hasAnswers: z.boolean(),
  questionText: z.string().optional(),
  questionFieldIds: z.array(z.string()).optional(),
  lookupRequests: z.array(LookupRequestSchema).optional(),
});
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;

// ── Parsed Answer ──

export const ParsedAnswerSchema = z.object({
  fieldId: z.string(),
  value: z.string(),
  explanation: z.string().optional(),
});
export type ParsedAnswer = z.infer<typeof ParsedAnswerSchema>;

export const AnswerParsingResultSchema = z.object({
  answers: z.array(ParsedAnswerSchema),
  unanswered: z.array(z.string()).describe("Field IDs that were not answered"),
});
export type AnswerParsingResult = z.infer<typeof AnswerParsingResultSchema>;

// ── Lookup Fill ──

export const LookupFillSchema = z.object({
  fieldId: z.string(),
  value: z.string(),
  source: z.string().describe("Specific citable reference, e.g. 'GL Policy #POL-12345 (Hartford)'"),
});
export type LookupFill = z.infer<typeof LookupFillSchema>;

export const LookupFillResultSchema = z.object({
  fills: z.array(LookupFillSchema),
  unfillable: z.array(z.string()),
  explanation: z.string().optional(),
});
export type LookupFillResult = z.infer<typeof LookupFillResultSchema>;

// ── PDF Mapping ──

export const FlatPdfPlacementSchema = z.object({
  fieldId: z.string(),
  page: z.number(),
  x: z.number().describe("Percentage from left edge (0-100)"),
  y: z.number().describe("Percentage from top edge (0-100)"),
  text: z.string(),
  fontSize: z.number().optional(),
  isCheckmark: z.boolean().optional(),
});
export type FlatPdfPlacement = z.infer<typeof FlatPdfPlacementSchema>;

export const AcroFormMappingSchema = z.object({
  fieldId: z.string(),
  acroFormName: z.string(),
  value: z.string(),
});
export type AcroFormMapping = z.infer<typeof AcroFormMappingSchema>;

// ── Application State (persistent) ──

export const ApplicationStateSchema = z.object({
  id: z.string(),
  pdfBase64: z.string().optional().describe("Original PDF, omitted after extraction"),
  title: z.string().optional(),
  applicationType: z.string().nullable().optional(),
  fields: z.array(ApplicationFieldSchema),
  batches: z.array(z.array(z.string())).optional(),
  currentBatchIndex: z.number().default(0),
  status: z.enum(["classifying", "extracting", "auto_filling", "batching", "collecting", "confirming", "mapping", "complete"]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ApplicationState = z.infer<typeof ApplicationStateSchema>;
