/**
 * Recursively convert null values to undefined.
 * Some databases (e.g. Convex) reject null for optional fields,
 * but LLMs routinely return null for missing values.
 */
export function sanitizeNulls<T>(obj: T): T {
  if (obj === null || obj === undefined) return undefined as unknown as T;
  if (Array.isArray(obj)) return obj.map(sanitizeNulls) as unknown as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = sanitizeNulls(value);
    }
    return result as T;
  }
  return obj;
}
