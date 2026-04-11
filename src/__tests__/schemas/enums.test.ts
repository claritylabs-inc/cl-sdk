import { describe, it, expect } from "vitest";
import { PolicyTypeSchema, POLICY_TYPES, EndorsementTypeSchema } from "../../schemas/enums";

describe("enum schemas", () => {
  it("validates known policy types", () => {
    expect(PolicyTypeSchema.parse("general_liability")).toBe("general_liability");
    expect(PolicyTypeSchema.parse("homeowners_ho3")).toBe("homeowners_ho3");
  });
  it("rejects unknown policy types", () => {
    expect(() => PolicyTypeSchema.parse("not_a_type")).toThrow();
  });
  it("POLICY_TYPES contains all values", () => {
    expect(POLICY_TYPES.length).toBeGreaterThan(30);
    expect(POLICY_TYPES.length).toBe(42);
  });
  it("validates endorsement types", () => {
    expect(EndorsementTypeSchema.parse("additional_insured")).toBe("additional_insured");
  });
});
