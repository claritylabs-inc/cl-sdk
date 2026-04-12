import type { GenerateText, TokenUsage } from "../core/types";
import type { InsuranceDocument } from "../schemas/document";
import { withRetry } from "../core/retry";
import { buildFormatPrompt } from "../prompts/coordinator/format";

interface ContentEntry {
  id: number;
  path: string;
  text: string;
}

/**
 * Collect all content-bearing string fields from the assembled document
 * that are likely to contain markdown formatting.
 */
function collectContentFields(doc: InsuranceDocument): ContentEntry[] {
  const entries: ContentEntry[] = [];
  let id = 0;

  function add(path: string, text: string | undefined) {
    if (text && text.length > 20) {
      entries.push({ id: id++, path, text });
    }
  }

  // Document-level summary
  add("summary", doc.summary);

  // Sections and subsections
  if (doc.sections) {
    for (let i = 0; i < doc.sections.length; i++) {
      const s = doc.sections[i];
      add(`sections[${i}].content`, s.content);
      if (s.subsections) {
        for (let j = 0; j < s.subsections.length; j++) {
          add(`sections[${i}].subsections[${j}].content`, s.subsections[j].content);
        }
      }
    }
  }

  // Endorsements
  if (doc.endorsements) {
    for (let i = 0; i < doc.endorsements.length; i++) {
      add(`endorsements[${i}].content`, doc.endorsements[i].content);
    }
  }

  // Exclusions
  if (doc.exclusions) {
    for (let i = 0; i < doc.exclusions.length; i++) {
      add(`exclusions[${i}].content`, doc.exclusions[i].content);
    }
  }

  // Conditions
  if (doc.conditions) {
    for (let i = 0; i < doc.conditions.length; i++) {
      add(`conditions[${i}].content`, doc.conditions[i].content);
    }
  }

  return entries;
}

/**
 * Parse the model's response back into a map of entry ID → cleaned text.
 */
function parseFormatResponse(response: string): Map<number, string> {
  const results = new Map<number, string>();
  const parts = response.split(/===ENTRY (\d+)===/);

  // parts[0] is anything before the first marker (usually empty)
  // then alternating: [id, content, id, content, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const entryId = parseInt(parts[i], 10);
    const content = parts[i + 1]?.trim();
    if (!isNaN(entryId) && content !== undefined) {
      results.set(entryId, content);
    }
  }

  return results;
}

/**
 * Apply cleaned text back to the document, mutating in place.
 */
function applyFormattedContent(
  doc: InsuranceDocument,
  entries: ContentEntry[],
  formatted: Map<number, string>,
): void {
  for (const entry of entries) {
    const cleaned = formatted.get(entry.id);
    if (!cleaned) continue;

    // Use the path to set the value
    const segments = entry.path.match(/^(\w+)(?:\[(\d+)\])?(?:\.(\w+)(?:\[(\d+)\])?(?:\.(\w+))?)?$/);
    if (!segments) continue;

    const [, field, idx1, sub1, idx2, sub2] = segments;

    if (!sub1) {
      // Top-level field like "summary"
      (doc as any)[field] = cleaned;
    } else if (!sub2) {
      // Array field like "sections[0].content"
      const arr = (doc as any)[field];
      if (arr && arr[Number(idx1)]) {
        arr[Number(idx1)][sub1] = cleaned;
      }
    } else {
      // Nested array like "sections[0].subsections[1].content"
      const arr = (doc as any)[field];
      if (arr && arr[Number(idx1)]) {
        const nested = arr[Number(idx1)][sub1];
        if (nested && nested[Number(idx2)]) {
          nested[Number(idx2)][sub2] = cleaned;
        }
      }
    }
  }
}

const MAX_ENTRIES_PER_BATCH = 20;

/**
 * Format all markdown content in an assembled document.
 *
 * Collects content-bearing string fields, sends them through a model call
 * for formatting cleanup, and applies the cleaned text back to the document.
 */
export async function formatDocumentContent(
  doc: InsuranceDocument,
  generateText: GenerateText,
  options?: {
    providerOptions?: Record<string, unknown>;
    onProgress?: (message: string) => void;
  },
): Promise<{ document: InsuranceDocument; usage: TokenUsage }> {
  const entries = collectContentFields(doc);
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  if (entries.length === 0) {
    return { document: doc, usage: totalUsage };
  }

  options?.onProgress?.(`Formatting ${entries.length} content fields...`);

  // Batch entries to stay within reasonable token limits
  const batches: ContentEntry[][] = [];
  for (let i = 0; i < entries.length; i += MAX_ENTRIES_PER_BATCH) {
    batches.push(entries.slice(i, i + MAX_ENTRIES_PER_BATCH));
  }

  for (const batch of batches) {
    const prompt = buildFormatPrompt(batch.map((e) => ({ id: e.id, text: e.text })));

    const result = await withRetry(() =>
      generateText({
        prompt,
        maxTokens: 16384,
        providerOptions: options?.providerOptions,
      })
    );

    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens;
      totalUsage.outputTokens += result.usage.outputTokens;
    }

    const formatted = parseFormatResponse(result.text);
    applyFormattedContent(doc, batch, formatted);
  }

  return { document: doc, usage: totalUsage };
}
