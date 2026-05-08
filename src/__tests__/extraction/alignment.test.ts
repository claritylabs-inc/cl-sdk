import { describe, expect, it } from "vitest";
import { alignExtractionRecords } from "../../extraction/alignment";

describe("extraction record alignment", () => {
  it("assigns stable record IDs from label and source evidence", () => {
    const first = alignExtractionRecords(
      "doc-1",
      "coverage",
      [
        { name: "Business Personal Property", limit: "$250,000", sourceSpanIds: ["doc-1:span:3:0:aaaa"] },
      ],
      (coverage) => [coverage.name, coverage.limit],
    );
    const second = alignExtractionRecords(
      "doc-1",
      "coverage",
      [
        { name: "Business Personal Property", limit: "$250,000", sourceSpanIds: ["doc-1:span:3:0:aaaa"] },
      ],
      (coverage) => [coverage.name, coverage.limit],
    );

    expect(first[0].recordId).toBe(second[0].recordId);
    expect(first[0].recordId).toMatch(/^coverage:doc_1:business_personal_property:250_000:/);
  });

  it("sorts by stable record ID instead of incoming array order", () => {
    const records = alignExtractionRecords(
      "doc-1",
      "exclusion",
      [
        { name: "Water", pageNumber: 12 },
        { name: "Earth Movement", pageNumber: 9 },
      ],
      (exclusion) => [exclusion.name, exclusion.pageNumber],
    );

    expect(records.map((record) => record.name)).toEqual(["Earth Movement", "Water"]);
  });
});
