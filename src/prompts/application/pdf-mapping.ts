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
