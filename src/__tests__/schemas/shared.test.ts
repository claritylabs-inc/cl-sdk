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
  it("validates source-backed contact records", () => {
    const contact = { name: "Claims Desk", sourceSpanIds: ["span-contact"] };
    expect(ContactSchema.parse(contact)).toEqual(contact);
  });
  it("rejects contact records without source spans", () => {
    expect(() => ContactSchema.parse({ name: "Claims Desk" })).toThrow();
  });
});
