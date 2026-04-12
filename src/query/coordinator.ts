import type { GenerateObject, TokenUsage } from "../core/types";
import { pLimit } from "../core/concurrency";
import { withRetry } from "../core/retry";
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

    // ── Phase 1: Classify ──
    onProgress?.("Classifying query...");
    const classification = await classify(question, conversationId);

    // ── Phase 2: Retrieve (parallel) ──
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

    // Collect all evidence for verification
    const allEvidence: EvidenceItem[] = retrievalResults.flatMap((r) => r.evidence);

    // ── Phase 3: Reason (parallel) ──
    onProgress?.("Reasoning over evidence...");
    const reasonerConfig: ReasonerConfig = { generateObject, providerOptions };

    let subAnswers: SubAnswer[] = await Promise.all(
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

    // ── Phase 4: Verify (with retry loop) ──
    onProgress?.("Verifying answer grounding...");
    const verifierConfig: VerifierConfig = { generateObject, providerOptions };

    for (let round = 0; round < maxVerifyRounds; round++) {
      const { result: verifyResult, usage } = await verify(
        question,
        subAnswers,
        allEvidence,
        verifierConfig,
      );
      trackUsage(usage);

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
                  retrievalLimit: retrievalLimit * 2, // Broader retrieval on retry
                }),
              ),
            ),
          );

          // Add new evidence to the pool
          for (const r of retryRetrievals) {
            allEvidence.push(...r.evidence);
          }

          const retrySubAnswers = await Promise.all(
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

          // Replace old sub-answers with retried ones
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

    // ── Phase 5: Respond ──
    onProgress?.("Composing final answer...");
    const queryResult = await respond(
      question,
      subAnswers,
      classification,
      context?.platform,
    );

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

    return { ...queryResult, tokenUsage: totalUsage };
  }

  async function classify(
    question: string,
    conversationId?: string,
  ): Promise<QueryClassifyResult> {
    // Fetch recent conversation context if available
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
        // Non-fatal — proceed without history
      }
    }

    const prompt = buildQueryClassifyPrompt(question, conversationContext);

    const { object, usage } = await withRetry(() =>
      generateObject({
        prompt,
        schema: QueryClassifyResultSchema,
        maxTokens: 2048,
        providerOptions,
      }),
    );
    trackUsage(usage);

    return object as QueryClassifyResult;
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

    const { object, usage } = await withRetry(() =>
      generateObject({
        prompt,
        schema: QueryResultSchema,
        maxTokens: 4096,
        providerOptions,
      }),
    );
    trackUsage(usage);

    const result = object as QueryResult;
    // Override intent from classification (more reliable than LLM re-classification)
    result.intent = classification.intent;

    return result;
  }

  return { query };
}
