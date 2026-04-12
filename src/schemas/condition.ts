import { z } from "zod";
import { ConditionTypeSchema } from "./enums";

export const ConditionKeyValueSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const PolicyConditionSchema = z.object({
  name: z.string(),
  conditionType: ConditionTypeSchema,
  content: z.string(),
  keyValues: z.array(ConditionKeyValueSchema).optional(),
  pageNumber: z.number().optional(),
});
export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;
