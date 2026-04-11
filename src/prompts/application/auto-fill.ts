export function buildAutoFillPrompt(
  fields: { id: string; label: string; fieldType: string; section: string }[],
  orgContext: { key: string; value: string; category: string }[],
): string {
  const fieldList = fields
    .map((f) => `- ${f.id}: "${f.label}" (${f.fieldType}, section: ${f.section})`)
    .join("\n");
  const contextList = orgContext
    .map((c) => `- ${c.key}: "${c.value}" (category: ${c.category})`)
    .join("\n");

  return `You are matching insurance application fields to existing business context data.

APPLICATION FIELDS:
${fieldList}

AVAILABLE BUSINESS CONTEXT:
${contextList}

For each field that can be filled from the context, provide a match. Only match when you are confident the context value correctly answers the field. For date fields, ensure format compatibility.

Respond with JSON only:
{
  "matches": [
    {
      "fieldId": "company_name",
      "value": "Acme Corp",
      "confidence": "confirmed",
      "contextKey": "company_name"
    }
  ]
}

Only include fields you can confidently fill. Do not guess or fabricate values.`;
}
