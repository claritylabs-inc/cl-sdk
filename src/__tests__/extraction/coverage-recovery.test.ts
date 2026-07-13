import { describe, expect, it, vi } from "vitest";
import type { GenerateObject } from "../../core/types";
import type { ModelTaskKind } from "../../core/model-budget";
import { buildDocumentSourceTree, buildPageSourceSpans, type SourceSpan } from "../../source";
import { runSourceTreeExtraction } from "../../extraction/source-tree-extractor";
import { runCoverageRecovery } from "../../extraction/coverage-recovery";
import fixtures from "../fixtures/coverage-recovery-policies.json";

const resolveBudget = (taskKind: ModelTaskKind, hintTokens: number) => ({
  taskKind,
  hintTokens,
  maxTokens: 16_384,
  outputTruncationRisk: "low" as const,
  warnings: [],
});

type Fixture = (typeof fixtures)[number];

function pageFromPrompt(prompt: string): [number, number] {
  const match = prompt.match(/Region: pages (\d+)-(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function candidateForFixture(fixture: Fixture, sourceSpans: SourceSpan[], start: number, end: number) {
  const spanId = (page: number) => sourceSpans.find((span) => span.pageStart === page)!.id;
  const inRange = <T extends { sourcePage: number }>(rows: T[] | undefined) =>
    (rows ?? []).filter((row) => row.sourcePage >= start && row.sourcePage <= end);
  return {
    coverages: inRange(fixture.recovery.coverages).map((coverage) => ({
      name: coverage.name,
      lineOfBusiness: coverage.lineOfBusiness,
      ...("endorsementNumber" in coverage && coverage.endorsementNumber
        ? { endorsementNumber: coverage.endorsementNumber }
        : {}),
      limits: coverage.terms.map((term) => ({
        ...term,
        sourceNodeIds: [],
        sourceSpanIds: [spanId(coverage.sourcePage)],
      })),
      sourceNodeIds: [],
      sourceSpanIds: [spanId(coverage.sourcePage)],
    })),
    coverageSchedules: inRange(fixture.recovery.schedules).map((schedule) => ({
      name: schedule.name,
      kind: schedule.kind,
      items: schedule.items.map((item) => ({
        ...item,
        sourceSpanIds: [spanId(schedule.sourcePage)],
      })),
      sourceSpanIds: [spanId(schedule.sourcePage)],
      pageStart: schedule.sourcePage,
      pageEnd: schedule.sourcePage,
    })),
    premiumBreakdown: inRange(fixture.recovery.premiumBreakdown).map((row) => ({
      line: row.line,
      amount: row.amount,
      sourceNodeIds: [],
      sourceSpanIds: [spanId(row.sourcePage)],
    })),
    taxesAndFees: inRange(fixture.recovery.taxesAndFees).map((row) => ({
      name: row.name,
      amount: row.amount,
      type: row.type,
      sourceNodeIds: [],
      sourceSpanIds: [spanId(row.sourcePage)],
    })),
    totalCost: fixture.recovery.totalCost
      && fixture.recovery.totalCost.sourcePage >= start
      && fixture.recovery.totalCost.sourcePage <= end
      ? {
          value: fixture.recovery.totalCost.value,
          sourceNodeIds: [],
          sourceSpanIds: [spanId(fixture.recovery.totalCost.sourcePage)],
        }
      : undefined,
    warnings: [],
  };
}

function modelForFixture(fixture: Fixture, sourceSpans: SourceSpan[]): GenerateObject {
  return vi.fn(async (params) => {
    if (params.taskKind === "extraction_operational_profile") {
      return { object: { documentType: "policy", linesOfBusiness: ["UN"], coverages: [] } };
    }
    if (params.prompt.startsWith("Discover every document region")) {
      return { object: { regions: fixture.regions, warnings: [] } };
    }
    if (params.prompt.startsWith("Recover missing source-backed policy coverage")) {
      const [start, end] = pageFromPrompt(params.prompt);
      return { object: candidateForFixture(fixture, sourceSpans, start, end) };
    }
    if (params.taskKind === "extraction_coverage_cleanup") {
      return { object: { coverageDecisions: [], warnings: [] } };
    }
    return { object: {} };
  }) as GenerateObject;
}

describe("source-grounded coverage recovery", () => {
  for (const fixture of fixtures) {
    it(`recovers the complete ${fixture.id} fixture without unsupported rows`, async () => {
      const fillerPages = Array.from({ length: fixture.fillerPagesThrough ?? 0 }, (_, index) => ({
        documentId: fixture.id,
        pageNumber: index + 1,
        text: `Administrative continuation page ${index + 1}`,
      }));
      const suppliedPages = fixture.pages.map((page) => ({
        documentId: fixture.id,
        pageNumber: page.page,
        text: page.text,
      }));
      const pages = new Map([...fillerPages, ...suppliedPages].map((page) => [page.pageNumber, page]));
      const sourceSpans = buildPageSourceSpans([...pages.values()].sort((left, right) => left.pageNumber - right.pageNumber));
      const result = await runSourceTreeExtraction({
        id: fixture.id,
        sourceSpans,
        generateObject: modelForFixture(fixture, sourceSpans),
        resolveBudget,
        trackUsage: vi.fn(),
        coverageRecovery: { enabled: true },
      });

      expect(result.operationalProfile.coverages.map((coverage) => coverage.name)).toEqual(fixture.expected.coverages);
      expect(result.operationalProfile.coverages.flatMap((coverage) => coverage.limits.map((term) => term.label))).toEqual(fixture.expected.terms);
      expect(result.operationalProfile.coverageSchedules?.map((schedule) => schedule.name) ?? []).toEqual(fixture.expected.schedules);
      expect([
        ...(result.operationalProfile.premiumBreakdown?.map((row) => row.line) ?? []),
        ...(result.operationalProfile.taxesAndFees?.map((row) => row.name) ?? []),
        ...(result.operationalProfile.totalCost ? ["Total Cost"] : []),
      ]).toEqual(fixture.expected.financial);
      expect(result.operationalProfile.coverages.some((coverage) => /premium|fee|exposure|declined/i.test(coverage.name))).toBe(false);
      if (fixture.id === "auto-nonstandard") {
        expect((result.document as { vehicles?: unknown[] }).vehicles).toHaveLength(1);
      }
      if (fixture.id === "property-late-schedule") {
        expect((result.document as { locations?: unknown[] }).locations).toHaveLength(1);
      }
      if (fixture.id === "inland-marine-equipment") {
        expect((result.document as { vehicles?: unknown[] }).vehicles ?? []).toHaveLength(0);
        expect((result.document as { locations?: unknown[] }).locations ?? []).toHaveLength(0);
      }
      if (fixture.id === "supplied-policy-regression-sanitized") {
        expect(result.operationalProfile.coverageSchedules?.map((schedule) => schedule.items.length)).toEqual([2, 2]);
        expect(result.operationalProfile.coverages
          .flatMap((coverage) => coverage.limits)
          .find((term) => term.label === "Combined Deductible"))
          .toMatchObject({
            value: "$2,500",
            appliesTo: "one Occurrence resulting in covered loss to Vehicle and Trailer",
          });
        expect(result.operationalProfile.totalCost?.value).toBe("$5,166.32");
      }
      expect(result.coverageRecovery).toEqual(expect.objectContaining({
        version: "coverage-recovery-v2",
        status: "succeeded",
        citationRejectionCount: 0,
      }));
      const validSpanIds = new Set(sourceSpans.map((span) => span.id));
      const persistedSpanIds = [
        ...result.operationalProfile.coverages.flatMap((coverage) => [
          ...coverage.sourceSpanIds,
          ...coverage.limits.flatMap((term) => term.sourceSpanIds),
        ]),
        ...(result.operationalProfile.coverageSchedules ?? []).flatMap((schedule) => [
          ...schedule.sourceSpanIds,
          ...schedule.items.flatMap((item) => item.sourceSpanIds),
        ]),
      ];
      expect(persistedSpanIds.every((id) => validSpanIds.has(id))).toBe(true);
    });
  }

  it("rejects unsupported numeric facts even when the citation ID exists", async () => {
    const sourceSpans = buildPageSourceSpans([{
      documentId: "invalid-grounding",
      pageNumber: 1,
      text: "Liability Each Occurrence $1,000,000",
    }]);
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") return { object: { coverages: [] } };
      if (params.prompt.startsWith("Discover every document region")) {
        return { object: { regions: [{ pageStart: 1, pageEnd: 1, reason: "limit row" }], warnings: [] } };
      }
      if (params.prompt.startsWith("Recover missing source-backed policy coverage")) {
        return { object: {
          coverages: [{
            name: "Liability",
            limits: [{
              kind: "each_occurrence_limit",
              label: "Each Occurrence",
              value: "$9,999,999",
              sourceNodeIds: [],
              sourceSpanIds: [sourceSpans[0]!.id],
            }],
            sourceNodeIds: [],
            sourceSpanIds: [sourceSpans[0]!.id],
          }],
        } };
      }
      return { object: { coverageDecisions: [], warnings: [] } };
    }) as GenerateObject;
    const result = await runSourceTreeExtraction({
      id: "invalid-grounding",
      sourceSpans,
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
      coverageRecovery: { enabled: true },
    });
    expect(result.operationalProfile.coverages).toEqual([]);
    expect(result.coverageRecovery.citationRejectionCount).toBeGreaterThan(0);
  });

  it("reports recovery failure without mutating the primary profile", async () => {
    const sourceSpans = buildPageSourceSpans([{
      documentId: "recovery-failure",
      pageNumber: 1,
      text: "General Liability Each Occurrence $1,000,000",
    }]);
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") {
        return { object: {
          coverages: [{
            name: "General Liability",
            limit: "$1,000,000",
            limits: [],
            sourceNodeIds: [],
            sourceSpanIds: [sourceSpans[0]!.id],
          }],
        } };
      }
      if (params.taskKind === "extraction_coverage_recovery") throw new Error("provider unavailable");
      return { object: { coverageDecisions: [], warnings: [] } };
    }) as GenerateObject;
    const result = await runSourceTreeExtraction({
      id: "recovery-failure",
      sourceSpans,
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
      coverageRecovery: { enabled: true },
    });
    expect(result.coverageRecovery.status).toBe("failed");
    expect(result.coverageRecovery.modelCallCount).toBe(1);
    expect(result.operationalProfile.coverages).toHaveLength(1);
  });

  it("does not call recovery models when the option is disabled", async () => {
    const sourceSpans = buildPageSourceSpans([{
      documentId: "recovery-disabled",
      pageNumber: 1,
      text: "General Liability Each Occurrence $1,000,000",
    }]);
    const generateObject = vi.fn(async (params) => {
      if (params.taskKind === "extraction_operational_profile") {
        return { object: { coverages: [] } };
      }
      return { object: { coverageDecisions: [], warnings: [] } };
    }) as GenerateObject;
    const result = await runSourceTreeExtraction({
      id: "recovery-disabled",
      sourceSpans,
      generateObject,
      resolveBudget,
      trackUsage: vi.fn(),
      coverageRecovery: { enabled: false },
    });
    expect(result.coverageRecovery.status).toBe("disabled");
    expect(generateObject).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskKind: "extraction_coverage_recovery" }),
    );
  });

  it("runs the public stored-evidence recovery entry point without extraction or parsing", async () => {
    const sourceSpans = buildPageSourceSpans([{
      documentId: "stored-recovery",
      pageNumber: 42,
      text: "Carrier Special Benefit Each Claim $750,000",
    }]);
    const sourceTree = buildDocumentSourceTree(sourceSpans, "stored-recovery");
    const generateObject = vi.fn(async (params) => {
      if (params.prompt.startsWith("Discover every document region")) {
        return { object: { regions: [{ pageStart: 42, pageEnd: 42, reason: "benefit row" }], warnings: [] } };
      }
      return { object: {
        coverages: [{
          name: "Carrier Special Benefit",
          limits: [{
            kind: "each_claim_limit",
            label: "Each Claim",
            value: "$750,000",
            sourceNodeIds: [],
            sourceSpanIds: [sourceSpans[0]!.id],
          }],
          sourceNodeIds: [],
          sourceSpanIds: [sourceSpans[0]!.id],
        }],
      } };
    }) as GenerateObject;
    const result = await runCoverageRecovery({
      sourceTree,
      sourceSpans,
      operationalProfile: {
        documentType: "policy",
        linesOfBusiness: ["UN"],
        declarationFacts: [],
        coverages: [],
        parties: [],
        endorsementSupport: [],
        sourceNodeIds: [],
        sourceSpanIds: [],
        warnings: [],
      },
      generateObject,
    });
    expect(result.diagnostics.status).toBe("succeeded");
    expect(result.operationalProfile.coverages).toHaveLength(1);
    expect(result.performanceReport.modelCalls).toHaveLength(2);
  });
});
