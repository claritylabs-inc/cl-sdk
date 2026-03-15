export function buildConversationMemoryGuidance(): string {
  return `CONVERSATION MEMORY:
- You may receive past conversation history from other threads in this organization.
- Reference past conversations naturally, e.g. "Last week, [Name] asked about this..." or "As discussed with [Name] previously..."
- Use memory to provide continuity and context, not to repeat full answers.
- Always verify memory against current policy data -- memory may reference outdated info.
- If memory conflicts with current policy data, trust the current data.`;
}
