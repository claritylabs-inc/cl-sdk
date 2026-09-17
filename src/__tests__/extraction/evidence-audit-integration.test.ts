import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtractor } from "../../extraction/coordinator";
import * as audits from "../../extraction/evidence-audit";
import { buildSourceSpan, PolicyOperationalProfileSchema } from "../../source";
import type { GenerateObject } from "../../core/types";
import type { DecisionInput } from "../../core/decisions";
import type {
  ExtractionSectionResult,
  ExtractionSectionStore,
} from "../../extraction/source-tree-extractor";
import { decisionTestConfig } from "../fixtures/decision-test-helpers";

const span = buildSourceSpan(
  {
    documentId: "policy",
    sourceKind: "policy_pdf",
    pageStart: 1,
    pageEnd: 1,
    text: "Declarations. Policy ABC. Named insured Acme. CGL each occurrence limit $2,000,000. Deductible $500.",
  },
  0,
);
const profile = PolicyOperationalProfileSchema.parse({
  documentType: "policy",
  linesOfBusiness: ["CGL"],
  policyNumber: { value: "ABC", sourceSpanIds: [span.id] },
  namedInsured: { value: "Acme", sourceSpanIds: [span.id] },
  sourceSpanIds: [span.id],
  coverages: [
    {
      name: "CGL",
      limit: "$1,000,000",
      deductible: "$500",
      sourceSpanIds: [span.id],
    },
  ],
});
function generator() {
  return vi.fn(async (request: Parameters<GenerateObject>[0]) => {
    if (request.taskKind === "extraction_coverage_cleanup")
      return {
        object: {
          coverageDecisions: [
            {
              coverageIndex: 0,
              action: "update",
              limit: "$2,000,000",
              sourceSpanIds: [span.id],
            },
          ],
          warnings: [],
        },
      };
    if (request.taskKind === "extraction_review") {
      const payload = JSON.parse(
        request.prompt.slice(request.prompt.indexOf("\n") + 1),
      );
      payload.snapshot.document.declarations.line = "gl";
      return { object: payload.snapshot };
    }
    return { object: profile };
  });
}
const good = (id: string) =>
  id.endsWith("category")
    ? "supported_class"
    : id.endsWith("supported") || id.endsWith("context")
      ? 1
      : 0;
function config() {
  return decisionTestConfig("extraction.audit", good);
}
afterEach(() => vi.restoreAllMocks());

