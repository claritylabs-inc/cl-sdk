export function buildQuestionBatchPrompt(
  unfilledFields: { id: string; label?: string; text?: string; fieldType: string; section: string; required: boolean; condition?: { dependsOn: string; whenValue: string } }[],
): string {
  const fieldList = unfilledFields
    .map(
      (f) => {
        let line = `- ${f.id}: "${f.label ?? f.text}" (${f.fieldType}, section: ${f.section}, required: ${f.required})`;
        if (f.condition) line += ` [depends on: ${f.condition.dependsOn} when "${f.condition.whenValue}"]`;
        return line;
      },
    )
    .join("\n");

  return `You are organizing insurance application questions into topic-based email batches. Each batch = one email, grouped by topic so the recipient can answer related questions together.

UNFILLED FIELDS:
${fieldList}

Rules:
- Group by TOPIC, not by fixed size. All questions about the same topic belong in the same batch.
- Typical topics: Company/Applicant Info, Business Operations, Financial/Revenue, Coverage/Limits, Loss History, Declarations, Premises/Location, etc.
- A batch can have as many questions as the topic requires — don't split a natural topic group across multiple emails.
- If a topic has 20+ fields, you may split into sub-topics (e.g. "Premises - Location" vs "Premises - Details").
- Put required fields before optional ones within each batch.
- Keep conditional fields in the same batch as the field they depend on, with the parent field listed BEFORE dependents.
- Keep related address-like fields (street, city, state, zip, address) in the same batch so the email generator can merge them into a single compound question.
- Order batches by importance: company info first, then operations, financial, coverage, declarations last.
- Aim for roughly 3-8 batches total. Fewer large topical batches are better than many tiny ones.

Respond with JSON only:
{
  "batches": [
    ["field_id_1", "field_id_2", "field_id_3", ...],
    ["field_id_4", "field_id_5", ...]
  ]
}`;
}
