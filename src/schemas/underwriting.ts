import { z } from "zod";
import { SubjectivityCategorySchema } from "./enums";

export const EnrichedSubjectivitySchema = z.object({
  description: z.string(),
  category: SubjectivityCategorySchema.optional(),
  dueDate: z.string().optional(),
  status: z.enum(["open", "satisfied", "waived"]).optional(),
  pageNumber: z.number().optional(),
});
export type EnrichedSubjectivity = z.infer<typeof EnrichedSubjectivitySchema>;

export const EnrichedUnderwritingConditionSchema = z.object({
  description: z.string(),
  category: z.string().optional(),
  pageNumber: z.number().optional(),
});
export type EnrichedUnderwritingCondition = z.infer<typeof EnrichedUnderwritingConditionSchema>;

export const BindingAuthoritySchema = z.object({
  authorizedBy: z.string().optional(),
  method: z.string().optional(),
  expiration: z.string().optional(),
  conditions: z.array(z.string()).optional(),
});
export type BindingAuthority = z.infer<typeof BindingAuthoritySchema>;
