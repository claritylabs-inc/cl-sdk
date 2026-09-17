import { describe, expect, it, vi } from "vitest";
import {
  classifyQueryDecision,
  rankEvidenceDecision,
  verifyQueryDecision,
} from "../../query/decisions";
import { decisionTestConfig } from "../fixtures/decision-test-helpers";
import type { QueryClassifyResult, EvidenceItem } from "../../schemas/query";

const classification: QueryClassifyResult = {
  intent: "general_knowledge",
  subQuestions: [
    { question: "What is a deductible?", intent: "general_knowledge" },
  ],
  requiresChunkSearch: false,
  requiresDocumentLookup: false,
  requiresConversationHistory: false,
};
describe("query decisions", () => {
  it("classifies an atomic general question while preserving reasoning for decomposition", async () => {
    const fallback = vi.fn(async () => classification);
    const base = {
      question: "What is a deductible?",
      hasSourceRetriever: true,
      onUsage: vi.fn(),
      fallback,
    };
    const config = decisionTestConfig("query.classify", (id) =>
      id === "intent" ? "general_knowledge" : id === "simple" ? 1 : 0,
    );
    expect(
      (await classifyQueryDecision({ ...base, config })).requiresDocumentLookup,
    ).toBe(false);
    expect(fallback).not.toHaveBeenCalled();
    await classifyQueryDecision({
      ...base,
      config: decisionTestConfig("query.classify", (id) =>
        id === "intent" ? "coverage_comparison" : 0,
      ),
    });
    expect(fallback).toHaveBeenCalledOnce();
  });
  it("reorders but retains contradicting passages and citation identities", async () => {
    const evidence: EvidenceItem[] = [
      {
        source: "source_span",
        sourceSpanId: "a",
        documentId: "d",
        text: "Base policy covers flood",
        relevance: 1,
      },
      {
        source: "source_span",
        sourceSpanId: "b",
        documentId: "d",
        text: "Endorsement excludes flood",
        relevance: 0.5,
      },
    ];
    const result = await rankEvidenceDecision(
      "Flood covered?",
      evidence,
      decisionTestConfig("query.relevance", (id) => (id === "e0" ? 0 : 1)),
    );
    expect(result).toEqual([evidence[1], evidence[0]]);
    expect(result[0]).toBe(evidence[1]);
  });
  it("cannot approve unsupported citation IDs even with confident semantic support", async () => {
    const fallback = vi.fn(async () => ({
      result: { approved: false, issues: ["bad citation"] },
    }));
    const result = await verifyQueryDecision({
      question: "Covered?",
      subAnswers: [
        {
          subQuestion: "Covered?",
          answer: "Yes",
          confidence: 1,
          needsMoreContext: false,
          citations: [
            {
              index: 1,
              documentId: "wrong",
              sourceSpanId: "injected",
              quote: "Yes",
              relevance: 1,
            },
          ],
        },
      ],
      evidence: [
        {
          source: "source_span",
          sourceSpanId: "valid",
          documentId: "d",
          text: "No",
          relevance: 1,
        },
      ],
      config: decisionTestConfig("query.verify", (id) =>
        id.endsWith("supported") || id === "complete" ? 1 : 0,
      ),
      fallback,
    });
    expect(result.result.approved).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
  });
});
