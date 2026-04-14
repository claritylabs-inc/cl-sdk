import { describe, it, expect } from "vitest";
import type { InsuranceDocument } from "../schemas/document";
import {
  promoteCarrierFields,
  promoteBroker,
  promoteLossPayees,
  promoteLocations,
  synthesizeLimits,
  synthesizeDeductibles,
  promotePremium,
  promoteExtractedFields,
} from "./promote";

/** Helper to create a minimal policy document for testing. */
function makeDoc(overrides: Record<string, unknown> = {}): InsuranceDocument {
  return {
    id: "test-1",
    type: "policy",
    carrier: "Test Carrier",
    insuredName: "Test Insured",
    coverages: [],
    policyNumber: "POL-001",
    effectiveDate: "01/01/2025",
    ...overrides,
  } as InsuranceDocument;
}

// ── promoteCarrierFields ──

describe("promoteCarrierFields", () => {
  it("maps naicNumber → carrierNaicNumber", () => {
    const doc = makeDoc({ naicNumber: "12345" });
    promoteCarrierFields(doc);
    expect((doc as any).carrierNaicNumber).toBe("12345");
    expect((doc as any).naicNumber).toBeUndefined();
  });

  it("maps amBestRating → carrierAmBestRating", () => {
    const doc = makeDoc({ amBestRating: "A+ XV" });
    promoteCarrierFields(doc);
    expect((doc as any).carrierAmBestRating).toBe("A+ XV");
    expect((doc as any).amBestRating).toBeUndefined();
  });

  it("maps admittedStatus → carrierAdmittedStatus", () => {
    const doc = makeDoc({ admittedStatus: "admitted" });
    promoteCarrierFields(doc);
    expect((doc as any).carrierAdmittedStatus).toBe("admitted");
    expect((doc as any).admittedStatus).toBeUndefined();
  });

  it("does not overwrite existing canonical fields", () => {
    const doc = makeDoc({ carrierNaicNumber: "existing", naicNumber: "new" });
    promoteCarrierFields(doc);
    expect((doc as any).carrierNaicNumber).toBe("existing");
  });

  it("builds insurer sub-object from carrier fields", () => {
    const doc = makeDoc({
      carrierLegalName: "Test Carrier Inc.",
      naicNumber: "12345",
      amBestRating: "A+",
      admittedStatus: "admitted",
    });
    promoteCarrierFields(doc);
    expect((doc as any).insurer).toEqual({
      legalName: "Test Carrier Inc.",
      naicNumber: "12345",
      amBestRating: "A+",
      admittedStatus: "admitted",
    });
  });
});

// ── promoteBroker ──

describe("promoteBroker", () => {
  it("promotes broker from declarations fields", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "brokerName", value: "ABC Agency", section: "Producer" },
          { field: "brokerPhone", value: "555-1234", section: "Producer" },
          { field: "brokerLicenseNumber", value: "LIC-789", section: "Producer" },
        ],
      },
    });
    promoteBroker(doc);
    expect((doc as any).brokerAgency).toBe("ABC Agency");
    expect((doc as any).brokerLicenseNumber).toBe("LIC-789");
    expect((doc as any).producer).toEqual({
      agencyName: "ABC Agency",
      licenseNumber: "LIC-789",
      phone: "555-1234",
    });
  });

  it("uses carrier-extracted broker fields over declarations", () => {
    const doc = makeDoc({
      brokerAgency: "From Carrier",
      declarations: {
        fields: [
          { field: "brokerName", value: "From Declarations" },
        ],
      },
    });
    promoteBroker(doc);
    expect((doc as any).brokerAgency).toBe("From Carrier");
  });

  it("does not create producer if no broker data", () => {
    const doc = makeDoc({ declarations: { fields: [] } });
    promoteBroker(doc);
    expect((doc as any).producer).toBeUndefined();
  });

  it("matches agentName and producerName patterns", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "agentName", value: "Agent Smith Agency" },
        ],
      },
    });
    promoteBroker(doc);
    expect((doc as any).brokerAgency).toBe("Agent Smith Agency");
  });
});

// ── promoteLossPayees ──

