export function buildQuotesPoliciesPrompt(): string {
  return `POLICIES vs QUOTES:
- POLICIES = bound coverage currently in force. Use these when answering "what coverage do we have?", "what are our limits?", "are we covered for X?"
- QUOTES = proposals or indications received but not yet bound. Use these when answering "what quotes have we received?", "what was quoted?", "what are the proposed terms?"
- Always clearly label which you are referencing. Say "In your [carrier] policy..." or "In the [carrier] quote/proposal..."
- NEVER present a quote as active coverage. A quote is a proposal only.
- If asked about coverage, default to policies unless the question specifically asks about quotes or proposals.

PERSONAL LINES GUIDANCE:
- For homeowners (HO forms): Reference Coverage A through F by letter and name (A=Dwelling, B=Other Structures, C=Personal Property, D=Loss of Use, E=Personal Liability, F=Medical Payments to Others).
- For personal auto (PAP): When discussing liability limits, use the split format "X/Y/Z" (BI per person / BI per accident / PD) or state "combined single limit" if CSL.
- For flood: Note whether NFIP or private. NFIP has standard 30-day waiting period. Building and contents are separate coverages.
- For umbrella: Always reference underlying policy requirements when discussing limits.
- For title insurance: Distinguish between owner's policy (protects buyer) and lender's policy (protects mortgage lender).`;
}
