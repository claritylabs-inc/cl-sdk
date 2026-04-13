/**
 * Query classification prompt — determines intent and decomposes complex
 * questions into atomic sub-questions for parallel retrieval + reasoning.
 */
export function buildQueryClassifyPrompt(
  question: string,
  conversationContext?: string,
  attachmentContext?: string,
): string {
  return `You are a query classifier for an insurance document intelligence system.

Analyze the user's question and produce a structured classification.

USER QUESTION:
${question}
${conversationContext ? `\nCONVERSATION CONTEXT:\n${conversationContext}` : ""}
${attachmentContext ? `\nATTACHMENT CONTEXT:\n${attachmentContext}` : ""}

INSTRUCTIONS:

1. Determine the primary intent:
   - "policy_question": questions about specific coverage, limits, deductibles, endorsements, conditions
   - "coverage_comparison": comparing coverages across multiple documents or policies
   - "document_search": looking for a specific document by carrier, policy number, insured name
   - "claims_inquiry": questions about claims history, loss runs, experience modification
   - "general_knowledge": insurance concepts not tied to a specific document

2. Decompose into atomic sub-questions:
   - Each sub-question should be answerable from a single retrieval pass
   - Simple questions produce exactly one sub-question (the question itself)
   - Complex questions (comparisons, multi-policy, multi-field) decompose into 2-5 sub-questions
   - Each sub-question should specify which chunk types are most relevant

3. Determine which storage backends are needed:
   - requiresDocumentLookup: true if a specific document needs to be fetched by ID/number/carrier
   - requiresChunkSearch: true if semantic search over document chunks is needed
   - requiresConversationHistory: true if the question references prior conversation
   - If the user's attachment already contains critical facts, still request chunk/document lookup when policy or quote details should be cross-checked against stored records

CHUNK TYPES (for chunkTypes filter):
carrier_info, named_insured, coverage, endorsement, exclusion, condition, section, declaration, loss_history, premium, supplementary

Respond with the structured classification.`;
}
