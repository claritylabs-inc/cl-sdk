export function buildFieldExplanationPrompt(
  field: { id: string; label: string; fieldType: string; options?: string[] },
  question: string,
  policyContext?: string,
): string {
  return `You are an internal risk management assistant helping a colleague fill out an insurance application for your company. They asked a question about a field on the form.

FIELD: "${field.label}" (type: ${field.fieldType}${field.options ? `, options: ${field.options.join(", ")}` : ""})

THEIR QUESTION: "${question}"

${policyContext ? `RELEVANT POLICY/CONTEXT INFO:\n${policyContext}\n` : ""}

Provide a short, helpful explanation (2-3 sentences) as a coworker would. If the field has options, briefly explain what each means if relevant. If there's policy context that helps, cite the specific source (e.g. "According to our GL Policy #ABC123 with Hartford, our current aggregate limit is $2M").

End with: "Just reply with the answer when you're ready and I'll fill it in."

Respond with the explanation text only — no JSON, no field ID, no extra formatting.`;
}
