import {
  decisionJson,
  decisionOptions,
  runDecision,
  type DecisionConfig,
  type DecisionQuestion,
} from "../core/decisions";
import {
  choiceQuestion,
  noulQuestion,
  verificationQuestions,
} from "../core/decision-questions";
import {
  QueryClassifyResultSchema,
  QueryIntentSchema,
  type QueryClassifyResult,
  type SubAnswer,
  type EvidenceItem,
  type VerifyResult,
} from "../schemas/query";
import type { TokenUsage } from "../core/types";
import { deterministicQueryGroundingIssues } from "./quality";

export function classifyQueryDecision(params: {
  question: string;
  conversationContext?: string;
  attachmentContext?: string;
  hasSourceRetriever: boolean;
  config: DecisionConfig;
  fallback: () => Promise<QueryClassifyResult>;
  onUsage: (usage?: TokenUsage) => void;
}): Promise<QueryClassifyResult> {
  return runDecision({
    ...decisionOptions(params.config),
    family: "query.classify",
    state: decisionJson({
      question: params.question,
      conversationContext: params.conversationContext,
      attachmentContext: params.attachmentContext,
    }),
    questions: {
      intent: choiceQuestion(
        "What is the intent of this insurance question?",
        Object.fromEntries(
          QueryIntentSchema.options.map((i) => [i, i.replace(/_/g, " ")]),
        ),
      ),
      simple: noulQuestion(
        "Can this question be answered as one atomic question without generating document filters, decomposing comparisons, or resolving ambiguous conversation references?",
      ),
      documents: noulQuestion(
        "Does the question require looking up the user's policy, quote or other stored insurance documents?",
      ),
      history: noulQuestion(
        "Does answering this question require conversation history?",
      ),
    },
    accept: (answers) => {
      if (
        answers.simple.type !== "noul" ||
        answers.simple.noul < 0.5 ||
        answers.intent.type !== "choice" ||
        answers.documents.type !== "noul" ||
        answers.history.type !== "noul"
      )
        return;
      const parsed = QueryClassifyResultSchema.safeParse({
        intent: answers.intent.choice,
        subQuestions: [
          { question: params.question, intent: answers.intent.choice },
        ],
        requiresDocumentLookup: answers.documents.noul > 0.5,
        requiresChunkSearch: answers.documents.noul > 0.5,
        requiresConversationHistory: answers.history.noul > 0.5,
        retrievalMode: params.hasSourceRetriever ? "hybrid" : "graph_only",
      });
      return parsed.success ? parsed.data : undefined;
    },
    fallback: params.fallback,
    onUsage: params.onUsage,
  });
}

export function verifyQueryDecision(params: {
  question: string;
  subAnswers: SubAnswer[];
  evidence: EvidenceItem[];
  config: DecisionConfig;
  fallback: () => Promise<{ result: VerifyResult; usage?: TokenUsage }>;
  onUsage?: (usage?: TokenUsage) => void;
}) {
  const questions: Record<string, DecisionQuestion> = {};
  params.subAnswers.forEach((answer, i) => {
    for (const [key, q] of Object.entries(
      verificationQuestions(
        decisionJson({
          subQuestion: answer.subQuestion,
          answer: answer.answer,
          citations: answer.citations,
        }),
      ),
    ))
      questions[`${i}_${key}`] = q;
  });
  questions.complete = noulQuestion(
    "Do these sub-answers address every part of the original question without omitting an important fact or coverage qualification?",
  );
  return runDecision({
    ...decisionOptions(params.config),
    family: "query.verify",
    state: decisionJson({
      question: params.question,
      subAnswers: params.subAnswers,
      evidence: params.evidence,
    }),
    questions,
    accept: (answers) => {
      if (
        !params.subAnswers.length ||
        !params.evidence.length ||
        deterministicQueryGroundingIssues(params.subAnswers, params.evidence)
          .length
      )
        return;
      const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
      if (
        !params.subAnswers.every(
          (answer) =>
            !answer.needsMoreContext &&
            answer.citations.length > 0 &&
            answer.citations.every(
              (citation) =>
                citation.quote.trim() &&
                params.evidence.some(
                  (evidence) =>
                    evidence.documentId === citation.documentId &&
                    ((citation.sourceSpanId &&
                      evidence.sourceSpanId === citation.sourceSpanId) ||
                      (citation.sourceNodeId &&
                        evidence.sourceNodeId === citation.sourceNodeId) ||
                      (citation.chunkId &&
                        evidence.chunkId === citation.chunkId)) &&
                    normalized(evidence.text).includes(
                      normalized(citation.quote),
                    ),
                ),
            ),
        )
      )
        return;

      if (
        !Object.entries(answers).every(
          ([key, a]) =>
            a.type === "noul" &&
            (key.endsWith("_missing") || key.endsWith("_contradiction")
              ? a.noul < 0.5
              : a.noul > 0.5),
        )
      )
        return;
      return { result: { approved: true, issues: [] } };
    },
    fallback: params.fallback,
    onUsage: params.onUsage,
  });
}

/** Reorder only: never discard contradictory passages or change citation identities. */
export function rankEvidenceDecision(
  question: string,
  evidence: EvidenceItem[],
  config: DecisionConfig,
  onUsage?: (usage?: TokenUsage) => void,
): Promise<EvidenceItem[]> {
  return runDecision({
    ...decisionOptions(config),
    family: "query.relevance",
    state: decisionJson({ question, evidence }),
    questions: Object.fromEntries(
      evidence.map((_, i) => [
        `e${i}`,
        noulQuestion({
          question:
            "Is this passage relevant to answering the query, including contradictory or modifying evidence?",
          evidenceIndex: i,
        }),
      ]),
    ),
    accept: (answers) =>
      [...evidence]
        .map((e, i) => ({ e, a: answers[`e${i}`] }))
        .sort(
          (a, b) =>
            (b.a.type === "noul" ? b.a.noul : 0) -
            (a.a.type === "noul" ? a.a.noul : 0),
        )
        .map(({ e }) => e),
    fallback: async () => evidence,
    onUsage,
  });
}
