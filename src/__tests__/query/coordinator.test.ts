import { describe, expect, it, vi } from "vitest";
import { createQueryAgent } from "../../query/coordinator";
import type { GenerateObject } from "../../core/types";
import type { DocumentStore, MemoryStore } from "../../storage/interfaces";
import type { DocumentChunk } from "../../storage/chunk-types";

describe("createQueryAgent multimodal query support", () => {
  it("interprets attachments and combines them with retrieved evidence", async () => {
    const calls: Array<{ prompt: string; providerOptions?: Record<string, unknown> }> = [];

    const generateObject: GenerateObject = vi.fn(async ({ prompt, providerOptions }) => {
      calls.push({ prompt, providerOptions });

      if (prompt.includes("interpreting a user-supplied attachment")) {
        expect(providerOptions).toMatchObject({
          attachments: [
            {
              kind: "image",
              name: "wall.jpg",
            },
          ],
          images: [
            {
              imageBase64: "image-base64",
              mimeType: "image/jpeg",
            },
          ],
          traceId: "test-trace",
        });

        return {
          object: {
            summary: "The photo shows a hole in the drywall near an electrical outlet.",
            extractedFacts: [
              "There is visible wall damage with an opening in the drywall.",
              "The damage appears indoors on a finished apartment wall.",
            ],
            recommendedFocus: [
              "Ask when the damage was first noticed.",
              "Ask whether there is any water intrusion or electrical risk nearby.",
            ],
            confidence: 0.93,
          },
        };
      }

      if (prompt.includes("You are a query classifier")) {
        expect(prompt).toContain("ATTACHMENT CONTEXT:");
        expect(prompt).toContain("hole in the drywall");

        return {
          object: {
            intent: "policy_question",
            subQuestions: [
              {
                question: "What details should I collect about the wall damage and is there coverage context in the stored policy?",
                intent: "policy_question",
                chunkTypes: ["coverage"],
              },
            ],
            requiresDocumentLookup: false,
            requiresChunkSearch: true,
            requiresConversationHistory: false,
          },
        };
      }

      if (prompt.includes("Answer the sub-question based on the evidence above")) {
        expect(prompt).toContain("Attachment kind: image");
        expect(prompt).toContain("hole in the drywall");
        expect(prompt).toContain("Coverage for sudden and accidental direct physical loss");

        return {
          object: {
            subQuestion: "What details should I collect about the wall damage and is there coverage context in the stored policy?",
            answer:
              "Collect photos, the discovery date, cause if known, and whether there is active water or electrical risk. The stored policy evidence references property coverage for sudden and accidental direct physical loss, but the attachment alone does not confirm cause.",
            citations: [
              {
                index: 1,
                chunkId: "attachment-1",
                documentId: "attachment-1",
                quote: "Summary: The photo shows a hole in the drywall near an electrical outlet.",
                relevance: 0.95,
              },
              {
                index: 2,
                chunkId: "doc-1:coverage:0",
                documentId: "doc-1",
                quote: "Coverage for sudden and accidental direct physical loss",
                relevance: 0.88,
              },
            ],
            confidence: 0.86,
            needsMoreContext: false,
          },
        };
      }

      if (prompt.includes("You are a verification agent")) {
        expect(prompt).toContain("\"id\": \"attachment-1\"");
        expect(prompt).toContain("\"id\": \"doc-1:coverage:0\"");

        return {
          object: {
            approved: true,
            issues: [],
          },
        };
      }

      if (prompt.includes("You are composing a final answer")) {
        return {
          object: {
            answer:
              "The photo shows interior wall damage, so the next details to collect are when it started, what caused it if known, and whether there is active water or electrical risk nearby [1]. The stored policy context points to property coverage for sudden and accidental direct physical loss, but coverage will depend on the actual cause and any exclusions [2].",
            citations: [
              {
                index: 1,
                chunkId: "attachment-1",
                documentId: "attachment-1",
                quote: "Summary: The photo shows a hole in the drywall near an electrical outlet.",
                relevance: 0.95,
              },
              {
                index: 2,
                chunkId: "doc-1:coverage:0",
                documentId: "doc-1",
                quote: "Coverage for sudden and accidental direct physical loss",
                relevance: 0.88,
              },
            ],
            intent: "policy_question",
            confidence: 0.84,
            followUp: "Do you know what caused the damage and when it started?",
          },
        };
      }

      throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
    });

    const documentStore: DocumentStore = {
      save: vi.fn(),
      get: vi.fn(),
      query: vi.fn(async () => []),
      delete: vi.fn(),
    };

    const memoryStore: MemoryStore = {
      addChunks: vi.fn(),
      search: vi.fn(async (): Promise<DocumentChunk[]> => [
        {
          id: "doc-1:coverage:0",
          documentId: "doc-1",
          type: "coverage",
          text: "Coverage for sudden and accidental direct physical loss, subject to exclusions.",
          metadata: { carrier: "Acme" },
        },
      ]),
      addTurn: vi.fn(),
      getHistory: vi.fn(async () => []),
      searchHistory: vi.fn(async () => []),
    };

    const agent = createQueryAgent({
      generateText: vi.fn(),
      generateObject,
      documentStore,
      memoryStore,
      providerOptions: { traceId: "test-trace" },
    });

    const result = await agent.query({
      question: "What should I ask about this damage and is there any coverage context?",
      attachments: [
        {
          kind: "image",
          name: "wall.jpg",
          mimeType: "image/jpeg",
          base64: "image-base64",
        },
      ],
    });

    expect(result.answer).toContain("The photo shows interior wall damage");
    expect(result.citations).toHaveLength(2);
    expect(result.reviewReport.qualityGateStatus).toBe("passed");
    expect(result.reviewReport.issues).toHaveLength(0);
    expect(memoryStore.search).toHaveBeenCalledTimes(1);
    expect(calls[0]?.prompt).toContain("interpreting a user-supplied attachment");
  });
});
