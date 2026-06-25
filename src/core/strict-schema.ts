import { z, type ZodTypeAny } from "zod";

function schemaDef(schema: ZodTypeAny): Record<string, any> {
  return (schema as any)._zod?.def ?? (schema as any)._def ?? {};
}

function schemaKind(schema: ZodTypeAny): string | undefined {
  const def = schemaDef(schema);
  const raw = typeof def.type === "string"
    ? def.type
    : typeof def.typeName === "string"
      ? def.typeName
      : typeof (schema as any).type === "string"
        ? (schema as any).type
        : undefined;
  return raw?.replace(/^Zod/, "").toLowerCase();
}

function schemaDescription(schema: ZodTypeAny): string | undefined {
  const def = schemaDef(schema);
  return (schema as any).description ?? def.description;
}

function objectShape(schema: ZodTypeAny): Record<string, ZodTypeAny> | undefined {
  const def = schemaDef(schema);
  const shape = (schema as any).shape ?? def.shape;
  return typeof shape === "function" ? shape() : shape;
}

function withDescription<T extends ZodTypeAny>(schema: T, description: string | undefined): T {
  return description ? schema.describe(description) as T : schema;
}

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
  const kind = schemaKind(schema);
  const def = schemaDef(schema);

  if (kind === "object") {
    const shape = objectShape(schema);
    if (!shape) return schema;

    const newShape: Record<string, ZodTypeAny> = {};

    for (const [key, value] of Object.entries(shape)) {
      const field = value as ZodTypeAny;
      const fieldDef = schemaDef(field);
      const fieldKind = schemaKind(field);

      if (fieldKind === "optional") {
        // Convert .optional() → .nullable() (required but accepts null)
        // Preserve .describe() metadata — it lives on the optional wrapper, not the inner type
        const innerType: ZodTypeAny | undefined = fieldDef?.innerType;
        const description = schemaDescription(field);
        if (innerType) {
          const transformed = toStrictSchema(innerType);
          newShape[key] = withDescription(z.nullable(transformed), description);
        } else {
          newShape[key] = withDescription(z.nullable(field), description);
        }
      } else {
        // Recurse into non-optional fields
        newShape[key] = toStrictSchema(field);
      }
    }

    return withDescription(z.object(newShape), schemaDescription(schema));
  }

  if (kind === "array") {
    const element: ZodTypeAny | undefined = def.element ?? def.type ?? (schema as any).element;
    if (element) {
      return withDescription(z.array(toStrictSchema(element)), schemaDescription(schema));
    }
    return schema;
  }

  if (kind === "nullable") {
    const innerType: ZodTypeAny | undefined = def?.innerType;
    if (innerType) {
      return withDescription(z.nullable(toStrictSchema(innerType)), schemaDescription(schema));
    }
    return schema;
  }

  if (kind === "default") {
    const innerType: ZodTypeAny | undefined = def?.innerType;
    if (innerType) {
      return withDescription(z.nullable(toStrictSchema(innerType)), schemaDescription(schema));
    }
    return schema;
  }

  // Primitives and other types — return as-is
  return schema;
}
