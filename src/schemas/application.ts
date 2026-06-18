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
  sourceSpanIds: z.array(z.string()).optional().describe("Stable source spans that support the field value or field anchor"),
  userSourceSpanIds: z.array(z.string()).optional().describe("Message or attachment spans that support user-provided values"),
  pageNumber: z.number().int().positive().optional().describe("Application page where the field label or anchor appears"),
  fieldAnchorId: z.string().optional().describe("Stable field anchor ID derived from page, section, label, and form metadata"),
  acroFormName: z.string().optional().describe("Native PDF AcroForm field name when available"),
  validationStatus: z.enum(["valid", "needs_review", "unsupported", "missing"]).optional(),
});
export type ApplicationField = z.infer<typeof ApplicationFieldSchema>;

// ── Versioned Question Graph ──

export const ApplicationQuestionConditionSchema = z.object({
  dependsOn: z.string(),
  operator: z.enum(["equals", "not_equals", "in", "not_in", "exists"]).optional(),
  value: z.string().optional(),
  whenValue: z.string().optional(),
  values: z.array(z.string()).optional(),
});
export type ApplicationQuestionCondition = z.infer<typeof ApplicationQuestionConditionSchema>;

export const ApplicationRepeatSchema = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  label: z.string().optional(),
});
export type ApplicationRepeat = z.infer<typeof ApplicationRepeatSchema>;

export interface ApplicationQuestionNode {
  id: string;
  nodeType: "group" | "question" | "repeat_group" | "table";
  fieldId?: string;
  fieldPath?: string;
  parentId?: string;
  order?: number;
  label: string;
  section?: string;
  fieldType?: FieldType;
  required?: boolean;
  prompt?: string;
  options?: string[];
  columns?: string[];
  condition?: ApplicationQuestionCondition;
  repeat?: ApplicationRepeat;
  children?: ApplicationQuestionNode[];
}

export const ApplicationQuestionNodeSchema: z.ZodType<ApplicationQuestionNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    nodeType: z.enum(["group", "question", "repeat_group", "table"]),
    fieldId: z.string().optional(),
    fieldPath: z.string().optional(),
    parentId: z.string().optional(),
    order: z.number().int().nonnegative().optional(),
    label: z.string(),
    section: z.string().optional(),
    fieldType: FieldTypeSchema.optional(),
    required: z.boolean().optional(),
    prompt: z.string().optional(),
    options: z.array(z.string()).optional(),
    columns: z.array(z.string()).optional(),
    condition: ApplicationQuestionConditionSchema.optional(),
    repeat: ApplicationRepeatSchema.optional(),
    children: z.array(ApplicationQuestionNodeSchema).optional(),
  }),
);

export const ApplicationQuestionGraphSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string().optional(),
  applicationType: z.string().nullable().optional(),
  source: z.enum(["pdf", "manual", "imported", "generated"]).default("generated"),
  rootNodeIds: z.array(z.string()).optional(),
  nodes: z.array(ApplicationQuestionNodeSchema),
});
export type ApplicationQuestionGraph = z.infer<typeof ApplicationQuestionGraphSchema>;

export const ApplicationTemplateSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  applicationType: z.string().nullable().optional(),
  questionGraph: ApplicationQuestionGraphSchema,
  fields: z.array(ApplicationFieldSchema).optional(),
});
export type ApplicationTemplate = z.infer<typeof ApplicationTemplateSchema>;

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
  sourceSpanIds: z.array(z.string()).optional(),
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

// ── Quality Report (shared schema for serialization) ──

const QualityGateStatusSchema = z.enum(["passed", "warning", "failed"]);
const QualitySeveritySchema = z.enum(["info", "warning", "blocking"]);

export const ApplicationQualityIssueSchema = z.object({
  code: z.string(),
  severity: QualitySeveritySchema,
  message: z.string(),
  fieldId: z.string().optional(),
});

export const ApplicationQualityRoundSchema = z.object({
  round: z.number(),
  kind: z.string(),
  status: QualityGateStatusSchema,
  summary: z.string().optional(),
});

export const ApplicationQualityArtifactSchema = z.object({
  kind: z.string(),
  label: z.string().optional(),
  itemCount: z.number().optional(),
});

export const ApplicationEmailReviewSchema = z.object({
  issues: z.array(ApplicationQualityIssueSchema),
  qualityGateStatus: QualityGateStatusSchema,
});

export const ApplicationQualityReportSchema = z.object({
  issues: z.array(ApplicationQualityIssueSchema),
  rounds: z.array(ApplicationQualityRoundSchema).optional(),
  artifacts: z.array(ApplicationQualityArtifactSchema).optional(),
  emailReview: ApplicationEmailReviewSchema.optional(),
  qualityGateStatus: QualityGateStatusSchema,
});

// ── Context Proposals And Packets ──

export const ApplicationContextProposalSchema = z.object({
  id: z.string(),
  fieldId: z.string().optional(),
  key: z.string(),
  value: z.string(),
  category: z.string(),
  source: z.enum(["application", "user", "lookup", "policy", "email", "chat", "imessage", "mcp"]),
  confidence: z.enum(["confirmed", "high", "medium", "low"]),
  sourceSpanIds: z.array(z.string()).optional(),
  userSourceSpanIds: z.array(z.string()).optional(),
});
export type ApplicationContextProposal = z.infer<typeof ApplicationContextProposalSchema>;

export const ApplicationPacketAnswerSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  section: z.string(),
  value: z.string(),
  source: z.string(),
  confidence: z.enum(["confirmed", "high", "medium", "low"]).optional(),
  sourceSpanIds: z.array(z.string()).optional(),
  userSourceSpanIds: z.array(z.string()).optional(),
});
export type ApplicationPacketAnswer = z.infer<typeof ApplicationPacketAnswerSchema>;

export const ApplicationPacketSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  title: z.string(),
  status: z.enum(["draft", "broker_ready", "submitted"]),
  answers: z.array(ApplicationPacketAnswerSchema),
  missingFieldIds: z.array(z.string()),
  qualityReport: ApplicationQualityReportSchema,
  submissionNotes: z.string().optional(),
  createdAt: z.number(),
});
export type ApplicationPacket = z.infer<typeof ApplicationPacketSchema>;

// ── Application State (persistent) ──

export const ApplicationStateSchema = z.object({
  id: z.string(),
  pdfBase64: z.string().optional().describe("Original PDF, omitted after extraction"),
  templateId: z.string().optional(),
  templateVersion: z.string().optional(),
  templateSnapshot: ApplicationTemplateSchema.optional(),
  title: z.string().optional(),
  applicationType: z.string().nullable().optional(),
  questionGraph: ApplicationQuestionGraphSchema.optional(),
  fields: z.array(ApplicationFieldSchema),
  batches: z.array(z.array(z.string())).optional(),
  currentBatchIndex: z.number().default(0),
  contextProposals: z.array(ApplicationContextProposalSchema).optional(),
  packet: ApplicationPacketSchema.optional(),
  qualityReport: ApplicationQualityReportSchema.optional(),
  status: z.enum([
    "classifying",
    "extracting",
    "auto_filling",
    "batching",
    "collecting",
    "confirming",
    "mapping",
    "broker_review",
    "packet_ready",
    "submitted",
    "cancelled",
    "complete",
  ]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ApplicationState = z.infer<typeof ApplicationStateSchema>;
