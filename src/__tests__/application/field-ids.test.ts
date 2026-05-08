import { describe, expect, it } from "vitest";
import { buildApplicationFieldAnchorId, normalizeApplicationFields } from "../../application/field-ids";
import type { ApplicationField } from "../../schemas/application";

function field(overrides: Partial<ApplicationField> = {}): ApplicationField {
  return {
    id: "model_id",
    label: "Policy Effective Date",
    section: "Prior Coverage",
    fieldType: "date",
    required: true,
    pageNumber: 2,
    ...overrides,
  };
}

describe("application field stable IDs", () => {
  it("builds stable anchor IDs from page, section, label, and acro form name", () => {
    const first = buildApplicationFieldAnchorId(field({ acroFormName: "PolEffDate" }));
    const second = buildApplicationFieldAnchorId(field({ id: "different_model_id", acroFormName: "PolEffDate" }));

    expect(first).toBe(second);
    expect(first).toMatch(/^app_field_anchor:p2:prior_coverage:policy_effective_date:/);
  });

  it("replaces model generated IDs with deterministic IDs and keeps duplicates unique", () => {
    const normalized = normalizeApplicationFields([
      field({ id: "first_guess" }),
      field({ id: "second_guess" }),
    ]);

    expect(normalized[0].id).toMatch(/^app_field:p2:prior_coverage:policy_effective_date:/);
    expect(normalized[1].id).toBe(`${normalized[0].id}:2`);
    expect(normalized[0].fieldAnchorId).toBe(normalized[1].fieldAnchorId);
  });
});
