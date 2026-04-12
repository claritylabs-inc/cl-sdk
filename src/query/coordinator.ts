import type { GenerateObject, TokenUsage } from "../core/types";
import { pLimit } from "../core/concurrency";
import { safeGenerateObject } from "../core/safe-generate";
import { createPipelineContext, type PipelineCheckpoint } from "../core/pipeline";
import { buildQueryClassifyPrompt } from "../prompts/query/classify";
import { buildRespondPrompt } from "../prompts/query/respond";
import {
  QueryClassifyResultSchema,
  QueryResultSchema,
  type QueryClassifyResult,
  type SubQuestion,
  type EvidenceItem,
  type SubAnswer,
  type QueryResult,
} from "../schemas/query";
import { retrieve, type RetrieverConfig } from "./retriever";
import { reason, type ReasonerConfig } from "./reasoner";
import { verify, type VerifierConfig } from "./verifier";
import type { QueryConfig, QueryInput, QueryOutput } from "./types";
import { buildQueryReviewReport, type QueryReviewReport, type QueryVerifyRoundRecord } from "./quality";
import { shouldFailQualityGate } from "../core/quality";

/** Internal state checkpointed between query phases. */
export interface QueryState {
  classification?: QueryClassifyResult;
  evidence?: EvidenceItem[];
  subAnswers?: SubAnswer[];
  reviewReport?: QueryReviewReport;
}

