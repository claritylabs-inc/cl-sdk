import { describe, it, expect } from "vitest";
import { buildApplicationQualityReport, reviewBatchEmail } from "../../application/quality";

describe("application quality", () => {
  it("fails when a filled field is missing source provenance", () => {
    const report = buildApplicationQualityReport({
      id: "app-1",
      applicationType: "general_liability",
      fields: [
        {
          id: "fein",
          label: "FEIN",
          section: "Business Info",
          fieldType: "text",
          required: true,
          value: "12-3456789",
          confidence: "high",
        },
      ],
      currentBatchIndex: 0,
      status: "collecting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues.some((issue) => issue.code === "filled_field_missing_source")).toBe(true);
  });

  it("warns when a batch email omits a field label", () => {
    const review = reviewBatchEmail("Please confirm your mailing address.", [
      {
        id: "fein",
        label: "Federal Employer Identification Number",
        section: "Business Info",
        fieldType: "text",
        required: true,
      },
    ]);

    expect(review.qualityGateStatus).toBe("warning");
    expect(review.issues.some((issue) => issue.code === "email_missing_field_prompt")).toBe(true);
  });

  it("blocks policy-derived high-value fields without source spans", () => {
    const report = buildApplicationQualityReport({
      id: "app-1",
      applicationType: "general_liability",
      fields: [
        {
          id: "limit",
          label: "General Liability Limit",
          section: "Prior Coverage",
          fieldType: "currency",
          required: true,
          value: "$1,000,000",
          source: "lookup: GL Policy #POL-123",
          confidence: "high",
        },
      ],
      currentBatchIndex: 0,
      status: "collecting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(report.qualityGateStatus).toBe("failed");
    expect(report.issues.some((issue) => issue.code === "policy_value_missing_source_span")).toBe(true);
  });

  it("accepts policy-derived high-value fields with source spans", () => {
    const report = buildApplicationQualityReport({
      id: "app-1",
      applicationType: "general_liability",
      fields: [
        {
          id: "limit",
          label: "General Liability Limit",
          section: "Prior Coverage",
          fieldType: "currency",
          required: true,
          value: "$1,000,000",
          source: "lookup: GL Policy #POL-123",
          sourceSpanIds: ["doc-1:span:1:0:abcd1234"],
          confidence: "high",
        },
      ],
      currentBatchIndex: 0,
      status: "collecting",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(report.issues.some((issue) => issue.code === "policy_value_missing_source_span")).toBe(false);
  });
});
