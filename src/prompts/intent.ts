import { Platform } from "../types/platform";

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
  "suggestedIntent": "policy_question" | "coi_request" | "renewal_inquiry" | "claim_report" | "general" | "unrelated"
}

Message context:
{
  "platform": "${platform}",
  ${platformFields[platform]}
}`;
}
