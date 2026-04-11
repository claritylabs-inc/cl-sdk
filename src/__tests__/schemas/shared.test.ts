import { describe, it, expect } from "vitest";
import { AddressSchema, ContactSchema } from "../../schemas/shared";

describe("shared schemas", () => {
  it("validates a complete address", () => {
    const addr = { street1: "123 Main", city: "Austin", state: "TX", zip: "78701" };
    expect(AddressSchema.parse(addr)).toEqual(addr);
  });
  it("validates address with optional fields", () => {
    const addr = { street1: "123 Main", city: "Austin", state: "TX", zip: "78701", street2: "Suite 4", country: "US" };
    expect(AddressSchema.parse(addr)).toEqual(addr);
  });
  it("rejects address missing required fields", () => {
    expect(() => AddressSchema.parse({ street1: "123 Main" })).toThrow();
  });
  it("validates contact with minimal fields", () => {
    expect(ContactSchema.parse({})).toEqual({});
  });
});
