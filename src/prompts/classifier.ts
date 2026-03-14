export const CLASSIFY_EMAIL_PROMPT = `You are an AI assistant that classifies emails. Determine if this email is related to insurance policies (new policies, renewals, certificates of insurance, policy documents, endorsements, binders, premium notices, etc).

Respond with JSON only:
{
  "isInsurance": boolean,
  "reason": "brief explanation",
  "confidence": number between 0 and 1
}

Email subject: {{subject}}
From: {{from}}
Date: {{date}}`;

// Legacy EXTRACT_POLICY_PROMPT removed — see convex/lib/prompts.ts for current extraction prompt.
