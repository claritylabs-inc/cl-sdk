import { describe, expect, it } from "vitest";

import {
  getDoclingPageRangeText,
  mergeSourceSpans,
  normalizeDoclingDocument,
  type DoclingDocumentLike,
} from "../../extraction/docling";

describe("Docling normalization", () => {
  it("normalizes body reading order into page text and source spans", () => {
    const doclingDocument: DoclingDocumentLike = {
      body: {
        children: [
          { $ref: "#/texts/0" },
          { $ref: "#/tables/0" },
        ],
      },
      texts: [
        {
          self_ref: "#/texts/0",
          label: "section_header",
          text: "Commercial Property Declarations",
          prov: [{ page_no: 1, bbox: { l: 10, t: 20, r: 210, b: 40 } }],
          children: [{ $ref: "#/texts/1" }],
        },
        {
          self_ref: "#/texts/1",
          label: "paragraph",
          text: "Building limit $1,000,000",
          prov: [{ page_no: 2 }],
        },
      ],
      tables: [
        {
          self_ref: "#/tables/0",
          label: "table",
          prov: [{ page_no: 2 }],
          data: {
            table_cells: [
              { start_row_offset: 0, start_col_offset: 0, text: "Coverage" },
              { start_row_offset: 0, start_col_offset: 1, text: "Limit" },
              { start_row_offset: 1, start_col_offset: 0, text: "Building" },
              { start_row_offset: 1, start_col_offset: 1, text: "$1,000,000" },
            ],
          },
        },
      ],
      pages: { "1": {}, "2": {} },
    };

    const normalized = normalizeDoclingDocument(doclingDocument, {
      documentId: "doc-1",
      sourceKind: "policy_pdf",
    });

    expect(normalized.pageCount).toBe(2);
    expect(normalized.fullText).toContain("Page 1\nCommercial Property Declarations");
    expect(normalized.fullText).toContain("Building limit $1,000,000");
    expect(normalized.fullText).toContain("| Coverage | Limit |");
    expect(getDoclingPageRangeText(normalized, 2, 2)).not.toContain("Page 1");
    expect(getDoclingPageRangeText(normalized, 2, 2)).toContain("Building limit $1,000,000");
    expect(normalized.sourceSpans).toHaveLength(3);
    expect(normalized.sourceSpans[0]).toEqual(expect.objectContaining({
      documentId: "doc-1",
      kind: "plain_text",
      pageStart: 1,
      pageEnd: 1,
      sectionId: "section_header",
      metadata: expect.objectContaining({
        sourceSystem: "docling",
        doclingRef: "#/texts/0",
      }),
      bbox: [{ page: 1, x: 10, y: 20, width: 200, height: 20 }],
    }));
  });

  it("merges duplicate source spans by page and normalized text hash", () => {
    const normalized = normalizeDoclingDocument({
      texts: [
        { text: "Same text", prov: [{ page_no: 1 }] },
        { text: "Same   text", prov: [{ page_no: 1 }] },
      ],
    }, { documentId: "doc-1" });

    expect(mergeSourceSpans(normalized.sourceSpans)).toHaveLength(1);
  });
});
