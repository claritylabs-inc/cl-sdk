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
