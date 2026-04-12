import { Platform } from "../schemas/platform";

/**
 * Build a platform-agnostic message classification prompt.
 *
 * The prompt instructs Claude to classify an incoming message and suggest
 * an intent, with platform-specific context fields included in the schema.
 */
export function buildClassifyMessagePrompt(platform: Platform): string {
  const platformFields: Record<Platform, string> = {
    email: `"subject": "email subject line",
    "from": "sender email address",
    "date": "email date"`,
    chat: `"from": "sender display name",
    "sessionId": "chat session identifier"`,
    sms: `"from": "sender phone number"`,
    slack: `"from": "sender display name",
    "channel": "Slack channel name or ID",
    "threadId": "thread timestamp if in a thread"`,
    discord: `"from": "sender display name",
    "channel": "Discord channel name",
    "threadId": "thread ID if in a thread"`,
  };

  return `You are an AI assistant that classifies incoming ${platform} messages for an insurance policy management platform.

Analyze the message and determine:
1. Whether it is related to insurance
2. What the sender's intent is

Respond with JSON only:
{
  "isInsurance": boolean,
  "reason": "brief explanation",
  "confidence": number between 0 and 1,
  "suggestedIntent": "policy_question" | "coi_request" | "renewal_inquiry" | "claim_report" | "coverage_shopping" | "general" | "unrelated"
}

INTENT DETECTION:
- "policy_question": questions about existing coverage, limits, deductibles, endorsements (commercial or personal)
- "coi_request": requests for certificate of insurance or proof of coverage
- "renewal_inquiry": questions about upcoming renewals, rate changes, policy period
- "claim_report": reporting a loss or incident — includes property damage ("my roof leaked", "tree fell on house", "pipe burst"), auto accidents ("got in an accident", "someone hit my car"), theft, water damage, fire, liability incidents
- "coverage_shopping": looking for new coverage, requesting quotes, comparing rates ("I need homeowners insurance", "looking for auto coverage", "do I need flood insurance")
- "general": insurance-related but doesn't fit above categories
- "unrelated": not insurance-related

Message context:
{
  "platform": "${platform}",
  ${platformFields[platform]}
}`;
}
