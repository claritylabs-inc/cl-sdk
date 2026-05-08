import { z } from "zod";
import {
  AgenticExecutionModeSchema,
  CaseCitationSchema,
  CaseEvidenceSourceSchema,
  CasePacketArtifactSchema,
  CaseSubmissionPacketSchema,
  CaseValidationIssueSchema,
  MissingInfoQuestionSchema,
} from "../case";

export const PolicyChangeActionSchema = z.enum(["add", "remove", "update", "replace", "clarify"]);
export type PolicyChangeAction = z.infer<typeof PolicyChangeActionSchema>;

export const PolicyChangeKindSchema = z.enum([
  "named_insured_change",
  "additional_insured_change",
  "coverage_change",
  "limit_change",
  "deductible_change",
  "location_change",
  "vehicle_change",
  "certificate_endorsement_request",
  "cancellation",
  "nonrenewal",
  "renewal_submission_update",
  "general_endorsement",
]);
export type PolicyChangeKind = z.infer<typeof PolicyChangeKindSchema>;

export const PolicyChangeConfidenceSchema = z.enum(["high", "medium", "low"]);
export type PolicyChangeConfidence = z.infer<typeof PolicyChangeConfidenceSchema>;

export const PolicyChangeStatusSchema = z.enum(["draft", "needs_info", "ready", "blocked"]);
export type PolicyChangeStatus = z.infer<typeof PolicyChangeStatusSchema>;

export const PolicyChangeItemSchema = z.object({
  id: z.string(),
  kind: PolicyChangeKindSchema.default("general_endorsement"),
  action: PolicyChangeActionSchema,
  affectedPolicyId: z.string().default("unknown"),
  fieldPath: z.string().describe("Stable policy field path or business field name"),
  label: z.string(),
  beforeValue: z.string().optional().describe("Existing policy value, when cited from policy evidence"),
  afterValue: z.string().optional().describe("Requested new value"),
  requestedValue: z.string().optional().describe("Alias for afterValue used by policy-change workflows"),
  effectiveDate: z.string().optional(),
  reason: z.string().optional(),
  sourceIds: z.array(z.string()).default([]),
  sourceSpanIds: z.array(z.string()).default([]),
  userSourceSpanIds: z.array(z.string()).optional(),
  citations: z.array(CaseCitationSchema).default([]),
  confidence: PolicyChangeConfidenceSchema.default("medium"),
  confidenceScore: z.number().min(0).max(1).optional(),
  status: PolicyChangeStatusSchema.default("ready"),
});
export type PolicyChangeItem = z.infer<typeof PolicyChangeItemSchema>;

export const PceNormalizationResultSchema = z.object({
  summary: z.string(),
  items: z.array(PolicyChangeItemSchema.omit({ id: true, status: true }).extend({
    id: z.string().optional(),
    status: PolicyChangeStatusSchema.optional(),
  })),
  missingInfoQuestions: z.array(MissingInfoQuestionSchema.omit({ id: true }).extend({
    id: z.string().optional(),
  })).default([]),
});
export type PceNormalizationResult = z.infer<typeof PceNormalizationResultSchema>;

export const PolicyChangeImpactSchema = z.object({
  itemId: z.string(),
  beforeValue: z.string().optional(),
  requestedValue: z.string().optional(),
  likelyEndorsementRequired: z.boolean().default(true),
  carrierApprovalLikelyRequired: z.boolean().default(true),
  affectedCoverageForms: z.array(z.string()).default([]),
  sourceSpanIds: z.array(z.string()).default([]),
});
export type PolicyChangeImpact = z.infer<typeof PolicyChangeImpactSchema>;

export const PceCaseStateSchema = z.object({
  id: z.string(),
  requestText: z.string(),
  summary: z.string(),
  executionMode: AgenticExecutionModeSchema.default("deterministic_tree"),
  items: z.array(PolicyChangeItemSchema),
  impacts: z.array(PolicyChangeImpactSchema),
  evidenceSources: z.array(CaseEvidenceSourceSchema),
  validationIssues: z.array(CaseValidationIssueSchema),
  missingInfoQuestions: z.array(MissingInfoQuestionSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PceCaseState = z.infer<typeof PceCaseStateSchema>;

export const PolicyChangeRequestSchema = z.object({
  id: z.string(),
  text: z.string(),
  executionMode: AgenticExecutionModeSchema.optional(),
  userSourceSpanIds: z.array(z.string()).optional(),
  createdAt: z.number().optional(),
});
export type PolicyChangeRequest = z.infer<typeof PolicyChangeRequestSchema>;

export const PceSubmissionPacketSchema = CaseSubmissionPacketSchema.extend({
  pceCase: PceCaseStateSchema,
  artifacts: z.array(CasePacketArtifactSchema),
});
export type PceSubmissionPacket = z.infer<typeof PceSubmissionPacketSchema>;

export type PolicyChangeState = PceCaseState;
export type PolicyChangeValidationIssue = z.infer<typeof CaseValidationIssueSchema>;
export type PolicyChangeMissingInfoQuestion = z.infer<typeof MissingInfoQuestionSchema>;
export type PolicyChangePacket = PceSubmissionPacket;
export type PceEvidenceSource = z.infer<typeof CaseEvidenceSourceSchema>;
export type PceValidationIssue = z.infer<typeof CaseValidationIssueSchema>;
export type PceMissingInfoQuestion = z.infer<typeof MissingInfoQuestionSchema>;