export function createQueryAgent(config: QueryConfig) {
  const {
    generateText,
    generateObject,
    documentStore,
    memoryStore,
    concurrency = 3,
    maxVerifyRounds = 1,
    retrievalLimit = 10,
    onTokenUsage,
    onProgress,
    log,
    providerOptions,
    qualityGate = "warn",
  } = config;

  const limit = pLimit(concurrency);
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  function trackUsage(usage?: TokenUsage) {
    if (usage) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      onTokenUsage?.(usage);
    }
  }

  async function query(input: QueryInput): Promise<QueryOutput> {
    totalUsage = { inputTokens: 0, outputTokens: 0 };
    const { question, conversationId, context } = input;

    const pipelineCtx = createPipelineContext<QueryState>({
      id: `query-${Date.now()}`,
    });

    // -- Phase 1: Classify --
    onProgress?.("Classifying query...");
    const classification = await classify(question, conversationId);
    await pipelineCtx.save("classify", { classification });

    // -- Phase 2: Retrieve (parallel) --
    onProgress?.(`Retrieving evidence for ${classification.subQuestions.length} sub-question(s)...`);
    const retrieverConfig: RetrieverConfig = {
      documentStore,
      memoryStore,
      retrievalLimit,
      log,
    };

    const retrievalResults = await Promise.all(
      classification.subQuestions.map((sq) =>
        limit(() => retrieve(sq, conversationId, retrieverConfig)),
      ),
    );

    const allEvidence: EvidenceItem[] = retrievalResults.flatMap((r) => r.evidence);
    await pipelineCtx.save("retrieve", { classification, evidence: allEvidence });

    // -- Phase 3: Reason (parallel, with isolation) --
    onProgress?.("Reasoning over evidence...");
    const reasonerConfig: ReasonerConfig = { generateObject, providerOptions };

    // Use Promise.allSettled so one failing sub-question doesn't kill the rest
    const reasonResults = await Promise.allSettled(
      classification.subQuestions.map((sq, i) =>
        limit(async () => {
          const { subAnswer, usage } = await reason(
            sq.question,
            sq.intent,
            retrievalResults[i].evidence,
            reasonerConfig,
          );
          trackUsage(usage);
          return subAnswer;
        }),
      ),
    );

    let subAnswers: SubAnswer[] = [];
    for (let i = 0; i < reasonResults.length; i++) {
      const result = reasonResults[i];
      if (result.status === "fulfilled") {
        subAnswers.push(result.value);
      } else {
        await log?.(`Reasoner failed for sub-question "${classification.subQuestions[i].question}": ${result.reason}`);
        // Insert a degraded sub-answer so downstream phases have something to work with
        subAnswers.push({
          subQuestion: classification.subQuestions[i].question,
          answer: "Unable to answer this part of the question due to a processing error.",
          citations: [],
          confidence: 0,
          needsMoreContext: true,
        });
      }
    }

    await pipelineCtx.save("reason", { classification, evidence: allEvidence, subAnswers });

    // -- Phase 4: Verify (with retry loop) --
    onProgress?.("Verifying answer grounding...");
    const verifierConfig: VerifierConfig = { generateObject, providerOptions };

    const verifyRounds: QueryVerifyRoundRecord[] = [];
    for (let round = 0; round < maxVerifyRounds; round++) {
      const { result: verifyResult, usage } = await safeVerify(
        question,
        subAnswers,
        allEvidence,
        verifierConfig,
      );
      trackUsage(usage);
      verifyRounds.push({
        round: round + 1,
        approved: verifyResult.approved,
        issues: verifyResult.issues,
        retrySubQuestions: verifyResult.retrySubQuestions,
      });

      if (verifyResult.approved) {
        onProgress?.("Verification passed.");
        break;
      }

      onProgress?.(`Verification found ${verifyResult.issues.length} issue(s), round ${round + 1}/${maxVerifyRounds}`);
      await log?.(`Verify issues: ${verifyResult.issues.join("; ")}`);

      // Re-retrieve and re-reason for flagged sub-questions
      if (verifyResult.retrySubQuestions?.length) {
        const retryQuestions = classification.subQuestions.filter((sq) =>
          verifyResult.retrySubQuestions!.includes(sq.question),
        );

        if (retryQuestions.length > 0) {
          const retryRetrievals = await Promise.all(
            retryQuestions.map((sq) =>
              limit(() =>
                retrieve(sq, conversationId, {
                  ...retrieverConfig,
                  retrievalLimit: retrievalLimit * 2,
                }),
              ),
            ),
          );

          for (const r of retryRetrievals) {
            allEvidence.push(...r.evidence);
          }

          const retrySettled = await Promise.allSettled(
            retryQuestions.map((sq, i) =>
              limit(async () => {
                const { subAnswer, usage: u } = await reason(
                  sq.question,
                  sq.intent,
                  retryRetrievals[i].evidence,
                  reasonerConfig,
                );
                trackUsage(u);
                return subAnswer;
              }),
            ),
          );

          const retrySubAnswers: SubAnswer[] = retrySettled
            .filter((r): r is PromiseFulfilledResult<SubAnswer> => r.status === "fulfilled")
            .map((r) => r.value);

          const retryQSet = new Set(retryQuestions.map((sq) => sq.question));
          subAnswers = subAnswers.map((sa) => {
            if (retryQSet.has(sa.subQuestion)) {
              const replacement = retrySubAnswers.find((r) => r.subQuestion === sa.subQuestion);
              return replacement ?? sa;
            }
            return sa;
          });
        }
      }
    }

    // -- Phase 5: Respond --
    onProgress?.("Composing final answer...");
    const queryResult = await respond(
      question,
      subAnswers,
      classification,
      context?.platform,
    );

    const reviewReport = buildQueryReviewReport({
      subAnswers,
      evidence: allEvidence,
      finalResult: queryResult,
      verifyRounds,
    });

    await pipelineCtx.save("review", {
      classification,
      evidence: allEvidence,
      subAnswers,
      reviewReport,
    });

    if (reviewReport.issues.length > 0) {
      await log?.(`Query deterministic review issues: ${reviewReport.issues.map((issue) => issue.message).join("; ")}`);
    }

    if (shouldFailQualityGate(qualityGate, reviewReport.qualityGateStatus)) {
      throw new Error("Query quality gate failed. See reviewReport for blocking issues.");
    }

    // Store the conversation turn
    if (conversationId) {
      try {
        await memoryStore.addTurn({
          id: `turn-${Date.now()}-q`,
          conversationId,
          role: "user",
          content: question,
          timestamp: Date.now(),
        });
        await memoryStore.addTurn({
          id: `turn-${Date.now()}-a`,
          conversationId,
          role: "assistant",
          content: queryResult.answer,
          timestamp: Date.now(),
        });
      } catch (e) {
        await log?.(`Failed to store conversation turn: ${e}`);
      }
    }

    return { ...queryResult, tokenUsage: totalUsage, reviewReport };
  }

  async function classify(
    question: string,
    conversationId?: string,
  ): Promise<QueryClassifyResult> {
    let conversationContext: string | undefined;
    if (conversationId) {
      try {
        const history = await memoryStore.getHistory(conversationId, { limit: 5 });
        if (history.length > 0) {
          conversationContext = history
            .map((t) => `[${t.role}]: ${t.content}`)
            .join("\n");
        }
      } catch {
        // Non-fatal -- proceed without history
      }
    }

    const prompt = buildQueryClassifyPrompt(question, conversationContext);

    const { object, usage } = await safeGenerateObject(
      generateObject as GenerateObject<QueryClassifyResult>,
      {
        prompt,
        schema: QueryClassifyResultSchema,
        maxTokens: 2048,
        providerOptions,
      },
      {
        fallback: {
          intent: "general_knowledge",
          subQuestions: [
            {
              question,
              intent: "general_knowledge",
            },
          ],
          requiresDocumentLookup: true,
          requiresChunkSearch: true,
          requiresConversationHistory: !!conversationId,
        },
        log,
        onError: (err, attempt) =>
          log?.(`Query classify attempt ${attempt + 1} failed: ${err}`),
      },
    );
    trackUsage(usage);

    return object as QueryClassifyResult;
  }

  /** Verify with fallback — if verification itself fails, approve and move on. */
  async function safeVerify(
    originalQuestion: string,
    subAnswers: SubAnswer[],
    allEvidence: EvidenceItem[],
    verifierConfig: VerifierConfig,
  ): Promise<{ result: { approved: boolean; issues: string[]; retrySubQuestions?: string[] }; usage?: TokenUsage }> {
    try {
      return await verify(originalQuestion, subAnswers, allEvidence, verifierConfig);
    } catch (error) {
      await log?.(`Verification failed, approving by default: ${error instanceof Error ? error.message : String(error)}`);
      return { result: { approved: true, issues: [] } };
    }
  }

  async function respond(
    originalQuestion: string,
    subAnswers: SubAnswer[],
    classification: QueryClassifyResult,
    platform?: string,
  ): Promise<QueryResult> {
    const subAnswersJson = JSON.stringify(
      subAnswers.map((sa) => ({
        subQuestion: sa.subQuestion,
        answer: sa.answer,
        citations: sa.citations,
        confidence: sa.confidence,
        needsMoreContext: sa.needsMoreContext,
      })),
      null,
      2,
    );

    const prompt = buildRespondPrompt(originalQuestion, subAnswersJson, platform);

    const { object, usage } = await safeGenerateObject(
      generateObject as GenerateObject<QueryResult>,
      {
        prompt,
        schema: QueryResultSchema,
        maxTokens: 4096,
        providerOptions,
      },
      {
        fallback: {
          answer: subAnswers.map((sa) => `**${sa.subQuestion}**\n${sa.answer}`).join("\n\n"),
          citations: subAnswers.flatMap((sa) => sa.citations),
          intent: classification.intent,
          confidence: Math.min(...subAnswers.map((sa) => sa.confidence), 1),
        },
        log,
        onError: (err, attempt) =>
          log?.(`Respond attempt ${attempt + 1} failed: ${err}`),
      },
    );
    trackUsage(usage);

    const result = object as QueryResult;
    result.intent = classification.intent;

    return result;
  }

  return { query };
}
