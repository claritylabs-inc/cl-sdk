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
