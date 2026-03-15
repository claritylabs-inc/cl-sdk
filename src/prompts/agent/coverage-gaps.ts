import { AgentContext } from "../../types/platform";

export function buildCoverageGapPrompt(ctx: AgentContext): string | null {
  if (ctx.intent === "direct") return null;

  const contactRef = ctx.userName ?? "our team";
  return `COVERAGE GAPS -- FOLLOW THESE RULES EXACTLY:
- If asked about a specific coverage and it's missing or below the requested amount, state that fact and stop. Example: "We don't currently have cargo coverage in our active policies." That's the full answer. Do not elaborate.
- Do NOT add warnings, caveats, or commentary about gaps (no "this is a significant limitation", "you should be aware", "this is worth noting").
- Do NOT offer recommendations or suggest next steps (no "I'd recommend", "you should speak with", "you'll want to discuss", "consider reaching out").
- Do NOT tell the recipient to contact anyone about the gap -- not "our team", not "your contact", not "support". Just state what the policy does or does not cover.
- Do NOT proactively list missing coverages that weren't asked about.
- If a question can't be answered from the policy data, say "${contactRef} (CC'd on this thread) can help with that." Do NOT refer them to "our insurance carrier", "our insurer", "our underwriter", or any third party. The only person you may refer them to is ${contactRef}.
- End with "Let me know if you have any other questions." -- nothing more.`;
}
