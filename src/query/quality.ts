import type { Citation, EvidenceItem, QueryResult, SubAnswer } from "../schemas/query";
import type { BaseQualityIssue, QualityArtifact, QualityGateStatus, QualityRound, UnifiedQualityReport } from "../core/quality";
import { evaluateQualityGate } from "../core/quality";

export interface QueryReviewIssue extends BaseQualityIssue {
  message: string;
  subQuestion?: string;
  citationIndex?: number;
  sourceId?: string;
}

export interface QueryVerifyRoundRecord {
  round: number;
  approved: boolean;
  issues: string[];
  retrySubQuestions?: string[];
}

export interface QueryReviewReport extends UnifiedQualityReport<QueryReviewIssue> {
  verifyRounds: QueryVerifyRoundRecord[];
  qualityGateStatus: QualityGateStatus;
}

function sourceIdForEvidence(evidence: EvidenceItem): string | undefined {
  return evidence.chunkId ?? evidence.documentId ?? evidence.turnId;
}

function citationSourceId(citation: Citation): string | undefined {
  return citation.chunkId || citation.documentId;
}

export function buildQueryReviewReport(params: {
  subAnswers: SubAnswer[];
  evidence: EvidenceItem[];
  finalResult?: QueryResult;
  verifyRounds: QueryVerifyRoundRecord[];
}): QueryReviewReport {
  const { subAnswers, evidence, finalResult, verifyRounds } = params;
  const issues: QueryReviewIssue[] = [];

  const evidenceBySource = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    const sourceId = sourceIdForEvidence(item);
    if (!sourceId) continue;
    evidenceBySource.set(sourceId, [...(evidenceBySource.get(sourceId) ?? []), item]);
  }

  for (const subAnswer of subAnswers) {
    if (!subAnswer.needsMoreContext && subAnswer.citations.length === 0) {
      issues.push({
        code: "subanswer_missing_citations",
        severity: "blocking",
        message: `Sub-answer "${subAnswer.subQuestion}" has no citations despite claiming an answer.`,
        subQuestion: subAnswer.subQuestion,
      });
    }

    if (subAnswer.confidence >= 0.85 && subAnswer.citations.length === 0) {
      issues.push({
        code: "subanswer_high_confidence_without_citations",
        severity: "blocking",
        message: `Sub-answer "${subAnswer.subQuestion}" has high confidence without citations.`,
        subQuestion: subAnswer.subQuestion,
      });
    }

    for (const citation of subAnswer.citations) {
      const sourceId = citationSourceId(citation);
      const supportedEvidence = sourceId ? evidenceBySource.get(sourceId) ?? [] : [];

      if (!sourceId || supportedEvidence.length === 0) {
        issues.push({
          code: "citation_missing_from_evidence",
          severity: "blocking",
          message: `Citation [${citation.index}] in "${subAnswer.subQuestion}" does not map to retrieved evidence.`,
          subQuestion: subAnswer.subQuestion,
          citationIndex: citation.index,
          sourceId,
        });
        continue;
      }

      const quoteFound = supportedEvidence.some((item) => item.text.includes(citation.quote));
      if (!quoteFound) {
        issues.push({
          code: "citation_quote_not_in_evidence",
          severity: "warning",
          message: `Citation [${citation.index}] quote in "${subAnswer.subQuestion}" was not found verbatim in retrieved evidence.`,
          subQuestion: subAnswer.subQuestion,
          citationIndex: citation.index,
          sourceId,
        });
      }
    }
  }

  if (finalResult) {
    if (finalResult.answer.trim().length > 0 && finalResult.citations.length === 0 && finalResult.confidence > 0.4) {
      issues.push({
        code: "final_answer_missing_citations",
        severity: "blocking",
        message: "Final answer has non-trivial confidence but no citations.",
      });
    }

    const knownCitationIds = new Set(
      subAnswers.flatMap((sa) => sa.citations.map((citation) => `${citation.index}|${citation.chunkId}|${citation.documentId}`)),
    );

    for (const citation of finalResult.citations) {
      const key = `${citation.index}|${citation.chunkId}|${citation.documentId}`;
      if (!knownCitationIds.has(key)) {
        issues.push({
          code: "final_answer_unknown_citation",
          severity: "warning",
          message: `Final answer citation [${citation.index}] was not present in verified sub-answers.`,
          citationIndex: citation.index,
          sourceId: citationSourceId(citation),
        });
      }
    }
  }

  const rounds: QualityRound[] = verifyRounds.map((round) => ({
    round: round.round,
    kind: "verification",
    status: round.approved && round.issues.length === 0 ? "passed" : "warning",
    summary: round.issues[0] ?? (round.approved ? "Verification passed." : "Verification requested retry."),
  }));
  const artifacts: QualityArtifact[] = [
    { kind: "evidence", label: "Retrieved Evidence", itemCount: evidence.length },
    { kind: "sub_answers", label: "Sub Answers", itemCount: subAnswers.length },
  ];
  return {
    issues,
    rounds,
    artifacts,
    verifyRounds,
    qualityGateStatus: evaluateQualityGate({
      issues,
      hasRoundWarnings: verifyRounds.some((round) => !round.approved || round.issues.length > 0),
    }),
  };
}
