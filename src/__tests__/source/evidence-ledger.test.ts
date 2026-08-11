import { describe, expect, it } from "vitest";
import {
  buildDocumentSourceTree,
  buildExtractionEvidenceLedger,
  buildExtractionSourceCoverageMap,
  buildSourceSpan,
} from "../../source";

function spans(texts: readonly string[]) {
  return texts.map((text, index) => buildSourceSpan({
    documentId: "policy-1",
    sourceKind: "policy_pdf",
    text,
    pageStart: index + 1,
    pageEnd: index + 1,
    sourceUnit: "text",
  }, index));
}

describe("extraction evidence ledger", () => {
  it("detects cited critical facts and coverage regions from source evidence only", () => {
    const sourceSpans = spans([
      "Policy Number: GL-100",
      "Named Insured: Example Holdings LLC",
      "Insurer: Example Insurance Company",
      "Effective Date: 01/01/2026",
      "Expiration Date: 01/01/2027",
      "Commercial General Liability Coverage — Each Occurrence Limit $1,000,000",
    ]);
    const sourceTree = buildDocumentSourceTree(sourceSpans, "policy-1");

    const ledger = buildExtractionEvidenceLedger(sourceSpans, sourceTree);

    expect(ledger.completeSourceCoverage).toBe(true);
    expect(ledger.fields.policy_number.candidates[0]).toMatchObject({
      value: "GL-100",
      sourceSpanIds: [sourceSpans[0]!.id],
    });
    expect(ledger.fields.named_insured.status).toBe("observed");
    expect(ledger.fields.carrier.status).toBe("observed");
    expect(ledger.fields.effective_date.status).toBe("observed");
    expect(ledger.fields.expiration_date.status).toBe("observed");
    expect(ledger.coverageRegions.status).toBe("observed");
    expect(ledger.coverageRegions.candidates[0]!.sourceNodeIds.length).toBeGreaterThan(0);
  });

  it("is unchanged by model output", () => {
    const sourceSpans = spans(["Policy Number: GL-100"]);
    const sourceTree = buildDocumentSourceTree(sourceSpans, "policy-1");
    const before = buildExtractionEvidenceLedger(sourceSpans, sourceTree);

    const modelOutput = {
      policyNumber: { value: "MODEL-INVENTED", sourceSpanIds: [] },
      coverages: [],
      observation: "not_observed",
    };
    modelOutput.policyNumber.value = "ANOTHER-INVENTION";
    const after = buildExtractionEvidenceLedger(sourceSpans, sourceTree);

    expect(after).toEqual(before);
  });

  it("marks distinct cited candidates as ambiguous", () => {
    const sourceSpans = spans([
      "Policy Number: GL-100",
      "Policy Number: GL-200",
    ]);
    const ledger = buildExtractionEvidenceLedger(
      sourceSpans,
      buildDocumentSourceTree(sourceSpans, "policy-1"),
    );

    expect(ledger.fields.policy_number.ambiguous).toBe(true);
    expect(ledger.ambiguous).toBe(true);
  });

  it("reads adjacent table labels in numeric column order", () => {
    const label = buildSourceSpan({
      documentId: "policy-table",
      sourceKind: "policy_pdf",
      text: "Policy Number",
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "table_cell",
      table: {
        tableId: "declarations",
        rowIndex: 0,
        columnIndex: 0,
        rowSpanId: "declarations-row-0",
      },
    }, 9);
    const value = buildSourceSpan({
      documentId: "policy-table",
      sourceKind: "policy_pdf",
      text: "GL-900",
      pageStart: 1,
      pageEnd: 1,
      sourceUnit: "table_cell",
      table: {
        tableId: "declarations",
        rowIndex: 0,
        columnIndex: 1,
        rowSpanId: "declarations-row-0",
      },
    }, 10);
    const ledger = buildExtractionEvidenceLedger(
      [label, value],
      buildDocumentSourceTree([label, value], "policy-table"),
    );

    expect(ledger.fields.policy_number.candidates[0]).toMatchObject({
      value: "GL-900",
      sourceSpanIds: expect.arrayContaining([label.id, value.id]),
    });
  });
});

describe("extraction source coverage map", () => {
  it("assigns every nonempty span and includes party-changing endorsements in both shards", () => {
    const sourceSpans = spans([
      "Policy Number: GL-100",
      "Coverage Limit of Liability $1,000,000",
      "This endorsement changes the Named Insured and coverage afforded by the policy.",
      "Unclassified policy wording retained for review.",
    ]);
    const sourceTree = buildDocumentSourceTree(sourceSpans, "policy-1").map((node) =>
      node.sourceSpanIds.length === 1 && node.sourceSpanIds.includes(sourceSpans[2]!.id)
        ? { ...node, kind: "endorsement" as const, title: "Named insured endorsement" }
        : node);

    const coverage = buildExtractionSourceCoverageMap(sourceSpans, sourceTree);

    expect(coverage.complete).toBe(true);
    expect(coverage.entries).toHaveLength(sourceSpans.length);
    expect(new Set(coverage.entries.map((entry) => entry.sourceSpanId))).toEqual(
      new Set(sourceSpans.map((span) => span.id)),
    );
    expect(coverage.entries.find((entry) => entry.sourceSpanId === sourceSpans[2]!.id)?.assignment)
      .toBe("both");
    expect(coverage.shards.catchAll).toContain(sourceSpans[3]!.id);
  });

  it("keeps unlabeled values inside their source-tree coverage section", () => {
    const sourceSpans = spans(["Each Occurrence — $1,000,000"]);
    const sourceTree = buildDocumentSourceTree(sourceSpans, "policy-1").map((node) =>
      node.sourceSpanIds.includes(sourceSpans[0]!.id)
        ? { ...node, title: "Coverage Schedule" }
        : node);

    const coverage = buildExtractionSourceCoverageMap(sourceSpans, sourceTree);

    expect(coverage.entries).toEqual([{
      sourceSpanId: sourceSpans[0]!.id,
      assignment: "coverage",
    }]);
  });
});
