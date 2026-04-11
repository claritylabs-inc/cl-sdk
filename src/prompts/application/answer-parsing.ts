export function buildAnswerParsingPrompt(
  questions: { id: string; label?: string; text?: string; fieldType: string }[],
  emailBody: string,
): string {
  const questionList = questions
    .map(
      (q, i) =>
        `${i + 1}. ${q.id}: "${q.label ?? q.text}" (type: ${q.fieldType})`,
    )
    .join("\n");

  return `You are parsing a user's email reply to extract answers for specific insurance application questions.

QUESTIONS ASKED:
${questionList}

USER'S EMAIL REPLY:
${emailBody}

Extract answers for each question. Handle:
- Direct numbered answers (1. answer, 2. answer)
- Inline answers referencing the question
- Table data provided as lists or comma-separated values
- Yes/no answers with optional explanations
- Partial responses (some questions answered, others skipped)

Respond with JSON only:
{
  "answers": [
    {
      "fieldId": "company_name",
      "value": "Acme Corp"
    },
    {
      "fieldId": "prior_claims_decl",
      "value": "yes",
      "explanation": "One claim in 2024 for water damage, $15,000 paid"
    }
  ],
  "unanswered": ["field_id_that_was_not_answered"]
}

Only include answers you are confident about. If a response is ambiguous, include the field in "unanswered".`;
}
