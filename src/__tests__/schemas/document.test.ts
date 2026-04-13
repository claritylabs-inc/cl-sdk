import { describe, it, expect } from "vitest";
import { PolicyDocumentSchema, QuoteDocumentSchema, InsuranceDocumentSchema } from "../../schemas/document";

describe("document schemas", () => {
  const minimalPolicy = {
    id: "pol-1",
    type: "policy" as const,
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [],
  };

  it("validates a minimal policy", () => {
    expect(PolicyDocumentSchema.parse(minimalPolicy)).toMatchObject({ id: "pol-1", type: "policy" });
  });

  it("validates via discriminated union", () => {
    expect(InsuranceDocumentSchema.parse(minimalPolicy)).toMatchObject({ type: "policy" });
  });

  const minimalQuote = {
    id: "q-1",
    type: "quote" as const,
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    quoteNumber: "Q-001",
    coverages: [],
  };

  it("validates a minimal quote", () => {
    expect(QuoteDocumentSchema.parse(minimalQuote)).toMatchObject({ id: "q-1", type: "quote" });
  });

  it("rejects missing required fields", () => {
    expect(() => PolicyDocumentSchema.parse({ id: "pol-2", type: "policy" })).toThrow();
  });

  it("accepts policy with optional enriched fields", () => {
    const enrichedPolicy = {
      ...minimalPolicy,
      carrierLegalName: "Acme Insurance Co.",
      carrierNaicNumber: "12345",
      isRenewal: true,
      insuredAddress: {
        street1: "123 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62701",
      },
      cancellationNoticeDays: 30,
      supplementaryFacts: [
        { key: "policyholder_age", value: "42", subject: "Jane Doe", context: "Driver Schedule" },
      ],
    };
    const result = PolicyDocumentSchema.parse(enrichedPolicy);
    expect(result.carrierLegalName).toBe("Acme Insurance Co.");
    expect(result.cancellationNoticeDays).toBe(30);
    expect(result.supplementaryFacts).toHaveLength(1);
  });

  it("accepts quote with enriched fields", () => {
    const enrichedQuote = {
      ...minimalQuote,
      subjectivities: [{ description: "Provide loss runs" }],
      underwritingConditions: [{ description: "Subject to inspection" }],
      premiumBreakdown: [{ line: "GL", amount: "$5,000" }],
      warrantyRequirements: ["Maintain fire alarm"],
      lossControlRecommendations: ["Install sprinklers"],
    };
    const result = QuoteDocumentSchema.parse(enrichedQuote);
    expect(result.subjectivities).toHaveLength(1);
    expect(result.premiumBreakdown).toHaveLength(1);
  });
});
