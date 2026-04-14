import { z } from "zod";
import type { GenerateObject, TokenUsage, ConvertPdfToImagesFn, LogFn } from "../core/types";
import { pLimit } from "../core/concurrency";
import { safeGenerateObject } from "../core/safe-generate";
import { runExtractor } from "./extractor";
import { extractPageRange } from "./pdf";
import {
  buildReferentialLookupPrompt,
  ReferentialLookupSchema,
  type ReferentialLookupResult,
} from "../prompts/extractors/referential-lookup";
import type { FormInventoryEntry } from "../prompts/coordinator/form-inventory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferentialResolutionResult {
  resolved: number;
  unresolved: number;
  attempts: number;
  usage: TokenUsage;
  details: Array<{
    coverageName: string;
    referenceTarget: string | undefined;
    resolvedLimit?: string;
    resolvedDeductible?: string;
    status: "resolved" | "unresolved" | "pages_not_found";
  }>;
}

interface SectionEntry {
  title?: string;
  pageStart?: number;
  pageEnd?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Local copy of the referential-value heuristic from quality.ts (not exported
 * there, so we inline an equivalent check).
 */
function looksReferential(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes("shown in the declarations") ||
    normalized.includes("shown in declarations") ||
    normalized.includes("shown in the schedule") ||
    normalized.includes("as stated") ||
    normalized.includes("if applicable")
  );
}

// ---------------------------------------------------------------------------
// parseReferenceTarget
// ---------------------------------------------------------------------------

/**
 * Extracts a section identifier from a referential string.
 *
 * Examples:
 *   "As stated in Section 4 of Policy" -> "Section 4"
 *   "As stated in Policy"              -> "Policy"
 *   "Shown in the Declarations"        -> "Declarations"
 *   "See Schedule of Coverage"         -> "Schedule of Coverage"
 *
 * Returns undefined when no meaningful target can be parsed.
 */
export function parseReferenceTarget(text: string): string | undefined {
  if (typeof text !== "string") return undefined;
  const normalized = text.trim();
  if (!normalized) return undefined;

  // "Section N" / "Section N of ..."
  const sectionMatch = normalized.match(/\b(Section\s+\d+[A-Za-z]?)/i);
  if (sectionMatch) return sectionMatch[1];

  // "Shown in the Declarations" / "shown in declarations"
  if (/declarations/i.test(normalized)) return "Declarations";

  // "Shown in the Schedule" / "See Schedule of ..."
  const scheduleMatch = normalized.match(/\b(Schedule(?:\s+of\s+[A-Za-z ]+)?)/i);
  if (scheduleMatch) return scheduleMatch[1].trim();

  // "As stated in <target>"  /  "See <target>"
  const asStatedMatch = normalized.match(/(?:as\s+stated\s+in|see|shown\s+in(?:\s+the)?)\s+(.+)/i);
  if (asStatedMatch) {
    // Strip trailing noise like "of the Policy"
    let target = asStatedMatch[1].trim().replace(/\s+of\s+the\s+policy$/i, "").trim();
    // Remove trailing periods
    target = target.replace(/\.+$/, "").trim();
    if (target) return target;
  }

  // "If applicable" — no concrete target
  if (/if applicable/i.test(normalized)) return undefined;

  return undefined;
}

// ---------------------------------------------------------------------------
// findReferencedPages
// ---------------------------------------------------------------------------

const PageLocationSchema = z.object({
  startPage: z.number(),
  endPage: z.number(),
});

/**
 * Three-tier page location strategy for a reference target:
 * 1. Match against extracted sections in memory.
 * 2. Fall back to form inventory entries.
 * 3. Final fallback: ask the LLM which pages contain the section.
 */