describe("promoteLossPayees", () => {
  it("promotes loss payee from declarations", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "lossPayeeName", value: "BMO Bank of Montreal" },
          { field: "lossPayeeAddress", value: "100 King St, Toronto" },
        ],
      },
    });
    promoteLossPayees(doc);
    expect((doc as any).lossPayees).toEqual([{
      name: "BMO Bank of Montreal",
      role: "loss_payee",
      address: { street1: "100 King St, Toronto" },
    }]);
  });

  it("promotes mortgage holder from declarations", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "mortgagee", value: "First National Bank" },
        ],
      },
    });
    promoteLossPayees(doc);
    expect((doc as any).mortgageHolders).toEqual([{
      name: "First National Bank",
      role: "mortgage_holder",
    }]);
  });

  it("does not overwrite existing lossPayees", () => {
    const doc = makeDoc({
      lossPayees: [{ name: "Existing", role: "loss_payee" }],
      declarations: {
        fields: [
          { field: "lossPayeeName", value: "New" },
        ],
      },
    });
    promoteLossPayees(doc);
    expect((doc as any).lossPayees).toEqual([{ name: "Existing", role: "loss_payee" }]);
  });
});

// ── promoteLocations ──

describe("promoteLocations", () => {
  it("promotes location from declarations fields", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "locationNumber", value: "001", section: "Location Schedule" },
          { field: "construction", value: "Masonry Non-Combustible", section: "Location Schedule" },
          { field: "occupancy", value: "Office", section: "Location Schedule" },
          { field: "industryAddress", value: "3525 Platinum Dr, Suite 100", section: "Location Schedule" },
          { field: "buildingValue", value: "$500,000", section: "Location Schedule" },
        ],
      },
    });
    promoteLocations(doc);
    expect((doc as any).locations).toHaveLength(1);
    const loc = (doc as any).locations[0];
    expect(loc.number).toBe(1);
    expect(loc.constructionType).toBe("Masonry Non-Combustible");
    expect(loc.occupancy).toBe("Office");
    expect(loc.address.street1).toBe("3525 Platinum Dr, Suite 100");
    expect(loc.buildingValue).toBe("$500,000");
  });

  it("does not overwrite existing locations", () => {
    const doc = makeDoc({
      locations: [{ number: 1, address: { street1: "Existing" } }],
      declarations: {
        fields: [
          { field: "locationNumber", value: "001", section: "Location Schedule" },
        ],
      },
    });
    promoteLocations(doc);
    expect((doc as any).locations).toHaveLength(1);
    expect((doc as any).locations[0].address.street1).toBe("Existing");
  });

  it("handles no location data gracefully", () => {
    const doc = makeDoc({ declarations: { fields: [] } });
    promoteLocations(doc);
    expect((doc as any).locations).toBeUndefined();
  });
});

// ── synthesizeLimits ──

describe("synthesizeLimits", () => {
  it("synthesizes GL limits from coverages", () => {
    const doc = makeDoc({
      coverages: [
        { name: "Each Occurrence", limit: "$1,000,000", limitType: "per_occurrence" },
        { name: "General Aggregate", limit: "$2,000,000", limitType: "aggregate" },
        { name: "Products/Completed Operations Aggregate", limit: "$2,000,000", limitType: "aggregate" },
        { name: "Personal & Advertising Injury", limit: "$1,000,000" },
        { name: "Fire Damage", limit: "$100,000" },
        { name: "Medical Expense", limit: "$5,000" },
      ],
    });
    synthesizeLimits(doc);
    expect((doc as any).limits).toEqual({
      perOccurrence: "$1,000,000",
      generalAggregate: "$2,000,000",
      productsCompletedOpsAggregate: "$2,000,000",
      personalAdvertisingInjury: "$1,000,000",
      fireDamage: "$100,000",
      medicalExpense: "$5,000",
    });
  });

  it("does not overwrite existing limits", () => {
    const doc = makeDoc({
      limits: { perOccurrence: "$500,000" },
      coverages: [
        { name: "Each Occurrence", limit: "$1,000,000" },
      ],
    });
    synthesizeLimits(doc);
    expect((doc as any).limits.perOccurrence).toBe("$500,000");
  });

  it("handles empty coverages", () => {
    const doc = makeDoc({ coverages: [] });
    synthesizeLimits(doc);
    expect((doc as any).limits).toBeUndefined();
  });
});

// ── synthesizeDeductibles ──

