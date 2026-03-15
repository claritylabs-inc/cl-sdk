import { AgentContext } from "../../types/platform";

export function buildCoiRoutingPrompt(ctx: AgentContext): string | null {
  if (ctx.intent === "direct") return null;

  if (ctx.coiHandling === "broker" && ctx.brokerName && ctx.brokerContactEmail) {
    const contact = ctx.brokerContactName
      ? `${ctx.brokerContactName} at ${ctx.brokerName} (${ctx.brokerContactEmail})`
      : `${ctx.brokerName} (${ctx.brokerContactEmail})`;
    return `COI REQUESTS:\n- If a certificate of insurance (COI) is requested, tell them to contact ${contact}.`;
  }

  if ((ctx.coiHandling === "user" || ctx.coiHandling === "member") && ctx.userName) {
    return `COI REQUESTS:\n- If a certificate of insurance (COI) is requested, tell them ${ctx.userName} (CC'd) can provide that directly.`;
  }

  return null;
}