export async function findReferencedPages(params: {
  referenceTarget: string;
  sections: SectionEntry[];
  formInventory: FormInventoryEntry[];
  pdfBase64: string;
  pageCount: number;
  generateObject: GenerateObject;
  providerOptions?: Record<string, unknown>;
  log?: LogFn;
}): Promise<{ startPage: number; endPage: number } | undefined> {
  const {
    referenceTarget,
    sections,
    formInventory,
    pdfBase64,
    pageCount,
    generateObject,
    providerOptions,
    log,
  } = params;

  const targetLower = referenceTarget.toLowerCase();

  // Tier 1: Match against extracted sections
  for (const section of sections) {
    if (
      section.title &&
      section.pageStart != null &&
      section.title.toLowerCase().includes(targetLower)
    ) {
      return {
        startPage: section.pageStart,
        endPage: section.pageEnd ?? section.pageStart,
      };
    }
  }

  // Tier 2: Match against form inventory entries
  for (const form of formInventory) {
    const titleMatch =
      form.title && form.title.toLowerCase().includes(targetLower);
    const typeMatch =
      form.formType && form.formType.toLowerCase().includes(targetLower);

    if ((titleMatch || typeMatch) && form.pageStart != null) {
      return {
        startPage: form.pageStart,
        endPage: form.pageEnd ?? form.pageStart,
      };
    }
  }

  // Tier 3: LLM fallback — ask which pages contain the referenced section
  try {
    const result = await safeGenerateObject(
      generateObject as GenerateObject<z.infer<typeof PageLocationSchema>>,
      {
        prompt: `You are analyzing an insurance document (${pageCount} pages total).

Find the pages that contain the section or area referenced as "${referenceTarget}".

Return the page range (1-indexed) where this section is located. If the section spans a single page, startPage and endPage should be the same.

If you cannot find the section, return startPage: 0 and endPage: 0.

Return JSON only.`,
        schema: PageLocationSchema,
        maxTokens: 256,
        providerOptions: { ...providerOptions, pdfBase64 },
      },
      {
        fallback: { startPage: 0, endPage: 0 },
        maxRetries: 1,
        log,
        onError: (err, attempt) =>
          log?.(
            `Page location attempt ${attempt + 1} failed for "${referenceTarget}": ${err instanceof Error ? err.message : String(err)}`,
          ),
      },
    );

    if (result.object.startPage > 0 && result.object.endPage > 0) {
      return {
        startPage: result.object.startPage,
        endPage: result.object.endPage,
      };
    }
  } catch (error) {
    await log?.(
      `Failed to locate pages for "${referenceTarget}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// resolveReferentialCoverages
// ---------------------------------------------------------------------------

export async function resolveReferentialCoverages(params: {
  memory: Map<string, unknown>;
  pdfBase64: string;
  pageCount: number;
  generateObject: GenerateObject;
  convertPdfToImages?: ConvertPdfToImagesFn;
  concurrency?: number;
  providerOptions?: Record<string, unknown>;
  log?: LogFn;
  onProgress?: (message: string) => void;
}): Promise<ReferentialResolutionResult> {
  const {
    memory,
    pdfBase64,
    pageCount,
    generateObject,
    convertPdfToImages,
    concurrency = 2,
    providerOptions,
    log,
    onProgress,
  } = params;

  const limit = pLimit(concurrency);
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  function trackUsage(usage?: TokenUsage) {
    if (usage) {
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
    }
  }

  // 1. Get coverages from memory
  const coverageData = memory.get("coverage_limits") as
    | { coverages?: Array<Record<string, unknown>> }
    | undefined;
  const coverages = coverageData?.coverages ?? [];

  // 2. Filter to referential coverages
  const referentialCoverages = coverages.filter((cov) => {
    const limitType = cov.limitValueType as string | undefined;
    const deductibleType = cov.deductibleValueType as string | undefined;
    return (
      limitType === "referential" ||
      limitType === "as_stated" ||
      deductibleType === "referential" ||
      deductibleType === "as_stated" ||
      looksReferential(cov.limit) ||
      looksReferential(cov.deductible)
    );
  });

  const attempts = referentialCoverages.length;
  if (attempts === 0) {
    return {
      resolved: 0,
      unresolved: 0,
      attempts: 0,
      usage: totalUsage,
      details: [],
    };
  }

  onProgress?.(
    `Found ${attempts} referential coverage(s) to resolve...`,
  );

  // 3. Parse reference targets and group by target
  const targetGroups = new Map<
    string,
    Array<{ coverage: Record<string, unknown>; index: number }>
  >();

  for (let i = 0; i < referentialCoverages.length; i++) {
    const cov = referentialCoverages[i];
    const refString =
      (looksReferential(cov.limit) ? (cov.limit as string) : undefined) ??
      (looksReferential(cov.deductible) ? (cov.deductible as string) : undefined) ??
      (cov.limit as string | undefined) ??
      "";
    const target = parseReferenceTarget(refString) ?? "unknown";

    const group = targetGroups.get(target) ?? [];
    group.push({ coverage: cov, index: i });
    targetGroups.set(target, group);
  }

  // Gather section and form inventory data for page finding
  const sectionsData = memory.get("sections") as
    | { sections?: SectionEntry[] }
    | undefined;
  const sections = sectionsData?.sections ?? [];

  const formInventoryData = memory.get("form_inventory") as
    | { forms?: FormInventoryEntry[] }
    | undefined;
  const formInventory = formInventoryData?.forms ?? [];

  // 4. For each unique target, find pages and dispatch extraction
  const details: ReferentialResolutionResult["details"] = [];
  let resolved = 0;
  let unresolved = 0;

  const targetEntries = Array.from(targetGroups.entries());

  await Promise.all(
    targetEntries.map(([target, group]) =>
      limit(async () => {
        // Find pages for this reference target
        const pageRange = await findReferencedPages({
          referenceTarget: target,
          sections,
          formInventory,
          pdfBase64,
          pageCount,
          generateObject,
          providerOptions,
          log,
        });

        if (!pageRange) {
          await log?.(
            `Could not locate pages for reference target "${target}"`,
          );
          for (const { coverage } of group) {
            details.push({
              coverageName: String(coverage.name ?? "unknown"),
              referenceTarget: target === "unknown" ? undefined : target,
              status: "pages_not_found",
            });
            unresolved++;
          }
          return;
        }

        onProgress?.(
          `Resolving "${target}" from pages ${pageRange.startPage}-${pageRange.endPage}...`,
        );

        // Build the prompt with all coverages in this group
        const promptCoverages = group.map(({ coverage }) => ({
          name: String(coverage.name ?? "unknown"),
          limit: String(coverage.limit ?? ""),
          deductible: coverage.deductible
            ? String(coverage.deductible)
            : undefined,
          sectionRef: coverage.sectionRef
            ? String(coverage.sectionRef)
            : undefined,
        }));

        try {
          const result = await runExtractor<ReferentialLookupResult>({
            name: "referential_lookup",
            prompt: buildReferentialLookupPrompt(promptCoverages),
            schema: ReferentialLookupSchema,
            pdfBase64,
            startPage: pageRange.startPage,
            endPage: pageRange.endPage,
            generateObject: generateObject as GenerateObject<ReferentialLookupResult>,
            convertPdfToImages,
            maxTokens: 4096,
            providerOptions,
          });

          trackUsage(result.usage);

          // Match resolved coverages back to originals
          const resolvedMap = new Map<
            string,
            (typeof result.data.resolvedCoverages)[number]
          >();
          for (const rc of result.data.resolvedCoverages) {
            resolvedMap.set(rc.coverageName.toLowerCase(), rc);
          }

          for (const { coverage } of group) {
            const covName = String(coverage.name ?? "unknown");
            const rc = resolvedMap.get(covName.toLowerCase());

            if (!rc) {
              details.push({
                coverageName: covName,
                referenceTarget: target === "unknown" ? undefined : target,
                status: "unresolved",
              });
              unresolved++;
              continue;
            }

            // Check that the resolved value is non-referential before merging
            const limitResolved =
              rc.resolvedLimit &&
              rc.resolvedLimitValueType !== "referential" &&
              rc.resolvedLimitValueType !== "as_stated" &&
              !looksReferential(rc.resolvedLimit);

            const deductibleResolved =
              rc.resolvedDeductible &&
              rc.resolvedDeductibleValueType !== "referential" &&
              rc.resolvedDeductibleValueType !== "as_stated" &&
              !looksReferential(rc.resolvedDeductible);

            if (limitResolved || deductibleResolved) {
              // Merge resolved values back into the original coverage object
              if (limitResolved) {
                coverage.limit = rc.resolvedLimit;
                coverage.limitValueType = rc.resolvedLimitValueType ?? "numeric";
              }
              if (deductibleResolved) {
                coverage.deductible = rc.resolvedDeductible;
                coverage.deductibleValueType =
                  rc.resolvedDeductibleValueType ?? "numeric";
              }
              if (rc.pageNumber != null) {
                coverage.resolvedFromPage = rc.pageNumber;
              }
              if (rc.originalContent) {
                coverage.resolvedOriginalContent = rc.originalContent;
              }

              details.push({
                coverageName: covName,
                referenceTarget: target === "unknown" ? undefined : target,
                resolvedLimit: limitResolved
                  ? rc.resolvedLimit
                  : undefined,
                resolvedDeductible: deductibleResolved
                  ? rc.resolvedDeductible
                  : undefined,
                status: "resolved",
              });
              resolved++;
            } else {
              details.push({
                coverageName: covName,
                referenceTarget: target === "unknown" ? undefined : target,
                status: "unresolved",
              });
              unresolved++;
            }
          }
        } catch (error) {
          await log?.(
            `Referential lookup extraction failed for target "${target}": ${error instanceof Error ? error.message : String(error)}`,
          );
          for (const { coverage } of group) {
            details.push({
              coverageName: String(coverage.name ?? "unknown"),
              referenceTarget: target === "unknown" ? undefined : target,
              status: "unresolved",
            });
            unresolved++;
          }
        }
      }),
    ),
  );

  onProgress?.(
    `Referential resolution complete: ${resolved} resolved, ${unresolved} unresolved out of ${attempts} attempts.`,
  );

  return {
    resolved,
    unresolved,
    attempts,
    usage: totalUsage,
    details,
  };
}