describe("final extractor audit integration", () => {
  it.each(["source-tree-v1", "source-tree-v2"] as const)(
    "audits final cleanup/materialization and preserves source manifests in %s",
    async (protocolVersion) => {
      const generate = generator();
      const decisions = config();
      const decide = vi.fn(decisions.decide!);
      const result = await createExtractor({
        generateObject: generate as GenerateObject,
        ...decisions,
        decide,
      }).extract("original-pdf", "policy", {
        sourceSpans: [span],
        protocolVersion,
        evidenceAudit: { maxRepairRounds: 0 },
      });
      expect(result.operationalProfile!.coverages[0].limit).toBe("$2,000,000");
      const facts = (
        decide.mock.calls[0][0].state as {
          factIndex: Array<{ path: string; value: unknown }>;
        }
      ).factIndex;
      expect(
        facts.find((fact) => fact.path === "/profile/coverages/0/limit")?.value,
      ).toBe("$2,000,000");
      expect(
        facts.find((fact) => fact.path === "/document/coverages/0/limit")
          ?.value,
      ).toBe("$2,000,000");
      expect(result.evidenceAudit?.auditedSnapshots).toEqual([
        "profile",
        "document",
      ]);
      audits.validateExtractionAuditBinding(result.evidenceAudit!, {
        profile: result.operationalProfile!,
        document: result.document,
        sourceSpans: result.sourceSpans,
        sourceTree: result.sourceTree!,
        originalSourceSpans: [span],
      });
      if (protocolVersion === "source-tree-v2") {
        expect(result.completionManifest?.completeSourceCoverage).toBe(true);
        expect(result.completionManifest?.eligibleSourceSpanIds).toContain(
          span.id,
        );
      }
      expect(result.evidenceAudit?.status).toBe("verified_text");
      expect(result.reviewReport.qualityGateStatus).toBe("passed");
    },
  );

  it("audits resumed final output without replaying completed extraction or cleanup", async () => {
    const saved = new Map<string, ExtractionSectionResult>();
    const store: ExtractionSectionStore = {
      load: async ({ sectionId }) => saved.get(sectionId),
      save: async (section) => {
        saved.set(section.sectionId, section);
      },
    };
    const generate = generator();
    const extractor = createExtractor({
      generateObject: generate as GenerateObject,
      ...config(),
    });
    const options = {
      sourceSpans: [span],
      protocolVersion: "source-tree-v2" as const,
      sectionStore: store,
      evidenceAudit: { maxRepairRounds: 0 },
    };
    const first = await extractor.extract("original-pdf", "policy", options);
    const priorCalls = generate.mock.calls.length;
    const second = await extractor.extract("original-pdf", "policy", options);
    expect(generate.mock.calls.length).toBe(priorCalls);
    expect(second.evidenceAudit!.metrics.requestCount).toBeGreaterThan(0);
    audits.validateExtractionAuditBinding(second.evidenceAudit!, {
      profile: second.operationalProfile!,
      document: second.document,
      sourceSpans: second.sourceSpans,
      sourceTree: second.sourceTree!,
      originalSourceSpans: [span],
    });
    expect(second.completionManifest).toEqual(first.completionManifest);
  });

  it("warn returns unresolved diagnostics while strict uses the existing failed gate", async () => {
    const options = {
      sourceSpans: [span],
      evidenceAudit: { maxRepairRounds: 0 },
    };
    const warned = await createExtractor({
      generateObject: generator() as GenerateObject,
      ...decisionTestConfig("extraction.audit", (id) =>
        id === "s0_omitted" ? 1 : good(id),
      ),
      qualityGate: "warn",
    }).extract("original", "policy", options);
    expect(warned.evidenceAudit?.status).toBe("unresolved");
    expect(
      warned.reviewReport.issues.some((issue) => issue.severity === "blocking"),
    ).toBe(true);
    await expect(
      createExtractor({
        generateObject: generator() as GenerateObject,
        ...decisionTestConfig("extraction.audit", (id) =>
          id === "s0_omitted" ? 1 : good(id),
        ),
        qualityGate: "strict",
      }).extract("original", "policy", options),
    ).rejects.toThrow("Extraction quality gate failed");
  });

  it("shadow preserves output and quality status without generating a repair", async () => {
    const original = await createExtractor({
      generateObject: generator() as GenerateObject,
    }).extract("original", "policy", { sourceSpans: [span] });
    const decisions = config();
    decisions.decisionPolicy!.families!["extraction.audit"].mode = "shadow";
    const generate = generator();
    const shadow = await createExtractor({
      generateObject: generate as GenerateObject,
      ...decisions,
    }).extract("original", "policy", { sourceSpans: [span] });
    expect(shadow.document).toEqual(original.document);
    expect(shadow.operationalProfile).toEqual(original.operationalProfile);
    expect(shadow.reviewReport).toEqual(original.reviewReport);
    expect(shadow.evidenceAudit?.status).toBe("shadow");
    expect(
      generate.mock.calls.some(
        ([request]) => request.taskKind === "extraction_review",
      ),
    ).toBe(false);
  });

  it("preserves original PDF/options for one contextual repair and reverifies its snapshot", async () => {
    const generate = generator();
    const decisions = decisionTestConfig("extraction.audit", (id) =>
      id === "s0_omitted" ? 1 : good(id),
    );
    const decide = vi.fn(decisions.decide!);
    const result = await createExtractor({
      generateObject: generate as GenerateObject,
      ...decisions,
      decide,
      providerOptions: {
        customRouting: "kept",
        images: [{ imageBase64: "page-image", mimeType: "image/png" }],
      },
    }).extract("original-full-pdf", "policy", { sourceSpans: [span] });
    const repairs = generate.mock.calls.filter(
      ([request]) => request.taskKind === "extraction_review",
    );
    expect(repairs).toHaveLength(1);
    expect(repairs[0][0].providerOptions).toMatchObject({
      pdfBase64: "original-full-pdf",
      customRouting: "kept",
      images: [{ imageBase64: "page-image", mimeType: "image/png" }],
    });
    expect(repairs[0][0].providerOptions?.abortSignal).toBeInstanceOf(
      AbortSignal,
    );
    expect(repairs[0][0].prompt).toContain(span.text);
    expect(result.evidenceAudit?.repairRounds).toBe(1);
    expect(
      result.evidenceAudit?.metrics.batches.some((batch) => batch.round === 1),
    ).toBe(true);
    expect(decide.mock.calls.length).toBeGreaterThan(1);
  });

  it.each(["legacy", "shadow"] as const)(
    "optional %s diagnostic failure cannot fail or change existing extraction",
    async (mode) => {
      const original = await createExtractor({
        generateObject: generator() as GenerateObject,
      }).extract("original", "policy", { sourceSpans: [span] });
      const spy = vi
        .spyOn(audits, "auditExtractionEvidence")
        .mockRejectedValueOnce(new Error("diagnostic inventory failed"));
      const decisions = config();
      decisions.decisionPolicy!.families!["extraction.audit"].mode = mode;
      const result = await createExtractor({
        generateObject: generator() as GenerateObject,
        ...decisions,
      }).extract("original", "policy", { sourceSpans: [span] });
      expect(spy).toHaveBeenCalledOnce();
      expect(result.document).toEqual(original.document);
      expect(result.reviewReport).toEqual(original.reviewReport);
      expect(result.evidenceAudit).toBeUndefined();
    },
  );
});
