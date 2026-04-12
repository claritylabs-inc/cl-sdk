import { describe, it, expect } from "vitest";
import { buildQueryReviewReport } from "../../query/quality";

describe("buildQueryReviewReport", () => {
  it("fails when a confident sub-answer has no citations", () => {
    const report = buildQueryReviewReport({
      subAnswers: [
        {
          subQuestion: "What is the deductible?",
          answer: "$2,500",
          citations: [],
          confidence: 0.92,
          needsMoreContext: false,
        },
      ],
      evidence: [],
      verifyRounds: [],
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues.some((issue) => issue.code === "subanswer_missing_citations")).toBe(true);
  });

  it("passes grounded answers with valid evidence-backed citations", () => {
    const report = buildQueryReviewReport({
      subAnswers: [
        {
          subQuestion: "What is the deductible?",
          answer: "$2,500",
          citations: [
            {
              index: 1,
              chunkId: "doc-1:coverage:0",
              documentId: "doc-1",
              quote: "Deductible: $2,500",
              relevance: 0.95,
            },
          ],
          confidence: 0.82,
          needsMoreContext: false,
        },
      ],
      evidence: [
        {
          source: "chunk",
          chunkId: "doc-1:coverage:0",
          documentId: "doc-1",
          text: "Coverage: Property\nLimit: $350,804\nDeductible: $2,500",
          relevance: 0.95,
        },
      ],
      verifyRounds: [{ round: 1, approved: true, issues: [] }],
    });

    expect(report.qualityGateStatus).toBe("passed");
    expect(report.issues).toHaveLength(0);
  });
});
