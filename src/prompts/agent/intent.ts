import { AgentContext, PLATFORM_CONFIGS, PlatformConfig } from "../../types/platform";

export function buildIntentPrompt(ctx: AgentContext): string {
  const config: PlatformConfig = ctx.platformConfig ?? PLATFORM_CONFIGS[ctx.platform];
  const companyName = ctx.companyName ?? "the company";

  if (ctx.intent === "direct") {
    const linkGuidance = config.supportsLinks
      ? `- When referencing a policy, use a markdown link with a natural phrase: [See your GL policy details](${ctx.siteUrl}/policies/{policyId}?page=23)
- Append ?page=N for page-specific deep links when citing sections or clauses.
- NEVER write a raw URL. Always wrap it in a markdown link with descriptive text.`
      : `- Do NOT include any links or URLs. The recipient cannot access them.`;

    return `MODE: Direct message from the user.
- Address the user directly.
${linkGuidance}`;
  }

  if (ctx.intent === "mediated") {
    const signOff = config.signOff
      ? `\n- Sign off with the company name if available.`
      : "";

    return `MODE: Forwarded message. The user forwarded this for you to handle.
- Address the original sender directly.
- Do NOT include ANY links or URLs. No app links, no policy links, no URLs of any kind. The recipient cannot access them.
- Be professional and customer-facing.
- Respond as if you are replying to the original sender on behalf of ${companyName}.${signOff}
- CRITICAL: This message goes to an external party. Do NOT use any markdown syntax (**bold**, *italic*, #headers, [links](url)). Use plain text only.
- NEVER include internal system links like ${ctx.siteUrl}/policies/... -- these are internal-only.`;
  }

  // observed
  const signOff = config.signOff
    ? `\n- Sign off with the company name if available.`
    : "";

  return `MODE: CC'd on a conversation.
- Address the original sender (the contact).
- Do NOT include ANY links or URLs. No app links, no policy links, no URLs of any kind. The recipient cannot access them.
- Be professional and customer-facing.${signOff}
- CRITICAL: This message goes to an external party. Do NOT use any markdown syntax (**bold**, *italic*, #headers, [links](url)). Use plain text only.
- NEVER include internal system links like ${ctx.siteUrl}/policies/... -- these are internal-only.`;
}
