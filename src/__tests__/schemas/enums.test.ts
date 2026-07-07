import { describe, it, expect } from "vitest";
import { EndorsementTypeSchema } from "../../schemas/enums";
import {
  ACORD_LOB_CODES,
  AcordLobCodeSchema,
  normalizeOperationalLinesOfBusiness,
} from "../../schemas/lines-of-business";

describe("enum schemas", () => {
  it("validates known ACORD line of business codes", () => {
    expect(AcordLobCodeSchema.parse("CGL")).toBe("CGL");
    expect(AcordLobCodeSchema.parse("HOME")).toBe("HOME");
    expect(AcordLobCodeSchema.parse("UN")).toBe("UN");
  });

  it("rejects unknown and excluded ACORD line of business codes", () => {
    expect(() => AcordLobCodeSchema.parse("not_a_type")).toThrow();
    expect(() => AcordLobCodeSchema.parse("ACHE")).toThrow();
  });

  it("ACORD_LOB_CODES contains the accepted code set", () => {
    expect(ACORD_LOB_CODES.length).toBe(88);
    expect(ACORD_LOB_CODES).toContain("Motorcycle");
    expect(ACORD_LOB_CODES).not.toContain("CRIM");
  });

  it("normalizes legacy policy types to ACORD codes", () => {
    expect(normalizeOperationalLinesOfBusiness(["general_liability", "management_liability_package", "cyber"])).toEqual([
      "CGL",
      "DO",
      "EPLI",
      "FIDUC",
      "OLIB",
    ]);
  });

  it("validates endorsement types", () => {
    expect(EndorsementTypeSchema.parse("additional_insured")).toBe("additional_insured");
  });
});
