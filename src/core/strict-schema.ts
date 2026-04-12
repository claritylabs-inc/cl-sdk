import { z, type ZodTypeAny } from "zod";

/**
 * Transform a Zod schema so all `.optional()` properties become `.nullable()`
 * (required but accepting null). This makes schemas compatible with OpenAI's
 * strict structured output mode, which requires every property key to appear
 * in the JSON Schema `required` array.
 *
 * Works recursively through objects, arrays, and wrapper types.
 * Non-object schemas (string, number, etc.) are returned as-is.
 */
export function toStrictSchema(schema: ZodTypeAny): ZodTypeAny {
  const def = (schema as any)._zod?.def;
  const typeName: string | undefined = def?.type ?? (schema as any).type;

  if (typeName === "object") {
    const shape: Record<string, ZodTypeAny> | undefined = (schema as any).shape;
    if (!shape) return schema;

    const newShape: Record<string, ZodTypeAny> = {};

    for (const [key, value] of Object.entries(shape)) {
      const field = value as ZodTypeAny;
      const fieldDef = (field as any)._zod?.def;
      const fieldType: string | undefined = fieldDef?.type ?? (field as any).type;

      if (fieldType === "optional") {
        // Convert .optional() → .nullable() (required but accepts null)
        const innerType: ZodTypeAny | undefined = fieldDef?.innerType;
        if (innerType) {
          const transformed = toStrictSchema(innerType);
          newShape[key] = z.nullable(transformed);
        } else {
          newShape[key] = z.nullable(field);
        }
      } else {
        // Recurse into non-optional fields
        newShape[key] = toStrictSchema(field);
      }
    }

    return z.object(newShape);
  }

  if (typeName === "array") {
    const element: ZodTypeAny | undefined = def?.element ?? (schema as any).element;
    if (element) {
      return z.array(toStrictSchema(element));
    }
    return schema;
  }

  if (typeName === "nullable") {
    const innerType: ZodTypeAny | undefined = def?.innerType;
    if (innerType) {
      return z.nullable(toStrictSchema(innerType));
    }
    return schema;
  }

  // Primitives and other types — return as-is
  return schema;
}
