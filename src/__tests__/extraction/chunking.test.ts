// src/__tests__/extraction/chunking.test.ts
import { describe, it, expect } from "vitest";
import { chunkDocument } from "../../extraction/chunking";
import type { PolicyDocument, QuoteDocument } from "../../schemas/document";

describe("chunkDocument", () => {
  const doc: PolicyDocument = {
    id: "pol-1",
    type: "policy",
    carrier: "Acme Insurance",
    insuredName: "Test Corp",
    policyNumber: "POL-001",
    effectiveDate: "01/01/2026",
    coverages: [
      {
        name: "General Liability",
        limit: "$1,000,000",
        limitValueType: "numeric",
        deductible: "Waiting Period - 24 Hours",
        deductibleValueType: "waiting_period",
        formNumber: "CG0001",
        pageNumber: 1,
        sectionRef: "Declarations",
        originalContent: "General Liability | $1,000,000 | Waiting Period - 24 Hours",
      },
      { name: "Property", limit: "$500,000" },
    ],
    endorsements: [
      {
        formNumber: "CG2010",
        title: "Additional Insured",
        endorsementType: "additional_insured",
        content: "Adds additional insured coverage.",
        pageStart: 10,
      },
    ],
    conditions: [
      {
        name: "Duties After Loss",
        conditionType: "duties_after_loss",
        content: "In the event of loss, you must notify us promptly.",
        pageNumber: 15,
      },
    ],
    locations: [
      {
        number: 1,
        address: { street1: "123 Main St", city: "Springfield", state: "IL", zip: "62701" },
        occupancy: "Office",
        constructionType: "Masonry",
        buildingValue: "$500,000",
      },
    ],
    vehicles: [
      {
        number: 1,
        year: 2024,
        make: "Ford",
        model: "F-150",
        vin: "1FTFW1E86NFA00001",
        costNew: "$45,000",
        coverages: [
          { type: "comprehensive", limit: "$45,000", deductible: "$500", included: true },
        ],
      },
    ],
    classifications: [
      {
        code: "8810",
        description: "Clerical Office",
        premiumBasis: "Payroll",
        basisAmount: "$250,000",
        rate: "0.25",
        premium: "$625",
      },
    ],
    lossSummary: {
      totalClaims: 3,
      totalIncurred: "$150,000",
      lossRatio: "45%",
    },
    individualClaims: [
      {
        dateOfLoss: "03/15/2024",
        claimNumber: "CLM-001",
        description: "Water damage in basement",
        status: "closed",
        paid: "$25,000",
      },
    ],
    additionalInsureds: [
      {
        name: "Landlord LLC",
        role: "additional_insured",
        address: { street1: "456 Oak Ave", city: "Springfield", state: "IL", zip: "62702" },
      },
    ],
    lossPayees: [
      {
        name: "First National Bank",
        role: "loss_payee",
        address: { street1: "789 Bank St", city: "Springfield", state: "IL", zip: "62703" },
      },
    ],
    taxesAndFees: [
      { name: "State Tax", amount: "$120", type: "tax" },
      { name: "Stamping Fee", amount: "$25", type: "fee" },
    ],
    supplementaryFacts: [
      { key: "policyholder_age", value: "42", subject: "Jane Doe", context: "Driver Schedule" },
    ],
  };

  it("creates carrier_info chunk", () => {
    const chunks = chunkDocument(doc);
    const carrier = chunks.find((c) => c.type === "carrier_info");
    expect(carrier).toBeDefined();
    expect(carrier!.text).toContain("Acme Insurance");
    expect(carrier!.id).toBe("pol-1:carrier_info:0");
  });

  it("creates one chunk per coverage", () => {
    const chunks = chunkDocument(doc);
    const coverages = chunks.filter((c) => c.type === "coverage");
    expect(coverages.length).toBe(2);
    expect(coverages[0].metadata.coverageName).toBe("General Liability");
    expect(coverages[0].metadata.formNumber).toBe("CG0001");
    expect(coverages[0].metadata.pageNumber).toBe("1");
    expect(coverages[0].metadata.sectionRef).toBe("Declarations");
    expect(coverages[0].metadata.deductibleValueType).toBe("waiting_period");
    expect(coverages[0].text).toContain("Source: General Liability | $1,000,000 | Waiting Period - 24 Hours");
  });

  it("creates endorsement chunks", () => {
    const chunks = chunkDocument(doc);
    const endorsements = chunks.filter((c) => c.type === "endorsement");
    expect(endorsements.length).toBe(1);
  });

  it("assigns deterministic IDs", () => {
    const chunks1 = chunkDocument(doc);
    const chunks2 = chunkDocument(doc);
    expect(chunks1.map((c) => c.id)).toEqual(chunks2.map((c) => c.id));
  });

  it("creates individual supplementary chunks for retrieval-only facts", () => {
    const chunks = chunkDocument(doc);
    const supplementary = chunks.filter((c) => c.type === "supplementary");
    expect(supplementary.length).toBe(1);
    expect(supplementary[0].text).toContain("policyholder_age: 42");
    expect(supplementary[0].text).toContain("Subject: Jane Doe");
    expect(supplementary[0].metadata.supplementaryCategory).toBe("auxiliary_fact");
    expect(supplementary[0].metadata.factKey).toBe("policyholder_age");
    expect(supplementary[0].metadata.factSubject).toBe("Jane Doe");
  });

  it("creates condition chunks", () => {
    const chunks = chunkDocument(doc);
    const conditions = chunks.filter((c) => c.type === "condition");
    expect(conditions.length).toBe(1);
    expect(conditions[0].text).toContain("Duties After Loss");
    expect(conditions[0].text).toContain("notify us promptly");
    expect(conditions[0].metadata.conditionType).toBe("duties_after_loss");
  });

  it("creates definition and covered reason chunks", () => {
    const docWithRetrievalFacts = {
      ...doc,
      definitions: [
        {
          term: "Covered Causes of Loss",
          definition: "Risks of direct physical loss unless excluded or limited.",
          formNumber: "CP1030",
          pageNumber: 21,
          sectionRef: "Definitions",
        },
      ],
      coveredReasons: [
        {
          coverageName: "Covered Causes of Loss",
          title: "Windstorm or Hail",
          reasonNumber: "2",
          content: "Windstorm or hail is a covered cause of loss subject to policy exclusions.",
          conditions: ["The loss must occur during the policy period."],
          formNumber: "CP1030",
          pageNumber: 8,
          sectionRef: "Covered Causes of Loss",
        },
      ],
    } as PolicyDocument & {
      definitions: Array<Record<string, unknown>>;
      coveredReasons: Array<Record<string, unknown>>;
    };

    const chunks = chunkDocument(docWithRetrievalFacts);
    const definitions = chunks.filter((c) => c.type === "definition");
    const coveredReasons = chunks.filter((c) => c.type === "covered_reason");

    expect(definitions).toHaveLength(1);
    expect(definitions[0].id).toBe("pol-1:definition:0");
    expect(definitions[0].text).toContain("Definition: Covered Causes of Loss");
    expect(definitions[0].metadata.term).toBe("Covered Causes of Loss");
    expect(definitions[0].metadata.pageNumber).toBe("21");

    expect(coveredReasons).toHaveLength(2);
    expect(coveredReasons[0].id).toBe("pol-1:covered_reason:0");
    expect(coveredReasons[0].text).toContain("Coverage: Covered Causes of Loss");
    expect(coveredReasons[0].text).toContain("Covered Reason: Windstorm or Hail");
    expect(coveredReasons[0].metadata.coverageName).toBe("Covered Causes of Loss");
    expect(coveredReasons[0].metadata.title).toBe("Windstorm or Hail");
    expect(coveredReasons[0].metadata.formNumber).toBe("CP1030");
    expect(coveredReasons[1].id).toBe("pol-1:covered_reason:0:condition:0");
    expect(coveredReasons[1].metadata.conditionIndex).toBe("0");
  });

  it("creates location chunks with property details", () => {
    const chunks = chunkDocument(doc);
    const locations = chunks.filter((c) => c.type === "location");
    expect(locations.length).toBe(1);
    expect(locations[0].text).toContain("123 Main St");
    expect(locations[0].text).toContain("Occupancy: Office");
    expect(locations[0].text).toContain("Building Value: $500,000");
    expect(locations[0].metadata.locationNumber).toBe("1");
  });

  it("creates vehicle chunks with coverage details", () => {
    const chunks = chunkDocument(doc);
    const vehicles = chunks.filter((c) => c.type === "vehicle");
    expect(vehicles.length).toBe(1);
    expect(vehicles[0].text).toContain("2024 Ford F-150");
    expect(vehicles[0].text).toContain("VIN: 1FTFW1E86NFA00001");
    expect(vehicles[0].text).toContain("comprehensive");
    expect(vehicles[0].metadata.vehicleMake).toBe("Ford");
  });

  it("creates classification chunks", () => {
    const chunks = chunkDocument(doc);
    const classifications = chunks.filter((c) => c.type === "classification");
    expect(classifications.length).toBe(1);
    expect(classifications[0].text).toContain("8810");
    expect(classifications[0].text).toContain("Clerical Office");
    expect(classifications[0].text).toContain("Premium: $625");
  });

  it("creates loss history chunks", () => {
    const chunks = chunkDocument(doc);
    const lossHistory = chunks.filter((c) => c.type === "loss_history");
    expect(lossHistory.length).toBe(2); // summary + 1 claim
    const summary = lossHistory.find((c) => c.id.includes("summary"));
    expect(summary!.text).toContain("Total Claims: 3");
    expect(summary!.text).toContain("Loss Ratio: 45%");
    const claim = lossHistory.find((c) => c.id.includes("claim"));
    expect(claim!.text).toContain("Water damage");
    expect(claim!.metadata.claimNumber).toBe("CLM-001");
  });

  it("creates party chunks for additional insureds and loss payees", () => {
    const chunks = chunkDocument(doc);
    const parties = chunks.filter((c) => c.type === "party");
    const ai = parties.find((c) => c.metadata.partyRole === "additional_insured");
    expect(ai).toBeDefined();
    expect(ai!.text).toContain("Landlord LLC");
    const lp = parties.find((c) => c.metadata.partyRole === "loss_payee");
    expect(lp).toBeDefined();
    expect(lp!.text).toContain("First National Bank");
  });

  it("creates financial chunks for taxes and fees", () => {
    const chunks = chunkDocument(doc);
    const financial = chunks.filter((c) => c.type === "financial");
    const taxFee = financial.find((c) => c.metadata.financialCategory === "taxes_fees");
    expect(taxFee).toBeDefined();
    expect(taxFee!.text).toContain("State Tax: $120");
    expect(taxFee!.text).toContain("Stamping Fee: $25");
  });

  it("splits large sections into smaller chunks", () => {
    const longContent = Array.from({ length: 30 }, (_, i) =>
      `Paragraph ${i + 1}: This is a substantial paragraph of policy content that contains important information about the terms and conditions.`,
    ).join("\n\n");

    const docWithLongSection: PolicyDocument = {
      ...doc,
      sections: [
        { title: "General Conditions", type: "conditions", pageStart: 5, content: longContent },
      ],
    };

    const chunks = chunkDocument(docWithLongSection);
    const sectionChunks = chunks.filter((c) => c.type === "section");
    expect(sectionChunks.length).toBeGreaterThan(1);
    expect(sectionChunks[0].text).toContain("General Conditions (part 1)");
    expect(sectionChunks[0].id).toContain(":part:");
  });

  it("splits sections with subsections into individual chunks", () => {
    const docWithSubsections: PolicyDocument = {
      ...doc,
      sections: [
        {
          title: "Property Coverage",
          type: "coverage",
          pageStart: 3,
          content: "This section covers property damage.",
          subsections: [
            { title: "Covered Property", content: "We cover building and contents." },
            { title: "Property Not Covered", content: "We do not cover land or water." },
          ],
        },
      ],
    };

    const chunks = chunkDocument(docWithSubsections);
    const sectionChunks = chunks.filter((c) => c.type === "section");
    expect(sectionChunks.length).toBe(3); // parent + 2 subsections
    expect(sectionChunks[1].text).toContain("Property Coverage > Covered Property");
    expect(sectionChunks[2].text).toContain("Property Coverage > Property Not Covered");
    expect(sectionChunks[1].metadata.parentSection).toBe("Property Coverage");
  });

  it("creates quote-specific chunks", () => {
    const quoteDoc: QuoteDocument = {
      id: "q-1",
      type: "quote",
      carrier: "Acme Insurance",
      insuredName: "Test Corp",
      quoteNumber: "Q-001",
      coverages: [{ name: "GL", limit: "$1M" }],
      subjectivities: [
        { description: "Provide loss runs for 5 years", category: "documentation" },
      ],
      underwritingConditions: [
        { description: "Must maintain sprinkler system" },
      ],
      premiumBreakdown: [
        { line: "General Liability", amount: "$5,000" },
        { line: "Property", amount: "$3,000" },
      ],
    };

    const chunks = chunkDocument(quoteDoc);
    const subjectivities = chunks.filter((c) => c.type === "subjectivity");
    expect(subjectivities.length).toBe(1);
    expect(subjectivities[0].text).toContain("loss runs");

    const uwConditions = chunks.filter((c) => c.type === "underwriting_condition");
    expect(uwConditions.length).toBe(1);
    expect(uwConditions[0].text).toContain("sprinkler system");

    const financial = chunks.filter((c) => c.type === "financial");
    const breakdown = financial.find((c) => c.metadata.financialCategory === "premium_breakdown");
    expect(breakdown).toBeDefined();
    expect(breakdown!.text).toContain("General Liability: $5,000");
  });
});
