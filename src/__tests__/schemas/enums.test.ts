import { describe, it, expect } from "vitest";
import { EndorsementTypeSchema } from "../../schemas/enums";
import {
  ACORD_LOB_CODES,
  AcordLobCodeSchema,
  normalizeOperationalLinesOfBusiness,
  toLobCodes,
} from "../../schemas/lines-of-business";
import {
  ACORD_COVERAGE_ENTRIES,
  ACORD_COVERAGE_CODES,
  ACORD_COVERAGE_SOURCE_HEADERS,
  ACORD_COVERAGE_SOURCE_ROWS,
  AcordCoverageCodeSchema,
  coverageDescriptions,
  resolveAcordCoverageCode,
} from "../../schemas/coverage-codes";
import { OperationalCoverageLineSchema } from "../../source";

describe("enum schemas", () => {
  it("validates known ACORD line of business codes", () => {
    expect(AcordLobCodeSchema.parse("CGL")).toBe("CGL");
    expect(AcordLobCodeSchema.parse("HOME")).toBe("HOME");
    expect(AcordLobCodeSchema.parse("UN")).toBe("UN");
  });

  it("rejects unknown and retired ACORD line of business codes", () => {
    expect(() => AcordLobCodeSchema.parse("not_a_type")).toThrow();
    expect(() => AcordLobCodeSchema.parse("AAPPL")).toThrow();
    expect(AcordLobCodeSchema.parse("ACHE")).toBe("ACHE");
  });

  it("ACORD_LOB_CODES contains the accepted code set", () => {
    expect(ACORD_LOB_CODES.length).toBe(107);
    expect(ACORD_LOB_CODES).toContain("Motorcycle");
    expect(ACORD_LOB_CODES).toContain("CRIM");
    expect(ACORD_LOB_CODES).toContain("CYBER");
    expect(ACORD_LOB_CODES).toContain("TRVL");
    expect(ACORD_LOB_CODES).not.toContain("PROPC");
  });

  it("normalizes legacy policy types to ACORD codes", () => {
    expect(normalizeOperationalLinesOfBusiness(["general_liability", "management_liability_package", "cyber"])).toEqual([
      "CGL",
      "MGMLI",
      "CYBER",
    ]);
    expect(toLobCodes(["PROPC", "travel", "Commercial Cyber and Privacy Liability"])).toEqual([
      "PROP",
      "TRVL",
      "CYBER",
    ]);
    expect(toLobCodes(["UN", "TRVL"])).toEqual(["TRVL"]);
  });

  it("validates coverage-level ACORD line of business codes", () => {
    expect(OperationalCoverageLineSchema.parse({
      name: "Commercial General Liability",
      lineOfBusiness: "CGL",
      limits: [],
      sourceNodeIds: [],
      sourceSpanIds: [],
    }).lineOfBusiness).toBe("CGL");
    expect(() => OperationalCoverageLineSchema.parse({
      name: "Commercial General Liability",
      lineOfBusiness: "not_a_lob",
      limits: [],
      sourceNodeIds: [],
      sourceSpanIds: [],
    })).toThrow();
  });

  it("preserves and validates the complete ACORD CoverageCd table", () => {
    expect(ACORD_COVERAGE_ENTRIES).toHaveLength(2758);
    expect(ACORD_COVERAGE_CODES).toHaveLength(1833);
    expect(ACORD_COVERAGE_SOURCE_HEADERS).toEqual([
      "Value",
      "Description",
    ]);
    expect(ACORD_COVERAGE_SOURCE_ROWS[0]).toEqual([
      "X12M",
      "12 Month Extension Clause",
    ]);
    expect(ACORD_COVERAGE_SOURCE_ROWS[1]).toEqual(
      ACORD_COVERAGE_SOURCE_ROWS[0],
    );
    expect(AcordCoverageCodeSchema.parse("tvldl")).toBe("TVLDL");
    expect(resolveAcordCoverageCode(undefined, "Travel Delay")).toBe("TVLDL");
    expect(resolveAcordCoverageCode(undefined, "Business Income")).toBeUndefined();
    expect(coverageDescriptions("ADB").length).toBeGreaterThan(1);
    expect(() => AcordCoverageCodeSchema.parse("not_a_coverage")).toThrow();
  });

  it("validates endorsement types", () => {
    expect(EndorsementTypeSchema.parse("additional_insured")).toBe("additional_insured");
  });
});
