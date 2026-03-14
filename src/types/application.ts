// Types for insurance application form fields and question batches

export type FieldType =
  | "text"
  | "numeric"
  | "currency"
  | "date"
  | "yes_no"
  | "table"
  | "declaration";

export interface SimpleField {
  id: string;
  label: string;
  section: string;
  fieldType: Exclude<FieldType, "table" | "declaration">;
  required: boolean;
  value?: string;
  source?: "org_context" | "user_answer" | "inferred";
  confidence?: "confirmed" | "inferred";
  pageNumber?: number;
  condition?: { dependsOn: string; whenValue: string };
}

export interface TableField {
  id: string;
  label: string;
  section: string;
  fieldType: "table";
  columns: { name: string; type: string }[];
  rows: Record<string, string>[];
  required: boolean;
  minRows?: number;
  source?: "org_context" | "user_answer" | "inferred";
  pageNumber?: number;
}

export interface DeclarationField {
  id: string;
  text: string;
  section: string;
  fieldType: "declaration";
  value?: "yes" | "no";
  explanation?: string;
  requiresExplanationIfYes: boolean;
  source?: "org_context" | "user_answer" | "inferred";
  confidence?: "confirmed" | "inferred";
  pageNumber?: number;
}

export type FormField = SimpleField | TableField | DeclarationField;

export interface QuestionBatch {
  batchIndex: number;
  fieldIds: string[];
  sent: boolean;
  sentAt?: number;
  conversationId?: string;
  answeredFieldIds: string[];
  complete: boolean;
}

// Type guards
export function isTableField(field: FormField): field is TableField {
  return field.fieldType === "table";
}

export function isDeclarationField(field: FormField): field is DeclarationField {
  return field.fieldType === "declaration";
}

export function isConditionalField(
  field: FormField,
): field is SimpleField & { condition: { dependsOn: string; whenValue: string } } {
  return "condition" in field && field.condition !== undefined;
}
