import { describe, it, expect } from "vitest";
import { sanitizeNulls } from "../../core/sanitize";

describe("sanitizeNulls", () => {
  it("converts null to undefined", () => {
    expect(sanitizeNulls(null)).toBeUndefined();
  });
  it("recursively converts nulls in objects", () => {
    const result = sanitizeNulls({ a: null, b: { c: null, d: "ok" } });
    expect(result).toEqual({ a: undefined, b: { c: undefined, d: "ok" } });
  });
  it("handles arrays", () => {
    const result = sanitizeNulls([null, { a: null }]);
    expect(result).toEqual([undefined, { a: undefined }]);
  });
  it("passes through primitives", () => {
    expect(sanitizeNulls("hello")).toBe("hello");
    expect(sanitizeNulls(42)).toBe(42);
  });
});
