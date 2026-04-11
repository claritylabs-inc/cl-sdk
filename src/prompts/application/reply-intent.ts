export function buildReplyIntentClassificationPrompt(
  questions: { id: string; label: string }[],
  emailBody: string,
): string {
  const questionList = questions
    .map((q, i) => `${i + 1}. ${q.id}: "${q.label}"`)
    .join("\n");

  return `Classify the intent of this email reply to insurance application questions.

QUESTIONS THAT WERE ASKED:
${questionList}

USER'S EMAIL REPLY:
${emailBody}

Classify the primary intent:
- "answers_only": User is providing answers to the questions
- "question": User is asking a question about one or more fields (e.g. "What does aggregate limit mean?")
- "lookup_request": User is requesting data be pulled from existing records OR from a third-party website (e.g. "Use our GL policy for coverage info", "Check Stripe's site for PCI compliance info", "Pull from our last application")
- "mixed": User is providing some answers AND asking questions or requesting lookups

IMPORTANT: When a user provides answers AND asks you to look something up (e.g. "Yes we use Stripe, check their site for PCI info"), classify as "mixed" with hasAnswers=true and a lookupRequest — NOT as "question". A "question" is when the user asks what a field means, not when they direct you to a data source.

Respond with JSON only:
{
  "primaryIntent": "answers_only" | "question" | "lookup_request" | "mixed",
  "hasAnswers": boolean,
  "questionText": "the user's question if any, or null",
  "questionFieldIds": ["field_ids the question is about, if identifiable"],
  "lookupRequests": [
    {
      "type": "policy" | "quote" | "profile" | "business_context" | "web",
      "description": "what they want looked up",
      "url": "URL or domain mentioned (e.g. 'stripe.com'), or null if not a web lookup",
      "targetFieldIds": ["field_ids to fill from the lookup"]
    }
  ]
}`;
}
