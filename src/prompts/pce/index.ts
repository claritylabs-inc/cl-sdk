import type { PceEvidenceSource } from "../../schemas/pce";

export function buildPceNormalizePrompt(input: {
  requestText: string;
  evidenceSources: PceEvidenceSource[];
}): string {
  const evidence = input.evidenceSources.map((source) =>
    `- ${source.id}${source.label ? ` (${source.label})` : ""}: ${source.text.slice(0, 1200)}`,
  ).join("\n");

  return [
    "Normalize this policy change endorsement request into atomic change items.",
    "Use beforeValue only when the existing value is explicitly quoted in the provided evidence.",
    "Every beforeValue must include a citation with sourceId and exact quote.",
    "Ask missing-info questions for required details that are absent.",
    "",
    `Request:\n${input.requestText}`,
    "",
    `Evidence:\n${evidence || "(none provided)"}`,
  ].join("\n");
}

export function buildPceReplyPrompt(input: {
  replyText: string;
  openQuestions: Array<{ id: string; question: string; fieldPath?: string }>;
}): string {
  return [
    "Map this reply to the open missing-info questions.",
    "Return concise answers only for questions that are directly answered.",
    "",
    `Reply:\n${input.replyText}`,
    "",
    `Open questions:\n${input.openQuestions.map((question) => `- ${question.id}${question.fieldPath ? ` (${question.fieldPath})` : ""}: ${question.question}`).join("\n")}`,
  ].join("\n");
}
