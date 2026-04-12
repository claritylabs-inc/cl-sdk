/**
 * Reasoning prompts — per-intent prompts that instruct the reasoner agent
 * to answer a sub-question using only the provided evidence.
 */

import type { QueryIntent } from "../../schemas/query";

const INTENT_INSTRUCTIONS: Record<QueryIntent, string> = {
  policy_question: `You are answering a question about a specific insurance policy or quote.

RULES:
- Answer ONLY from the evidence provided. Do not use general knowledge.
- When citing limits, deductibles, or amounts, use the exact values from the source.
- If the evidence mentions an endorsement that modifies coverage, include that context.
- If the evidence is insufficient, say what is missing rather than guessing.
- Reference specific coverage names, form numbers, and endorsement titles when available.`,

  coverage_comparison: `You are comparing coverages across insurance documents.

RULES:
- Answer ONLY from the evidence provided.
- Structure your comparison around specific coverage attributes: limits, deductibles, forms, triggers.
- Note differences clearly: "Policy A has X, while Policy B has Y."
- Flag where one document has coverage the other lacks entirely.
- If evidence for one side of the comparison is missing, state that explicitly.`,

  document_search: `You are helping locate a specific insurance document.

RULES:
- Answer ONLY from the evidence provided.
- Identify the document by carrier, policy/quote number, insured name, and effective dates.
- If multiple documents match, list them with distinguishing details.
- If no documents match, say so clearly.`,

  claims_inquiry: `You are answering a question about claims history or loss experience.

RULES:
- Answer ONLY from the evidence provided.
- Reference specific claim dates, amounts, descriptions, and statuses.
- Include experience modification factors if available.
- Be precise with dollar amounts and dates — do not approximate.
- If the evidence shows no claims, state that explicitly.`,

  general_knowledge: `You are answering a general insurance question using available document context.

RULES:
- You may use general insurance knowledge to frame your answer.
- If the question can be answered from the evidence, prefer that over general knowledge.
- When mixing general knowledge with document-specific data, make the distinction clear.
- Still cite evidence when referencing specific documents.`,
};

export function buildReasonPrompt(
  subQuestion: string,
  intent: QueryIntent,
  evidence: string,
): string {
  return `${INTENT_INSTRUCTIONS[intent]}

SUB-QUESTION:
${subQuestion}

EVIDENCE:
${evidence}

Answer the sub-question based on the evidence above. For every factual claim, include a citation referencing the source evidence item by its chunkId or documentId. Rate your confidence from 0 to 1 based on how well the evidence supports your answer. Set needsMoreContext to true if the evidence was insufficient.`;
}
