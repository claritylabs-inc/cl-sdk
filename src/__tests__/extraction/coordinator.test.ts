import { beforeEach, describe, expect, it, vi } from "vitest";

const { safeGenerateObject } = vi.hoisted(() => ({
  safeGenerateObject: vi.fn(),
}));

vi.mock("../../core/safe-generate", () => ({
  safeGenerateObject,
}));

import { createExtractor } from "../../extraction/coordinator";
import { buildSourceSpan, type SourceSpan, type SourceStore } from "../../source";

function buildPolicySpans(): SourceSpan[] {
  return [
    buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      sourceUnit: "page",
      pageStart: 1,
      pageEnd: 1,
      text: "Declarations. Policy Number GL-1. Named Insured Clarity Labs Inc.",
    }),
    buildSourceSpan({
      documentId: "doc-1",
      sourceKind: "policy_pdf",
      sourceUnit: "page",
      pageStart: 2,
      pageEnd: 2,
      text: "Technology Professional Liability. Limit of Liability $2,000,000 Each Claim.",
    }),
  ];
}

function mockOperationalProfile(policyTypes = ["professional_liability"]) {
  safeGenerateObject.mockImplementation(async (_generateObject, params) => {
    if (params.taskKind !== "extraction_operational_profile") {
      throw new Error(`Unexpected task ${String(params.taskKind)}`);
    }

    return {
      object: {
        documentType: "policy",
        policyTypes,
        policyNumber: {
          value: "GL-1",
          confidence: "high",
          sourceNodeIds: [],
          sourceSpanIds: [],
        },
        namedInsured: {
          value: "Clarity Labs Inc.",
          confidence: "high",
          sourceNodeIds: [],
          sourceSpanIds: [],
        },
        coverages: [],
        parties: [],
        endorsementSupport: [],
        sourceNodeIds: [],
        sourceSpanIds: [],
        warnings: [],
      },
      usage: { inputTokens: 12, outputTokens: 6 },
    };
  });
}

describe("createExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOperationalProfile();
  });

  it("returns an object with extract method", () => {
    const extractor = createExtractor({
      generateObject: vi.fn(),
    });

    expect(typeof extractor.extract).toBe("function");
  });

  it("requires caller-provided source spans instead of raw PDF extraction", async () => {
    const extractor = createExtractor({
      generateObject: vi.fn(),
    });

    await expect(extractor.extract("full-pdf-base64", "doc-1")).rejects.toThrow(
      /requires preprocessed source spans/,
    );
    expect(safeGenerateObject).not.toHaveBeenCalled();
  });

  it("extracts from source spans without form inventory, page map, focused extractor, or formatter model passes", async () => {
    const generateObject = vi.fn();
    const extractor = createExtractor({
      generateObject,
      providerOptions: { provider: "test" },
    });

    const result = await extractor.extract("ignored-pdf-base64", "doc-1", {
      sourceSpans: buildPolicySpans(),
    });

    const taskKinds = safeGenerateObject.mock.calls.map(([, params]) => params.taskKind);
    expect(taskKinds).toEqual(["extraction_operational_profile"]);
    expect(taskKinds).not.toContain("extraction_form_inventory");
    expect(taskKinds).not.toContain("extraction_page_map");
    expect(taskKinds).not.toContain("extraction_focused");
    expect(taskKinds).not.toContain("extraction_format");
    expect(result.chunks).toEqual([]);
    expect(result.sourceTree?.length).toBeGreaterThan(0);
    expect(result.operationalProfile?.policyTypes).toEqual(["professional_liability"]);
    expect(result.usageReporting).toEqual({
      modelCalls: 1,
      callsWithUsage: 1,
      callsMissingUsage: 0,
    });
    expect(result.performanceReport.modelCalls).toEqual([
      expect.objectContaining({
        taskKind: "extraction_operational_profile",
        label: "operational_profile",
        maxTokens: 8192,
        usageReported: true,
      }),
    ]);
  });

  it("uses task-specific model budget capabilities for the operational profile pass", async () => {
    const extractor = createExtractor({
      generateObject: vi.fn(),
      modelCapabilitiesByTaskKind: {
        extraction_operational_profile: { maxOutputTokens: 16384 },
      },
    });

    await extractor.extract("ignored-pdf-base64", "doc-1", {
      sourceSpans: buildPolicySpans(),
    });

    expect(safeGenerateObject).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        taskKind: "extraction_operational_profile",
        maxTokens: 8192,
        budgetDiagnostics: expect.objectContaining({
          taskKind: "extraction_operational_profile",
          maxTokens: 8192,
        }),
      }),
      expect.objectContaining({
        maxRetries: 0,
        retry: false,
      }),
    );
  });

  it("persists source spans and source chunks before model extraction when a source store is configured", async () => {
    const sourceStore: SourceStore = {
      addSourceSpans: vi.fn().mockResolvedValue(undefined),
      addSourceChunks: vi.fn().mockResolvedValue(undefined),
      getSourceSpan: vi.fn().mockResolvedValue(null),
      getSourceSpansByDocument: vi.fn().mockResolvedValue([]),
      getSourceChunksByDocument: vi.fn().mockResolvedValue([]),
      deleteDocumentSource: vi.fn().mockResolvedValue(undefined),
      searchSourceSpans: vi.fn().mockResolvedValue([]),
    };
    const sourceSpans = buildPolicySpans();
    const extractor = createExtractor({
      generateObject: vi.fn(),
      sourceStore,
    });

    await extractor.extract("ignored-pdf-base64", "doc-1", { sourceSpans });

    expect(sourceStore.addSourceSpans).toHaveBeenCalledWith(sourceSpans);
    expect(sourceStore.addSourceChunks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          documentId: "doc-1",
          sourceSpanIds: sourceSpans.map((span) => span.id),
        }),
      ]),
    );
  });
});
