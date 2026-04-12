import { z } from "zod";
import { ConditionTypeSchema } from "./enums";

export const PolicyConditionSchema = z.object({
  name: z.string(),
  conditionType: ConditionTypeSchema,
  content: z.string(),
  keyValues: z.record(z.string(), z.string()).optional(),
  pageNumber: z.number().optional(),
});
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;
