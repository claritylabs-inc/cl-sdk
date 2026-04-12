import { describe, it, expect } from "vitest";
import { stripFences } from "../../core/strip-fences";

describe("stripFences", () => {
  it("removes json code fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("removes plain code fences", () => {
    expect(stripFences('```\nhello\n```')).toBe("hello");
  });
  it("returns plain text unchanged", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});
