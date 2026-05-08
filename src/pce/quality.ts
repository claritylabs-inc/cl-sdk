import type { PceCaseState } from "../schemas/pce";

export type PceQualityGateStatus = "passed" | "warning" | "failed";

export interface PceQualityReport {
  qualityGateStatus: PceQualityGateStatus;
  blockingIssues: number;
  warningIssues: number;
  missingInfoCount: number;
  ungroundedExistingValueCount: number;
}

export function buildPceQualityReport(state: PceCaseState): PceQualityReport {
  const blockingIssues = state.validationIssues.filter((issue) => issue.severity === "blocking").length;
  const warningIssues = state.validationIssues.filter((issue) => issue.severity === "warning").length;
  const missingInfoCount = state.missingInfoQuestions.filter((question) => !question.answer?.trim()).length;
  const ungroundedExistingValueCount = state.items.filter((item) =>
    item.beforeValue?.trim() && item.sourceSpanIds.length === 0,
  ).length;

  const qualityGateStatus: PceQualityGateStatus = blockingIssues > 0 || ungroundedExistingValueCount > 0
    ? "failed"
    : warningIssues > 0 || missingInfoCount > 0
      ? "warning"
      : "passed";

  return {
    qualityGateStatus,
    blockingIssues,
    warningIssues,
    missingInfoCount,
    ungroundedExistingValueCount,
  };
}
