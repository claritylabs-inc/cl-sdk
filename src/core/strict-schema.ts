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
        // Preserve .describe() metadata — it lives on the optional wrapper, not the inner type
        const innerType: ZodTypeAny | undefined = fieldDef?.innerType;
        const description: string | undefined =
          (field as any).description ?? fieldDef?.description ?? (field as any)._zod?.def?.description;
        if (innerType) {
          const transformed = toStrictSchema(innerType);
          let nullable = z.nullable(transformed);
          if (description) nullable = nullable.describe(description) as typeof nullable;
          newShape[key] = nullable;
        } else {
          let nullable = z.nullable(field);
          if (description) nullable = nullable.describe(description) as typeof nullable;
          newShape[key] = nullable;
        }
      } else {
        // Recurse into non-optional fields
        newShape[key] = toStrictSchema(field);
      }
    }

    const objDesc: string | undefined =
      (schema as any).description ?? def?.description ?? (schema as any)._zod?.def?.description;
    const result = z.object(newShape);
    return objDesc ? result.describe(objDesc) : result;
  }

  if (typeName === "array") {
    const element: ZodTypeAny | undefined = def?.element ?? (schema as any).element;
    if (element) {
      const arrDesc: string | undefined =
        (schema as any).description ?? def?.description ?? (schema as any)._zod?.def?.description;
      const result = z.array(toStrictSchema(element));
      return arrDesc ? result.describe(arrDesc) : result;
    }
    return schema;
  }

  if (typeName === "nullable") {
    const innerType: ZodTypeAny | undefined = def?.innerType;
    if (innerType) {
      const nullDesc: string | undefined =
        (schema as any).description ?? def?.description ?? (schema as any)._zod?.def?.description;
      const result = z.nullable(toStrictSchema(innerType));
      return nullDesc ? result.describe(nullDesc) : result;
    }
    return schema;
  }

  // Primitives and other types — return as-is
  return schema;
}
