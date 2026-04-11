export function buildConfirmationSummaryPrompt(
  fields: { id: string; label?: string; text?: string; section: string; fieldType: string; value?: string }[],
  applicationTitle: string,
): string {
  const fieldList = fields
    .map((f) => {
      const label = f.label ?? f.text ?? f.id;
      const value = f.value ?? "(not provided)";
      return `[${f.section}] ${label}: ${value}`;
    })
    .join("\n");

  return `Format the following insurance application answers into a clean, readable summary grouped by section. This will be sent as an email for the user to review and confirm.

APPLICATION: ${applicationTitle}

FIELD VALUES:
${fieldList}

Format as a readable summary:
- Group by section with section headers
- Show each field as "Label: Value"
- For declarations, show the question and the yes/no answer plus any explanation
- Skip fields with no value unless they are required
- End with a note asking the user to reply "Looks good" to confirm, or describe any changes needed

Respond with the formatted summary text only (no JSON wrapper). Use markdown formatting (bold headers, bullet points).`;
}
