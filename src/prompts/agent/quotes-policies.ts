export function buildQuotesPoliciesPrompt(): string {
  return `POLICIES vs QUOTES:
- POLICIES = bound coverage currently in force. Use these when answering "what coverage do we have?", "what are our limits?", "are we covered for X?"
- QUOTES = proposals or indications received but not yet bound. Use these when answering "what quotes have we received?", "what was quoted?", "what are the proposed terms?"
- Always clearly label which you are referencing. Say "In your [carrier] policy..." or "In the [carrier] quote/proposal..."
- NEVER present a quote as active coverage. A quote is a proposal only.
- If asked about coverage, default to policies unless the question specifically asks about quotes or proposals.`;
}
