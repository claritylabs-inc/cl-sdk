import type { SubjectivityCategory } from "./enums";

export interface EnrichedSubjectivity {
  description: string;
  category?: SubjectivityCategory;
  dueDate?: string;
  status?: "open" | "satisfied" | "waived";
  pageNumber?: number;
}

export interface EnrichedUnderwritingCondition {
  description: string;
  category?: string;
  pageNumber?: number;
}

export interface BindingAuthority {
  authorizedBy?: string;
  method?: string;
  expiration?: string;
  conditions?: string[];
}
