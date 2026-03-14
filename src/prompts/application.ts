// Prompts for insurance application processing

export const APPLICATION_CLASSIFY_PROMPT = `You are classifying a PDF document. Determine if this is an insurance APPLICATION FORM (a form to be filled out to apply for insurance) versus a policy document, quote, certificate, or other document.

Insurance applications typically:
- Have blank fields, checkboxes, or spaces to fill in
- Ask for company information, coverage limits, loss history
- Include ACORD form numbers or "Application for" in the title
- Request signatures and dates

Respond with JSON only:
{
  "isApplication": boolean,
  "confidence": number (0-1),
  "applicationType": string | null  // e.g. "General Liability", "Professional Liability", "Commercial Property", "Workers Compensation", "ACORD 125", etc.
}`;

export function buildFieldExtractionPrompt(): string {
  return `Extract all fillable fields from this insurance application PDF as a JSON array. Be concise — use short IDs and minimal keys.

Field types: "text", "numeric", "currency", "date", "yes_no", "table", "declaration"

Required keys per field:
- "id": short snake_case ID
- "label": field label — a clear, natural question that a human would understand
- "section": section heading
- "fieldType": one of the types above
- "required": boolean

Optional keys (only include when applicable):
- "options": array of strings — for fields with checkboxes/radio buttons/multiple choices (e.g. business type, state selections). Use "text" fieldType with options.
- "columns": array of {"name","type"} — tables only
- "requiresExplanationIfYes": boolean — declarations only
- "condition": {"dependsOn":"field_id","whenValue":"value"} — conditional fields only

IMPORTANT — Grouped fields: When you see a group of checkboxes or radio buttons for a single question (e.g. "Type of Business: Corporation / Partnership / LLC / Individual / Joint Venture / Other"), extract as ONE field with the group label and an "options" array — NOT as separate fields for each option. The label should describe what's being asked (e.g. "Type of Business Entity"), and options lists the choices.

Example:
[
  {"id":"company_name","label":"Applicant Name","section":"General Info","fieldType":"text","required":true},
  {"id":"business_type","label":"Type of Business Entity","section":"General Info","fieldType":"text","required":true,"options":["Corporation","Partnership","LLC","Individual","Joint Venture","Other"]},
  {"id":"loss_history","label":"Loss History","section":"Losses","fieldType":"table","required":true,"columns":[{"name":"Year","type":"numeric"},{"name":"Amount","type":"currency"}]},
  {"id":"prior_claims","text":"Any claims in past 5 years?","section":"Declarations","fieldType":"declaration","required":true,"requiresExplanationIfYes":true}
]

Extract ALL fields. Respond with ONLY the JSON array, no other text.`;
}

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

export function buildFlatPdfMappingPrompt(
  extractedFields: { id: string; label: string; value: string; fieldType: string }[],
): string {
  const fieldList = extractedFields
    .map((f) => `- ${f.id}: "${f.label}" = "${f.value}" (${f.fieldType})`)
    .join("\n");

  return `You are mapping filled insurance application values to their exact positions on a flat (non-fillable) PDF form. I will show you the PDF. For each field value, identify where on the PDF it should be written.

FIELD VALUES TO PLACE:
${fieldList}

For each field, provide:
- page: 0-indexed page number where this field appears
- x: horizontal position as percentage from the LEFT edge (0-100). Place the text where the blank/underline/box starts, NOT on top of the label.
- y: vertical position as percentage from the TOP edge (0-100). Place the text vertically centered within the field's answer area.
- fontSize: appropriate font size (typically 8-10 for standard forms, smaller for tight spaces)
- isCheckmark: true for yes/no or checkbox fields where you should place an "X" mark

CRITICAL POSITIONING RULES:
- x/y indicate where the VALUE text should START (top-left corner of the text)
- Place text INSIDE the blank field area (the line, box, or empty space), not on the label
- For fields with underlines: place text slightly above the line
- For fields with boxes: place text inside the box
- For checkbox/yes-no fields: place the X inside the checkbox box. If there are "Yes" and "No" checkboxes, place it in the correct one based on the value
- Typical form layout: label on the left, fill area to the right or below
- Be precise — a few percentage points off will misplace text visibly

Respond with JSON only:
{
  "placements": [
    {
      "fieldId": "company_name",
      "page": 0,
      "x": 25.5,
      "y": 12.3,
      "text": "Acme Corp",
      "fontSize": 10,
      "isCheckmark": false
    }
  ]
}

Only include fields you can confidently locate on the PDF. Skip fields where the location is ambiguous.`;
}

export function buildAcroFormMappingPrompt(
  extractedFields: { id: string; label: string; value?: string }[],
  acroFormFields: { name: string; type: string; options?: string[] }[],
): string {
  const extracted = extractedFields
    .filter((f) => (f as any).value)
    .map((f) => `- ${f.id}: "${f.label}" = "${(f as any).value}"`)
    .join("\n");
  const acroFields = acroFormFields
    .map((f) => {
      let line = `- "${f.name}" (${f.type})`;
      if (f.options?.length) line += ` options: [${f.options.join(", ")}]`;
      return line;
    })
    .join("\n");

  return `You are mapping extracted insurance application answers to AcroForm PDF field names.

EXTRACTED FIELD VALUES (semantic IDs with values):
${extracted}

ACROFORM FIELDS IN THE PDF:
${acroFields}

For each extracted field that has a value, find the best matching AcroForm field name. Match by semantic meaning — field names in PDFs are often abbreviated or coded (e.g. "FirstNamed" for company name, "Addr1" for address).

Rules:
- Only include mappings where you are confident of the match
- For checkbox fields, the value should be "yes"/"no" or "true"/"false"
- For radio/dropdown fields, the value must be one of the available options
- Skip fields with no clear match

Respond with JSON only:
{
  "mappings": [
    { "fieldId": "company_name", "acroFormName": "FirstNamed", "value": "Acme Corp" }
  ]
}`;
}

export function buildLookupFillPrompt(
  requests: { type: string; description: string; targetFieldIds: string[] }[],
  targetFields: { id: string; label: string; fieldType: string }[],
  availableData: string,
): string {
  const requestList = requests
    .map((r) => `- ${r.type}: ${r.description} (target fields: ${r.targetFieldIds.join(", ")})`)
    .join("\n");
  const fieldList = targetFields
    .map((f) => `- ${f.id}: "${f.label}" (${f.fieldType})`)
    .join("\n");

  return `You are an internal risk management assistant filling out an insurance application for your company. A colleague asked you to look up data from existing company records to fill certain fields.

LOOKUP REQUESTS:
${requestList}

TARGET FIELDS:
${fieldList}

AVAILABLE DATA:
${availableData}

Match the available data to the target fields. Only fill fields where you have a confident match.

IMPORTANT: The "source" field must be a specific, citable reference that will be shown to the user. Examples:
- "GL Policy #POL-12345 (Hartford)"
- "vercel.com (Security page)"
- "Business Context (company_info)"
- "User Profile"
Never use vague sources like "existing records" or "available data".

Respond with JSON only:
{
  "fills": [
    { "fieldId": "field_id", "value": "the value from data", "source": "Specific source with identifier (e.g. GL Policy #ABC123, stripe.com)" }
  ],
  "unfillable": ["field_ids that couldn't be matched"],
  "explanation": "Brief note about what was filled and what couldn't be found, citing sources"
}`;
}
