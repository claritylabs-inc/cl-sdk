import type { ConditionType } from "./enums";

export interface PolicyCondition {
  name: string;
  conditionType: ConditionType;
  content: string;
  keyValues?: Record<string, string>;
  pageNumber?: number;
}
