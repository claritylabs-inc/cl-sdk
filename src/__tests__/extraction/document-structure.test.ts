import { describe, expect, it } from "vitest";
import type { InsuranceDocument } from "../../schemas/document";
import type { SourceSpan } from "../../source";
import { attachDocumentStructure } from "../../extraction/document-structure";

describe("document structure assembly", () => {
  it("builds metadata and outline from source-backed sections", () => {
    const document: InsuranceDocument = {
      id: "pol-1",
      type: "policy",
      carrier: "Acme",
      insuredName: "Test Corp",
      policyNumber: "P-1",
      effectiveDate: "01/01/2026",
      documentMetadata: {},
      documentOutline: [],
      coverages: [
        {
          name: "Errors and Omissions",
          limit: "$1,000,000",
          pageNumber: 2,
          sourceSpanIds: ["row-coverage"],
        },
      ],
      sections: [
        {
          title: "Declarations",
          type: "declarations",
          pageStart: 1,
          pageEnd: 2,
          sourceSpanIds: ["page-1", "row-coverage"],
        },
      ],
      formInventory: [
        {
          formNumber: "DEC",
          title: "Declarations",
          formType: "declarations",
          pageStart: 1,
          pageEnd: 2,
        },
      ],
    } as InsuranceDocument;

    attachDocumentStructure({
      document,
      pageAssignments: [
        {
          localPageNumber: 1,
          extractorNames: ["carrier_info", "declarations"],
          confidence: 1,
          notes: "Declarations",
        },
      ],
      sourceSpans: [
        {
          id: "page-1",
          documentId: "pol-1",
          kind: "pdf_text",
          sourceKind: "policy_pdf",
          sourceUnit: "page",
          text: "Declarations",
          hash: "hash-page-1",
          textHash: "hash-page-1",
          pageStart: 1,
          pageEnd: 1,
        },
      ] satisfies SourceSpan[],
    });

    expect(document.documentOutline?.[0]?.title).toBe("Declarations");
    expect(document.documentMetadata?.tableOfContents?.[0]?.documentNodeId).toBe(
      document.documentOutline?.[0]?.id,
    );
    expect(document.documentMetadata?.pageMap?.[0]?.sourceSpanIds).toEqual(["page-1"]);
    expect(document.coverages[0]?.documentNodeId).toBe(document.documentOutline?.[0]?.id);
    expect(document.documentMetadata?.agentGuidance?.some((item) => item.kind === "source_structure")).toBe(true);
  });

  it("falls back to source spans when section extraction is absent", () => {
    const document: InsuranceDocument = {
      id: "pol-2",
      type: "policy",
      carrier: "Acme",
      insuredName: "Test Corp",
      policyNumber: "P-2",
      effectiveDate: "01/01/2026",
      documentMetadata: {},
      documentOutline: [],
      coverages: [],
    };

    attachDocumentStructure({
      document,
      pageAssignments: [],
      sourceSpans: [
        {
          id: "span-section",
          documentId: "pol-2",
          kind: "pdf_text",
          sourceKind: "policy_pdf",
          sourceUnit: "section",
          sectionId: "Policy Conditions",
          text: "Policy Conditions",
          hash: "hash-section",
          textHash: "hash-section",
          pageStart: 5,
          pageEnd: 6,
        },
      ] satisfies SourceSpan[],
    });

    expect(document.documentOutline?.[0]).toMatchObject({
      title: "Policy Conditions",
      pageStart: 5,
      pageEnd: 6,
      sourceSpanIds: ["span-section"],
    });
  });
});
