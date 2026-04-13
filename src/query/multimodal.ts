import { safeGenerateObject } from "../core/safe-generate";
import type { GenerateObject, LogFn, TokenUsage } from "../core/types";
import { buildInterpretAttachmentPrompt } from "../prompts/query/interpret-attachment";
import {
  AttachmentInterpretationSchema,
  type AttachmentInterpretation,
  type EvidenceItem,
  type QueryAttachment,
} from "../schemas/query";

function attachmentSourceId(attachment: QueryAttachment, index: number): string {
  return attachment.id ?? `attachment-${index + 1}`;
}

function buildAttachmentProviderOptions(
  attachment: QueryAttachment,
  providerOptions?: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...providerOptions,
    attachments: [
      {
        kind: attachment.kind,
        name: attachment.name,
        mimeType: attachment.mimeType,
        base64: attachment.base64,
        text: attachment.text,
        description: attachment.description,
      },
    ],
  };

  if (attachment.kind === "pdf" && attachment.base64) {
    merged.pdfBase64 = attachment.base64;
  }

  if (attachment.kind === "image" && attachment.base64) {
    merged.images = [
      {
        imageBase64: attachment.base64,
        mimeType: attachment.mimeType ?? "image/jpeg",
      },
    ];
  }

  return merged;
}

function buildAttachmentEvidenceText(
  attachment: QueryAttachment,
  interpretation: AttachmentInterpretation,
): string {
  const lines = [
    `Attachment kind: ${attachment.kind}`,
    attachment.name ? `Attachment name: ${attachment.name}` : null,
    attachment.mimeType ? `MIME type: ${attachment.mimeType}` : null,
    attachment.description ? `Caller description: ${attachment.description}` : null,
    `Summary: ${interpretation.summary}`,
    interpretation.extractedFacts.length > 0
      ? `Extracted facts:\n${interpretation.extractedFacts.map((fact) => `- ${fact}`).join("\n")}`
      : null,
    interpretation.recommendedFocus.length > 0
      ? `Important follow-up details:\n${interpretation.recommendedFocus.map((item) => `- ${item}`).join("\n")}`
      : null,
    attachment.kind === "text" && attachment.text
      ? `Original text:\n${attachment.text}`
      : null,
  ];

  return lines.filter(Boolean).join("\n");
}

export async function interpretAttachments(params: {
  attachments?: QueryAttachment[];
  question: string;
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  log?: LogFn;
  onUsage?: (usage?: TokenUsage) => void;
}): Promise<{ evidence: EvidenceItem[]; contextSummary?: string }> {
  const { attachments = [], question, generateObject, providerOptions, log, onUsage } = params;

  if (attachments.length === 0) {
    return { evidence: [] };
  }

  const evidence: EvidenceItem[] = [];

  for (const [index, attachment] of attachments.entries()) {
    const id = attachmentSourceId(attachment, index);

    if (attachment.kind === "text" && attachment.text) {
      const textEvidence = buildAttachmentEvidenceText(attachment, {
        summary: attachment.description ?? "User supplied text context.",
        extractedFacts: [attachment.text],
        recommendedFocus: [],
        confidence: 1,
      });

      evidence.push({
        source: "attachment",
        attachmentId: id,
        chunkId: id,
        documentId: id,
        text: textEvidence,
        relevance: 0.95,
        metadata: [
          { key: "kind", value: attachment.kind },
          ...(attachment.name ? [{ key: "name", value: attachment.name }] : []),
        ],
      });
      continue;
    }

    const prompt = buildInterpretAttachmentPrompt(question, attachment);

    const { object, usage } = await safeGenerateObject<AttachmentInterpretation>(
      generateObject as GenerateObject<AttachmentInterpretation>,
      {
        prompt,
        schema: AttachmentInterpretationSchema,
        maxTokens: 2048,
        providerOptions: buildAttachmentProviderOptions(attachment, providerOptions),
      },
      {
        fallback: {
          summary: attachment.description ?? `User supplied ${attachment.kind} attachment.`,
          extractedFacts: [],
          recommendedFocus: [],
          confidence: 0.2,
        },
        log,
        onError: (error, attempt) =>
          log?.(`Attachment interpretation attempt ${attempt + 1} failed for "${attachment.name ?? id}": ${error}`),
      },
    );

    onUsage?.(usage);

    evidence.push({
      source: "attachment",
      attachmentId: id,
      chunkId: id,
      documentId: id,
      text: buildAttachmentEvidenceText(attachment, object as AttachmentInterpretation),
      relevance: Math.max(0.7, (object as AttachmentInterpretation).confidence),
      metadata: [
        { key: "kind", value: attachment.kind },
        ...(attachment.name ? [{ key: "name", value: attachment.name }] : []),
      ],
    });
  }

  const contextSummary = evidence
    .map((item, index) => `Attachment ${index + 1}:\n${item.text}`)
    .join("\n\n");

  return { evidence, contextSummary };
}
