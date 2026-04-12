import type { ApplicationField, ApplicationState } from "../schemas/application";
import type { BaseQualityIssue, QualityArtifact, QualityGateStatus, QualityRound } from "../core/quality";
import { evaluateQualityGate } from "../core/quality";

export interface ApplicationQualityIssue extends BaseQualityIssue {
  message: string;
  fieldId?: string;
}

export interface ApplicationEmailReview {
  issues: ApplicationQualityIssue[];
  qualityGateStatus: QualityGateStatus;
}

export interface ApplicationQualityReport {
  issues: ApplicationQualityIssue[];
  rounds?: QualityRound[];
  artifacts?: QualityArtifact[];
  emailReview?: ApplicationEmailReview;
  qualityGateStatus: QualityGateStatus;
}

function isVagueSource(source: string | undefined): boolean {
  if (!source) return true;
  const normalized = source.trim().toLowerCase();
  return normalized === "unknown"
    || normalized.includes("existing records")
    || normalized.includes("available data")
    || normalized === "context"
    || normalized === "user provided";
}

export function buildApplicationQualityReport(state: ApplicationState): ApplicationQualityReport {
  const issues: ApplicationQualityIssue[] = [];
  const seenIds = new Set<string>();

  for (const field of state.fields) {
    if (seenIds.has(field.id)) {
      issues.push({
        code: "duplicate_field_id",
        severity: "blocking",
        message: `Field "${field.label}" has a duplicate id "${field.id}".`,
        fieldId: field.id,
      });
    }
    seenIds.add(field.id);

    if (field.required && !field.value) {
      issues.push({
        code: "required_field_unfilled",
        severity: "warning",
        message: `Required field "${field.label}" is still unfilled.`,
        fieldId: field.id,
      });
    }

    if (field.value && !field.source) {
      issues.push({
        code: "filled_field_missing_source",
        severity: "blocking",
        message: `Filled field "${field.label}" is missing source provenance.`,
        fieldId: field.id,
      });
    }

    if (field.value && isVagueSource(field.source)) {
      issues.push({
        code: "filled_field_vague_source",
        severity: "warning",
        message: `Filled field "${field.label}" has a vague or non-citable source.`,
        fieldId: field.id,
      });
    }

    if (field.value && (!field.confidence || field.confidence === "low")) {
      issues.push({
        code: "filled_field_low_confidence",
        severity: "warning",
        message: `Filled field "${field.label}" has low or missing confidence.`,
        fieldId: field.id,
      });
    }
  }

  return {
    issues,
    rounds: [],
    artifacts: [
      { kind: "application_fields", label: "Application Fields", itemCount: state.fields.length },
    ],
    qualityGateStatus: evaluateQualityGate({ issues }),
  };
}

export function reviewBatchEmail(text: string, batchFields: ApplicationField[]): ApplicationEmailReview {
  const issues: ApplicationQualityIssue[] = [];
  const normalized = text.toLowerCase();

  for (const field of batchFields) {
    const label = field.label.trim().toLowerCase();
    if (label.length >= 6 && !normalized.includes(label)) {
      issues.push({
        code: "email_missing_field_prompt",
        severity: "warning",
        message: `Generated email does not clearly mention field "${field.label}".`,
        fieldId: field.id,
      });
    }
  }

  return {
    issues,
    qualityGateStatus: evaluateQualityGate({ issues }),
  };
}
