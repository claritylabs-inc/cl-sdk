import { describe, expect, it } from "vitest";
import {
  CaseActionSchema,
  evaluateCaseProposals,
  generateNextMessage,
  processReply,
  validateEvidence,
  type CaseState,
  type CaseWorkflowPlan,
} from "../../case";

describe("case proposal evaluation", () => {
  it("rejects unsupported quoted-value proposals", () => {
    const selected = evaluateCaseProposals([
      {
        id: "unsupported",
        sourceSpanIds: [],
        confidence: 0.99,
        missingInfo: [],
        validationIssues: [{
          code: "missing_citation",
          severity: "blocking",
          message: "Quoted value is missing citation.",
        }],
        estimatedRisk: 0.1,
        estimatedCost: 0.1,
      },
      {
        id: "supported",
        sourceSpanIds: ["doc-1:span:1:0:abcd"],
        confidence: 0.8,
        missingInfo: [],
        validationIssues: [],
        estimatedRisk: 0.2,
        estimatedCost: 0.2,
      },
    ]);

    expect(selected?.id).toBe("supported");
  });

  it("uses deterministic proposal ID tie-breaks", () => {
    const selected = evaluateCaseProposals([
      {
        id: "proposal-b",
        sourceSpanIds: ["span"],
        confidence: 0.8,
        missingInfo: [],
        validationIssues: [],
        estimatedRisk: 0.2,
        estimatedCost: 0.2,
      },
      {
        id: "proposal-a",
        sourceSpanIds: ["span"],
        confidence: 0.8,
        missingInfo: [],
        validationIssues: [],
        estimatedRisk: 0.2,
        estimatedCost: 0.2,
      },
    ]);

    expect(selected?.id).toBe("proposal-a");
  });

  it("exposes shared case workflow primitives for application and PCE specializations", () => {
    const plan: CaseWorkflowPlan = {
      id: "plan-1",
      executionMode: "deterministic_tree",
      actions: ["retrieve_policy_evidence", "run_validation", "generate_packet"],
    };
    const state: CaseState = {
      id: "case-1",
      executionMode: "deterministic_tree",
      items: [{ id: "item-1", sourceSpanIds: ["source-1"] }],
      evidenceSources: [{ id: "source-1", text: "Current limit is $1,000,000." }],
      validationIssues: [],
      missingInfoQuestions: [{
        id: "question-1",
        fieldPath: "coverage.limit",
        question: "What limit should be requested?",
        reason: "Requested value was missing.",
      }],
      createdAt: 1000,
      updatedAt: 1000,
    };

    expect(plan.actions.map((action) => CaseActionSchema.parse(action))).toEqual(plan.actions);
    expect(generateNextMessage(state.missingInfoQuestions)).toBe("What limit should be requested?");
    expect(processReply(state.missingInfoQuestions, [{ questionId: "question-1", answer: "$2,000,000" }]).answeredCount).toBe(1);
    expect(validateEvidence({
      fieldPath: "coverage.limit",
      quote: "$1,000,000",
      citation: { sourceId: "source-1", quote: "$1,000,000" },
      sources: state.evidenceSources,
    })).toEqual([]);
  });
});
