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

  it("recurses through default wrappers before sending schemas to the provider", async () => {
    const schema = z.object({
      decisions: z.array(z.object({
        decisionId: z.string(),
        reason: z.string().optional(),
      })).default([]),
    });
    const generateObject = vi.fn(async (params) => {
      expect(() =>
        params.schema.parse({
          decisions: null,
        }),
      ).not.toThrow();
      expect(() =>
        params.schema.parse({
          decisions: [{
            decisionId: "decision-1",
            reason: null,
          }],
        }),
      ).not.toThrow();

      return {
        object: {
          decisions: [{
            decisionId: "decision-1",
            reason: null,
          }],
        },
      };
    }) as unknown as GenerateObject<z.input<typeof schema>>;

    const result = await safeGenerateObject(generateObject, {
      prompt: "test",
      schema,
      maxTokens: 128,
    });

    expect(result.object).toEqual({
      decisions: [{
        decisionId: "decision-1",
        reason: undefined,
      }],
    });
  });

  it("can skip retryable-error backoff when the host callback owns fallback routing", async () => {
    const schema = z.object({ value: z.string() });
    const generateObject = vi.fn(async () => {
      throw new Error("No output generated.");
    }) as unknown as GenerateObject<z.infer<typeof schema>>;
    const log = vi.fn();

    const result = await safeGenerateObject(
      generateObject,
      {
        prompt: "test",
        schema,
        maxTokens: 128,
      },
      {
        fallback: { value: "fallback" },
        maxRetries: 0,
        retry: false,
        log,
      },
    );

    expect(result.object).toEqual({ value: "fallback" });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("Retryable error"));
  });
});
