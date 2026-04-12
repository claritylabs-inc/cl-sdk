export type QualitySeverity = "info" | "warning" | "blocking";
export type QualityGateStatus = "passed" | "warning" | "failed";
export type QualityGateMode = "off" | "warn" | "strict";

export interface BaseQualityIssue {
  code: string;
  severity: QualitySeverity;
  message: string;
}

export interface QualityRound {
  round: number;
  kind: string;
  status: "passed" | "warning" | "failed";
  summary?: string;
}

export interface QualityArtifact {
  kind: string;
  label?: string;
  itemCount?: number;
}

export interface UnifiedQualityReport<TIssue extends BaseQualityIssue = BaseQualityIssue> {
  issues: TIssue[];
  rounds: QualityRound[];
  artifacts: QualityArtifact[];
  qualityGateStatus: QualityGateStatus;
}

export function evaluateQualityGate(params: {
  issues: Array<{ severity: QualitySeverity }>;
  hasRoundWarnings?: boolean;
}): QualityGateStatus {
  const { issues, hasRoundWarnings = false } = params;
  const hasBlocking = issues.some((issue) => issue.severity === "blocking");
  const hasWarnings = issues.some((issue) => issue.severity === "warning") || hasRoundWarnings;
  return hasBlocking ? "failed" : hasWarnings ? "warning" : "passed";
}

export function shouldFailQualityGate(
  mode: QualityGateMode,
  status: QualityGateStatus,
): boolean {
  return mode === "strict" && status === "failed";
}
