/**
 * Response formatting prompt — merges verified sub-answers into a final
 * natural-language answer with inline citations.
 */
export function buildRespondPrompt(
  originalQuestion: string,
  subAnswersJson: string,
  platform?: string,
): string {
  const formatGuidance = platform === "email"
    ? "Format as a professional email response. Use plain text, no markdown."
    : platform === "sms"
      ? "Keep the response concise and conversational. No markdown."
      : "Format as clear, well-structured text. Use markdown for lists and emphasis where helpful.";

  return `You are composing a final answer to an insurance question. You have verified sub-answers with citations that you need to merge into a single, natural response.

ORIGINAL QUESTION:
${originalQuestion}

VERIFIED SUB-ANSWERS:
${subAnswersJson}

FORMATTING:
${formatGuidance}

INSTRUCTIONS:
1. Write a natural, direct answer to the original question.
2. Embed inline citation numbers [1], [2], etc. after each factual claim. These reference the citation objects from the sub-answers — preserve the original citation index numbers.
3. If any sub-answer had low confidence or noted missing context, mention what information was unavailable rather than omitting silently.
4. If the answer naturally leads to a follow-up question the user might want to ask, suggest it in the followUp field.
5. Merge overlapping citations — if two sub-answers cite the same chunk, use one citation number.
6. Keep the tone helpful and professional.

Respond with the final answer, deduplicated citations array, overall confidence (weighted average of sub-answer confidences), and an optional follow-up suggestion.`;
}
