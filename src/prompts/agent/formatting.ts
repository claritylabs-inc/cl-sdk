import { AgentContext, PLATFORM_CONFIGS, PlatformConfig } from "../../types/platform";

export function buildFormattingPrompt(ctx: AgentContext): string {
  const config: PlatformConfig = ctx.platformConfig ?? PLATFORM_CONFIGS[ctx.platform];

  const baseStyle = `RESPONSE STYLE:
- Be direct and concise. Get to the answer immediately, no preamble.
- Keep responses to 2-4 short paragraphs max. Use bullet points for multiple items.
- If you don't have the information, say so in one sentence.
- Never fabricate or assume coverage details not in the data.
- Do not repeat the question back. Do not use filler like "Great question!" or "I'd be happy to help."
- For follow-up messages in a thread, be even shorter. Just answer the new question.`;

  let formatting: string;

  if (config.supportsMarkdown && config.supportsLinks) {
    // Chat, Slack, Discord
    formatting = `FORMATTING:
- You may use markdown formatting (bold, italic, headers) where it aids readability.
- Use markdown links for policy references: [descriptive text](url). Never show a raw URL.
- Cite the policy (carrier + policy number) inline. Mention page numbers only when specifically useful.
- Use simple dashes (-) for bullet points.
- Do NOT use em-dashes. Use commas, periods, or "--" instead.
- Do NOT use emojis, checkmarks, or special Unicode characters.`;
  } else if (config.supportsLinks) {
    // Email with links (direct mode)
    formatting = `FORMATTING:
- Write in plain text. No HTML, no markdown formatting (bold, italic, headers).
- The ONLY markdown you may use is links: [descriptive text](url). Use these ONLY for app policy links.
- Cite the policy (carrier + policy number) inline. Mention page numbers only when specifically useful.
- Do NOT use em-dashes. Use commas, periods, or "--" instead.
- Do NOT use emojis, checkmarks, or special Unicode characters.
- Use simple dashes (-) for bullet points.
- Keep the tone natural and human. Avoid patterns that read as AI-generated.`;
  } else {
    // SMS, email without links (mediated/observed)
    formatting = `FORMATTING:
- Write in plain text only. No HTML, no markdown formatting (bold, italic, headers, [links](url)).
- Do NOT include ANY links or URLs. No app links, no policy links, no URLs of any kind.
- Do NOT use em-dashes. Use commas, periods, or "--" instead.
- Do NOT use emojis, checkmarks, or special Unicode characters.
- Use simple dashes (-) for bullet points.
- Keep the tone natural and human. Avoid patterns that read as AI-generated.`;
  }

  const lengthConstraint = config.maxResponseLength
    ? `\n- Keep responses under ${config.maxResponseLength} characters.`
    : "";

  return `${baseStyle}\n\n${formatting}${lengthConstraint}`;
}
