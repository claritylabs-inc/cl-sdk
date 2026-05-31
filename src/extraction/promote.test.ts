import { describe, it, expect } from "vitest";
import type { InsuranceDocument } from "../schemas/document";
import {
  promoteCarrierFields,
  promoteBroker,
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
    documentMetadata: {},
    documentOutline: [],
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
  it("builds producer from model-extracted broker fields", () => {
    const doc = makeDoc({
      brokerAgency: "ABC Agency",
      brokerPhone: "555-1234",
      brokerLicenseNumber: "LIC-789",
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

  it("does not infer broker fields from generic declaration rows", () => {
    const doc = makeDoc({
      declarations: {
        fields: [
          { field: "brokerName", value: "From Declarations" },
        ],
      },
    });
    promoteBroker(doc);
    expect((doc as any).brokerAgency).toBeUndefined();
    expect((doc as any).producer).toBeUndefined();
  });

  it("does not create producer if no broker data", () => {
    const doc = makeDoc({ declarations: { fields: [] } });
    promoteBroker(doc);
    expect((doc as any).producer).toBeUndefined();
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
      brokerAgency: "Smith Insurance Agency",
      brokerPhone: "555-0100",
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

    // Declaration rows are preserved for LLM review but not promoted into facts.
    expect((doc as any).lossPayees).toBeUndefined();
    expect((doc as any).locations).toBeUndefined();

    expect((doc as any).limits).toBeUndefined();
    expect((doc as any).deductibles).toBeUndefined();
  });
});
