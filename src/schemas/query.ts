import { z } from "zod";
import { PolicyTypeSchema } from "./enums";

// ── Query Intent ──

export const QueryIntentSchema = z.enum([
  "policy_question",
  "coverage_comparison",
  "document_search",
  "claims_inquiry",
  "general_knowledge",
]);
export type QueryIntent = z.infer<typeof QueryIntentSchema>;

// ── Query Attachments ──

export const QueryAttachmentKindSchema = z.enum(["image", "pdf", "text"]);
export type QueryAttachmentKind = z.infer<typeof QueryAttachmentKindSchema>;

export const QueryAttachmentSchema = z.object({
  id: z.string().optional().describe("Optional stable attachment ID from the caller"),
  kind: QueryAttachmentKindSchema,
  name: z.string().optional().describe("Original filename or user-facing label"),
  mimeType: z.string().optional().describe("MIME type such as image/jpeg or application/pdf"),
  base64: z.string().optional().describe("Base64-encoded file content for image/pdf attachments"),
  text: z.string().optional().describe("Plain-text attachment content when available"),
  description: z.string().optional().describe("Caller-provided description of the attachment"),
});
export type QueryAttachment = z.infer<typeof QueryAttachmentSchema>;

// ── Classify Result (Phase 1 output) ──

export const SubQuestionSchema = z.object({
  question: z.string().describe("Atomic sub-question to retrieve and answer independently"),
  intent: QueryIntentSchema,
  chunkTypes: z
    .array(z.string())
    .optional()
    .describe("Chunk types to filter retrieval (e.g. coverage, endorsement, declaration)"),
  documentFilters: z
    .object({
      type: z.enum(["policy", "quote"]).optional(),
      carrier: z.string().optional(),
      insuredName: z.string().optional(),
      policyNumber: z.string().optional(),
      quoteNumber: z.string().optional(),
      policyTypes: z.array(PolicyTypeSchema).optional()
        .describe("Filter by policy type (e.g. homeowners_ho3, renters_ho4, pet) to avoid mixing up similar policies"),
    })
    .optional()
    .describe("Structured filters to narrow document lookup"),
});
export type SubQuestion = z.infer<typeof SubQuestionSchema>;

export const QueryClassifyResultSchema = z.object({
  intent: QueryIntentSchema,
  subQuestions: z.array(SubQuestionSchema).min(1).describe("Decomposed atomic sub-questions"),
  requiresDocumentLookup: z.boolean().describe("Whether structured document lookup is needed"),
  requiresChunkSearch: z.boolean().describe("Whether semantic chunk search is needed"),
  requiresConversationHistory: z.boolean().describe("Whether conversation history is relevant"),
});
export type QueryClassifyResult = z.infer<typeof QueryClassifyResultSchema>;

// ── Evidence (Phase 2 output) ──

export const EvidenceItemSchema = z.object({
  source: z.enum(["chunk", "document", "conversation", "attachment"]),
  chunkId: z.string().optional(),
  documentId: z.string().optional(),
  turnId: z.string().optional(),
  attachmentId: z.string().optional(),
  text: z.string().describe("Text excerpt from the source"),
  relevance: z.number().min(0).max(1),
  metadata: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const AttachmentInterpretationSchema = z.object({
  summary: z
    .string()
    .describe("Concise summary of what the attachment shows or contains"),
  extractedFacts: z
    .array(z.string())
    .describe("Specific observable or document facts grounded in the attachment"),
  recommendedFocus: z
    .array(z.string())
    .describe("Important details to incorporate when answering follow-up questions"),
  confidence: z.number().min(0).max(1),
});
export type AttachmentInterpretation = z.infer<typeof AttachmentInterpretationSchema>;

export const RetrievalResultSchema = z.object({
  subQuestion: z.string(),
  evidence: z.array(EvidenceItemSchema),
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;

// ── Citation ──

export const CitationSchema = z.object({
  index: z.number().describe("Citation number [1], [2], etc."),
  chunkId: z.string().describe("Source chunk ID, e.g. doc-123:coverage:2"),
  documentId: z.string(),
  documentType: z.enum(["policy", "quote"]).optional(),
  field: z.string().optional().describe("Specific field path, e.g. coverages[0].deductible"),
  quote: z.string().describe("Exact text from source that supports the claim"),
  relevance: z.number().min(0).max(1),
});
export type Citation = z.infer<typeof CitationSchema>;

// ── Sub-Answer (Phase 3 output) ──

export const SubAnswerSchema = z.object({
  subQuestion: z.string(),
  answer: z.string(),
  citations: z.array(CitationSchema),
  confidence: z.number().min(0).max(1),
  needsMoreContext: z.boolean().describe("True if evidence was insufficient to answer fully"),
});
export type SubAnswer = z.infer<typeof SubAnswerSchema>;

// ── Verify Result (Phase 4 output) ──

export const VerifyResultSchema = z.object({
  approved: z.boolean().describe("Whether all sub-answers are adequately grounded"),
  issues: z.array(z.string()).describe("Specific grounding or consistency issues found"),
  retrySubQuestions: z
    .array(z.string())
    .optional()
    .describe("Sub-questions that need additional retrieval or re-reasoning"),
});
export type VerifyResult = z.infer<typeof VerifyResultSchema>;

// ── Final Query Result ──

export const QueryResultSchema = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
  intent: QueryIntentSchema,
  confidence: z.number().min(0).max(1),
  followUp: z.string().optional().describe("Suggested follow-up question if applicable"),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;
