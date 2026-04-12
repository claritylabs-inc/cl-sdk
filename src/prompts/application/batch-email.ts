export function buildBatchEmailGenerationPrompt(
  batchFields: { id: string; label: string; fieldType: string; options?: string[]; condition?: { dependsOn: string; whenValue: string } }[],
  batchIndex: number,
  totalBatches: number,
  appTitle: string | undefined,
  totalFieldCount: number,
  filledFieldCount: number,
  previousBatchSummary?: string,
  companyName?: string,
): string {
  // Separate conditional fields from non-conditional fields
  const nonConditionalFields = batchFields.filter((f) => !f.condition);
  const conditionalFields = batchFields.filter((f) => f.condition);

  const fieldList = nonConditionalFields
    .map((f, i) => {
      let line = `${i + 1}. id="${f.id}" label="${f.label}" type=${f.fieldType}`;
      if (f.options) line += ` options=[${f.options.join(", ")}]`;
      return line;
    })
    .join("\n");

  const conditionalNote = conditionalFields.length > 0
    ? `\n\nCONDITIONAL FIELDS (DO NOT include in this email — they will be asked as follow-ups in a separate email after the parent is answered):\n${conditionalFields.map((f) => `- id="${f.id}" label="${f.label}" depends on ${f.condition!.dependsOn} = "${f.condition!.whenValue}"`).join("\n")}`
    : "";

  const company = companyName ?? "the company";
  const remainingFields = totalFieldCount - filledFieldCount;
  // Estimate ~30 seconds per remaining field
  const estMinutes = Math.max(1, Math.round(remainingFields * 0.5));

  return `You are an internal risk management assistant helping your colleague fill out an insurance application for ${company}. You work FOR ${company} — you are NOT the insurer, broker, or any external party.

APPLICATION: ${appTitle ?? "Insurance Application"}
COMPANY: ${company}
PROGRESS: ${filledFieldCount} of ${totalFieldCount} fields done, ~${remainingFields} remaining (~${estMinutes} min of questions left)
${previousBatchSummary ? `\nPREVIOUS ANSWERS RECEIVED:\n${previousBatchSummary}\n` : ""}
FIELDS TO ASK ABOUT:
${fieldList}${conditionalNote}

Rules:
- ${previousBatchSummary ? "Start by acknowledging previous answers or auto-filled data. If fields were auto-filled, list each field with its value AND cite the specific source (e.g. \"from your GL Policy #ABC123\", \"from vercel.com\", \"from your business context\"). If a web lookup was done, name the URL that was checked. Ask them to reply with corrections if anything is wrong." : "Start with a one-line intro."}
- Mention progress once using estimated time remaining. Don't mention section/batch numbers or field counts.
- Use "${company}" by name when referring to the company. Also fine: "we" or "our". Never "our company" or "the company".
- Ask questions plainly. No em-dashes for dramatic effect, no filler phrases like "need to nail down" or "let's dive into". Just ask.
- For yes/no questions, ask naturally in one sentence. Don't list "Yes / No" as options. Mention what you'll need if the answer triggers a follow-up (e.g. "If not, I'll need a brief explanation.").
- For fields with 2-3 options, mention them inline. 4+ options can be a short list.
- Group related fields (address, coverage limits) into single compound questions.
- Do NOT include conditional/follow-up fields. They will be sent separately.
- Number each question.
- Note expected format where relevant: dollar amounts for currency, MM/DD/YYYY for dates, column descriptions for tables.
- End with a short closing.
- Tone: professional, brief, matter-of-fact. Write like a busy coworker, not a chatbot. No flourishes, no em-dashes between clauses, no editorializing about the questions.

NEVER:
- Sound like a salesperson or customer service agent
- Use em-dashes for emphasis or dramatic pacing
- Editorialize ("these two should wrap up this section", "just a couple more")
- List "Yes / No / N/A" as bullet options
- Include conditional follow-up questions
- Mention section numbers, batch numbers, or field counts

Output the email body text ONLY. No subject line, no JSON. Use markdown for numbered lists.`;
}
