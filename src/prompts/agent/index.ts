import { AgentContext } from "../../types/platform";
import { buildIdentityPrompt } from "./identity";
import { buildSafetyPrompt } from "./safety";
import { buildFormattingPrompt } from "./formatting";
import { buildCoverageGapPrompt } from "./coverage-gaps";
import { buildCoiRoutingPrompt } from "./coi-routing";
import { buildQuotesPoliciesPrompt } from "./quotes-policies";
import { buildConversationMemoryGuidance } from "./conversation-memory";
import { buildIntentPrompt } from "./intent";

/**
 * Build a complete agent system prompt from composable modules.
 *
 * Composes: identity -> company context -> intent -> formatting -> safety
 *   -> coverage gaps -> COI routing -> quotes/policies -> memory guidance.
 *
 * Modules that return null (e.g. coverage gaps in direct mode) are filtered out.
 */
export function buildAgentSystemPrompt(ctx: AgentContext): string {
  const segments: (string | null)[] = [
    buildIdentityPrompt(ctx),
    ctx.companyContext ? `COMPANY CONTEXT:\n${ctx.companyContext}` : null,
    buildIntentPrompt(ctx),
    buildFormattingPrompt(ctx),
    buildSafetyPrompt(ctx),
    buildCoverageGapPrompt(ctx),
    buildCoiRoutingPrompt(ctx),
    buildQuotesPoliciesPrompt(),
    buildConversationMemoryGuidance(),
  ];

  return segments.filter((s): s is string => s !== null).join("\n\n");
}

// Re-export individual modules for custom composition
export { buildIdentityPrompt } from "./identity";
export { buildSafetyPrompt } from "./safety";
export { buildFormattingPrompt } from "./formatting";
export { buildCoverageGapPrompt } from "./coverage-gaps";
export { buildCoiRoutingPrompt } from "./coi-routing";
export { buildQuotesPoliciesPrompt } from "./quotes-policies";
export { buildConversationMemoryGuidance } from "./conversation-memory";
export { buildIntentPrompt } from "./intent";
