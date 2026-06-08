import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GenerateObject } from "../../core/types";
import { safeGenerateObject } from "../../core/safe-generate";

describe("safeGenerateObject", () => {
  it("returns objects normalized back to the caller schema after strict nullable generation", async () => {
    const schema = z.object({
      requiredValue: z.string(),
      optionalValue: z.string().optional(),
      nested: z.object({
        optionalNested: z.string().optional(),
      }).optional(),
      items: z.array(z.object({
        requiredItem: z.string(),
        optionalItem: z.string().optional(),
      })).optional(),
    });
    const generateObject = vi.fn(async () => ({
      object: {
        requiredValue: "present",
        optionalValue: null,
        nested: {
          optionalNested: null,
        },
        items: [{
          requiredItem: "item",
          optionalItem: null,
        }],
      },
    })) as unknown as GenerateObject<z.infer<typeof schema>>;

    const result = await safeGenerateObject(generateObject, {
      prompt: "test",
      schema,
      maxTokens: 128,
    });

    expect(result.object).toEqual({
      requiredValue: "present",
      optionalValue: undefined,
      nested: {
        optionalNested: undefined,
      },
      items: [{
        requiredItem: "item",
        optionalItem: undefined,
      }],
    });
  });
});
