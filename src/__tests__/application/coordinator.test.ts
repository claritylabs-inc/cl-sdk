import { describe, expect, it, vi } from "vitest";
import { createApplicationPipeline } from "../../application/coordinator";
import type { GenerateObject } from "../../core/types";
import type { ApplicationState } from "../../schemas/application";
import type { ApplicationStore } from "../../application/store";
import type { MemoryStore } from "../../storage/interfaces";
import { buildPageSourceSpans } from "../../source";

describe("application coordinator", () => {
  it("passes caller-provided source spans through application classification and field extraction", async () => {
    const sourceSpans = buildPageSourceSpans([
      { documentId: "app-pdf-1", sourceKind: "application_pdf", pageNumber: 1, text: "Applicant Name: Acme LLC" },
    ]);
    const providerOptionsSeen: unknown[] = [];
    const generateObject = vi.fn<GenerateObject>(async ({ schema, providerOptions }) => {
      providerOptionsSeen.push(providerOptions);
      if (generateObject.mock.calls.length === 1) {
        return {
          object: schema.parse({
            isApplication: true,
            confidence: 0.99,
            applicationType: "general_liability",
          }),
        };
      }
      return {
        object: schema.parse({
          fields: [{
            id: "applicant_name",
            label: "Applicant Name",
            section: "General",
            fieldType: "text",
            required: true,
            value: "Acme LLC",
            source: "user",
            confidence: "confirmed",
          }],
        }),
      };
    });
    const pipeline = createApplicationPipeline({
      generateText: vi.fn(),
      generateObject,
    });

    const result = await pipeline.processApplication({
      applicationId: "app-1",
      pdfBase64: "pdf-base64",
      sourceSpans,
    });

    expect(result.state.fields).toHaveLength(1);
    expect(generateObject.mock.calls.map(([params]) => params.taskKind)).toEqual([
      "application_classify",
      "application_extract_fields",
    ]);
    expect(providerOptionsSeen).toEqual([
      expect.objectContaining({ sourceSpans }),
      expect.objectContaining({ sourceSpans }),
    ]);
  });

  it("attaches deterministic user source spans to parsed reply answers", async () => {
    let state: ApplicationState = {
      id: "app-1",
      applicationType: "general_liability",
      fields: [{
        id: "field-1",
        label: "Applicant Name",
        section: "General",
        fieldType: "text",
        required: true,
      }],
      batches: [["field-1"]],
      currentBatchIndex: 0,
      status: "collecting",
      createdAt: 1000,
      updatedAt: 1000,
    };
    const store: ApplicationStore = {
      save: vi.fn(async (nextState) => {
        state = nextState;
      }),
      get: vi.fn(async () => state),
      list: vi.fn(async () => [state]),
      delete: vi.fn(async () => undefined),
    };
    const generateObject = vi.fn<GenerateObject>(async ({ schema }) => {
      if (generateObject.mock.calls.length === 1) {
        return {
          object: schema.parse({
            primaryIntent: "answers_only",
            hasAnswers: true,
          }),
        };
      }
      return {
        object: schema.parse({
          answers: [{ fieldId: "field-1", value: "Acme LLC" }],
          unanswered: [],
        }),
      };
    });
    const pipeline = createApplicationPipeline({
      generateText: vi.fn(),
      generateObject,
      applicationStore: store,
    });

    const result = await pipeline.processReply({
      applicationId: "app-1",
      replyText: "Applicant name is Acme LLC.",
    });

    expect(result.fieldsFilled).toBe(1);
    expect(result.state.fields[0]).toEqual(expect.objectContaining({
      value: "Acme LLC",
      source: "user",
      confidence: "confirmed",
      validationStatus: "valid",
    }));
    expect(result.state.fields[0].userSourceSpanIds?.[0]).toMatch(/^app-1:reply:[a-f0-9]+:span:na:0:/);
  });

  it("uses memory search results as source-backed document backfill", async () => {
    const generateObject = vi.fn<GenerateObject>(async ({ schema }) => {
      if (generateObject.mock.calls.length === 1) {
        return {
          object: schema.parse({
            isApplication: true,
            confidence: 0.99,
            applicationType: "general_liability",
          }),
        };
      }
      return {
        object: schema.parse({
          fields: [{
            id: "policy_number",
            label: "Policy Number",
            section: "Prior Coverage",
            fieldType: "text",
            required: true,
          }],
        }),
      };
    });
    const memoryStore: MemoryStore = {
      addChunks: vi.fn(async () => undefined),
      search: vi.fn(async () => [{
        id: "chunk-1",
        documentId: "policy-1",
        type: "declaration" as const,
        text: "Policy Number GL-123",
        metadata: {
          fieldId: "policy_number",
          fieldLabel: "Policy Number",
          value: "GL-123",
          source: "Policy declaration page",
          sourceSpanIds: "policy-1:span:1",
        },
      }]),
      addTurn: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => []),
      searchHistory: vi.fn(async () => []),
    };

    const pipeline = createApplicationPipeline({
      generateText: vi.fn(),
      generateObject,
      memoryStore,
      documentStore: {
        save: vi.fn(),
        get: vi.fn(),
        query: vi.fn(),
        delete: vi.fn(),
      },
    });

    const result = await pipeline.processApplication({
      applicationId: "app-memory",
      pdfBase64: "pdf-base64",
    });

    expect(memoryStore.search).toHaveBeenCalledWith("Prior Coverage Policy Number", { limit: 3 });
    expect(result.state.fields[0]).toEqual(expect.objectContaining({
      value: "GL-123",
      source: "Policy declaration page",
      confidence: "high",
      validationStatus: "valid",
      sourceSpanIds: ["policy-1:span:1"],
    }));
  });
});