describe("synthesizeDeductibles", () => {
  it("finds most common deductible as perOccurrence", () => {
    const doc = makeDoc({
      coverages: [
        { name: "Coverage A", limit: "$100,000", deductible: "$2,500" },
        { name: "Coverage B", limit: "$100,000", deductible: "$2,500" },
        { name: "Coverage C", limit: "$50,000", deductible: "$5,000" },
        { name: "Coverage D", limit: "$50,000", deductible: "$2,500" },
      ],
    });
    synthesizeDeductibles(doc);
    expect((doc as any).deductibles).toEqual({ perOccurrence: "$2,500" });
  });

  it("ignores N/A and None deductibles", () => {
    const doc = makeDoc({
      coverages: [
        { name: "Coverage A", limit: "$100,000", deductible: "N/A" },
        { name: "Coverage B", limit: "$100,000", deductible: "$1,000" },
      ],
    });
    synthesizeDeductibles(doc);
    expect((doc as any).deductibles).toEqual({ perOccurrence: "$1,000" });
  });

  it("does not overwrite existing deductibles", () => {
    const doc = makeDoc({
      deductibles: { perOccurrence: "$500" },
      coverages: [{ name: "A", limit: "$1", deductible: "$2,500" }],
    });
    synthesizeDeductibles(doc);
    expect((doc as any).deductibles.perOccurrence).toBe("$500");
  });
});

// ── promotePremium ──

describe("promotePremium", () => {
  it("promotes premium from declarations", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "totalPremium", value: "$12,500" },
        ],
      },
    });
    promotePremium(doc);
    expect((doc as any).premium).toBe("$12,500");
  });

  it("does not overwrite existing premium", () => {
    const doc = makeDoc({
      premium: "$10,000",
      declarations: {
        fields: [
          { field: "premium", value: "$12,500" },
        ],
      },
    });
    promotePremium(doc);
    expect((doc as any).premium).toBe("$10,000");
  });

  it("strips negative sign from premium", () => {
    const doc = makeDoc({ premium: "-$535" });
    promotePremium(doc);
    expect((doc as any).premium).toBe("$535");
  });

  it("strips negative sign from totalCost", () => {
    const doc = makeDoc({ totalCost: "-$1,200" });
    promotePremium(doc);
    expect((doc as any).totalCost).toBe("$1,200");
  });

  it("strips parenthesized negatives from premium", () => {
    const doc = makeDoc({ premium: "($535)" });
    promotePremium(doc);
    expect((doc as any).premium).toBe("$535");
  });
});

// ── Full pipeline ──

describe("promoteExtractedFields (integration)", () => {
  it("runs all promotions on a realistic document", () => {
    const doc = makeDoc({
      naicNumber: "12345",
      amBestRating: "A+ XV",
      admittedStatus: "surplus_lines",
      carrierLegalName: "Test Carrier Underwriters",
      coverages: [
        { name: "Each Occurrence", limit: "$1,000,000", deductible: "$2,500" },
        { name: "General Aggregate", limit: "$2,000,000", deductible: "$2,500" },
        { name: "Fire Damage", limit: "$100,000", deductible: "$2,500" },
      ],
      declarations: {
        fields: [
          { field: "brokerName", value: "Smith Insurance Agency", section: "Producer" },
          { field: "brokerPhone", value: "555-0100", section: "Producer" },
          { field: "lossPayeeName", value: "BMO Bank of Montreal" },
          { field: "lossPayeeAddress", value: "100 King St W, Toronto, ON" },
          { field: "locationNumber", value: "001", section: "Location Schedule" },
          { field: "locationAddress", value: "3525 Platinum Dr", section: "Location Schedule" },
          { field: "construction", value: "Frame", section: "Location Schedule" },
          { field: "totalPremium", value: "$8,750" },
        ],
      },
    });

    promoteExtractedFields(doc);

    // Carrier field mapping
    expect((doc as any).carrierNaicNumber).toBe("12345");
    expect((doc as any).carrierAmBestRating).toBe("A+ XV");
    expect((doc as any).carrierAdmittedStatus).toBe("surplus_lines");
    expect((doc as any).naicNumber).toBeUndefined();

    // Insurer sub-object
    expect((doc as any).insurer.legalName).toBe("Test Carrier Underwriters");

    // Broker
    expect((doc as any).brokerAgency).toBe("Smith Insurance Agency");
    expect((doc as any).producer.agencyName).toBe("Smith Insurance Agency");
    expect((doc as any).producer.phone).toBe("555-0100");

    // Loss payees
    expect((doc as any).lossPayees).toHaveLength(1);
    expect((doc as any).lossPayees[0].name).toBe("BMO Bank of Montreal");

    // Locations
    expect((doc as any).locations).toHaveLength(1);
    expect((doc as any).locations[0].constructionType).toBe("Frame");

    // Limits
    expect((doc as any).limits.perOccurrence).toBe("$1,000,000");
    expect((doc as any).limits.generalAggregate).toBe("$2,000,000");

    // Deductibles
    expect((doc as any).deductibles.perOccurrence).toBe("$2,500");

    // Premium
    expect((doc as any).premium).toBe("$8,750");
  });
});
