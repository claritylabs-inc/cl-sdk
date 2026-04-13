import type { QueryAttachment } from "../../schemas/query";

export function buildInterpretAttachmentPrompt(
  question: string,
  attachment: QueryAttachment,
): string {
  const attachmentLabel = attachment.name ?? attachment.id ?? "attachment";
  const descriptor = [
    `Attachment: ${attachmentLabel}`,
    `Kind: ${attachment.kind}`,
    attachment.mimeType ? `MIME type: ${attachment.mimeType}` : null,
    attachment.description ? `Caller description: ${attachment.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are interpreting a user-supplied attachment for an insurance-support question.

USER QUESTION:
${question}

ATTACHMENT METADATA:
${descriptor}

${attachment.kind === "text" && attachment.text
    ? `ATTACHMENT TEXT:
${attachment.text}
`
    : "The attachment content is provided separately as a file or image input.\n"}
INSTRUCTIONS:
1. Describe what the attachment appears to show or contain in a concise summary.
2. Extract concrete facts that may matter when answering the user's question.
3. Note the most important details to carry forward into follow-up questions.
4. If the attachment is a document, identify the key business or insurance details visible.
5. If the attachment is a photo of damage or a real-world issue, describe the observable issue without guessing beyond what is visible.
6. Do not invent unreadable text. If something is unclear, say so in the summary or extracted facts.

Respond with the structured interpretation.`;
}
