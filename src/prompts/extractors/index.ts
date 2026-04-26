import type { ZodSchema } from "zod";

import { buildCarrierInfoPrompt, CarrierInfoSchema } from "./carrier-info";
import { buildNamedInsuredPrompt, NamedInsuredSchema } from "./named-insured";
import { buildCoverageLimitsPrompt, CoverageLimitsSchema } from "./coverage-limits";
import { buildEndorsementsPrompt, EndorsementsSchema } from "./endorsements";
import { buildExclusionsPrompt, ExclusionsSchema } from "./exclusions";
import { buildConditionsPrompt, ConditionsSchema } from "./conditions";
import { buildPremiumBreakdownPrompt, PremiumBreakdownSchema } from "./premium-breakdown";
import { buildDeclarationsPrompt, DeclarationsExtractSchema } from "./declarations";
import { buildLossHistoryPrompt, LossHistorySchema } from "./loss-history";
import { buildSectionsPrompt, SectionsSchema } from "./sections";
import { buildSupplementaryPrompt, SupplementarySchema } from "./supplementary";
import { buildDefinitionsPrompt, DefinitionsSchema } from "./definitions";
import { buildCoveredReasonsPrompt, CoveredReasonsSchema } from "./covered-reasons";

export interface ExtractorDef {
  buildPrompt: () => string;
  schema: ZodSchema;
  maxTokens?: number;
  fallback?: FocusedExtractorFallback;
}

export interface FocusedExtractorFallback {
  extractorName: string;
  isEmpty: (data: unknown) => boolean;
  deriveFocusedResult: (fallbackData: unknown) => unknown | undefined;
}

function asRecord(data: unknown): Record<string, unknown> | undefined {
  return data && typeof data === "object" ? data as Record<string, unknown> : undefined;
}

function getSections(data: unknown): Array<Record<string, unknown>> {
  const sections = asRecord(data)?.sections;
  return Array.isArray(sections) ? sections as Array<Record<string, unknown>> : [];
}

function isCoveredReasonsEmpty(data: unknown): boolean {
  const record = asRecord(data);
  if (!record) return true;
  const coveredReasons = Array.isArray(record.coveredReasons)
    ? record.coveredReasons
    : Array.isArray(record.covered_reasons)
      ? record.covered_reasons
      : [];
  return coveredReasons.length === 0;
}

function isDefinitionsEmpty(data: unknown): boolean {
  const definitions = asRecord(data)?.definitions;
  return !Array.isArray(definitions) || definitions.length === 0;
}

function sectionLooksLikeCoveredReason(section: Record<string, unknown>): boolean {
  const type = String(section.type ?? "").toLowerCase();
  const title = String(section.title ?? "").toLowerCase();
  return type === "covered_reason"
    || title.includes("covered cause")
    || title.includes("covered reason")
    || title.includes("covered peril")
    || title.includes("named peril")
    || title.includes("insuring agreement");
}

function deriveCoveredReasonsFromSections(data: unknown): unknown | undefined {
  const coveredReasons = getSections(data)
    .filter(sectionLooksLikeCoveredReason)
    .map((section) => ({
      coverageName: String(section.coverageName ?? section.formTitle ?? section.title ?? "Covered Reasons"),
      title: typeof section.title === "string" ? section.title : undefined,
      content: String(section.content ?? ""),
      pageNumber: typeof section.pageStart === "number" ? section.pageStart : undefined,
      formNumber: typeof section.formNumber === "string" ? section.formNumber : undefined,
      formTitle: typeof section.formTitle === "string" ? section.formTitle : undefined,
      sectionRef: typeof section.sectionNumber === "string" ? section.sectionNumber : undefined,
      originalContent: typeof section.content === "string" ? section.content.slice(0, 500) : undefined,
    }))
    .filter((coveredReason) => coveredReason.content.trim().length > 0);

  return coveredReasons.length > 0 ? { coveredReasons } : undefined;
}

function deriveDefinitionsFromSections(data: unknown): unknown | undefined {
  const definitions = getSections(data)
    .filter((section) => String(section.type ?? "").toLowerCase() === "definition")
    .map((section) => ({
      term: String(section.title ?? "Definitions"),
      definition: String(section.content ?? ""),
      pageNumber: typeof section.pageStart === "number" ? section.pageStart : undefined,
      formNumber: typeof section.formNumber === "string" ? section.formNumber : undefined,
      formTitle: typeof section.formTitle === "string" ? section.formTitle : undefined,
      sectionRef: typeof section.sectionNumber === "string" ? section.sectionNumber : undefined,
      originalContent: typeof section.content === "string" ? section.content.slice(0, 500) : undefined,
    }))
    .filter((definition) => definition.definition.trim().length > 0);

  return definitions.length > 0 ? { definitions } : undefined;
}

const EXTRACTORS: Record<string, ExtractorDef> = {
  carrier_info: { buildPrompt: buildCarrierInfoPrompt, schema: CarrierInfoSchema, maxTokens: 2048 },
  named_insured: { buildPrompt: buildNamedInsuredPrompt, schema: NamedInsuredSchema, maxTokens: 2048 },
  coverage_limits: { buildPrompt: buildCoverageLimitsPrompt, schema: CoverageLimitsSchema, maxTokens: 8192 },
  endorsements: { buildPrompt: buildEndorsementsPrompt, schema: EndorsementsSchema, maxTokens: 8192 },
  exclusions: { buildPrompt: buildExclusionsPrompt, schema: ExclusionsSchema, maxTokens: 4096 },
  conditions: { buildPrompt: buildConditionsPrompt, schema: ConditionsSchema, maxTokens: 4096 },
  premium_breakdown: { buildPrompt: buildPremiumBreakdownPrompt, schema: PremiumBreakdownSchema, maxTokens: 4096 },
  declarations: { buildPrompt: buildDeclarationsPrompt, schema: DeclarationsExtractSchema, maxTokens: 8192 },
  loss_history: { buildPrompt: buildLossHistoryPrompt, schema: LossHistorySchema, maxTokens: 4096 },
  sections: { buildPrompt: buildSectionsPrompt, schema: SectionsSchema, maxTokens: 8192 },
  supplementary: { buildPrompt: buildSupplementaryPrompt, schema: SupplementarySchema, maxTokens: 2048 },
  definitions: {
    buildPrompt: buildDefinitionsPrompt,
    schema: DefinitionsSchema,
    maxTokens: 8192,
    fallback: {
      extractorName: "sections",
      isEmpty: isDefinitionsEmpty,
      deriveFocusedResult: deriveDefinitionsFromSections,
    },
  },
  covered_reasons: {
    buildPrompt: buildCoveredReasonsPrompt,
    schema: CoveredReasonsSchema,
    maxTokens: 8192,
    fallback: {
      extractorName: "sections",
      isEmpty: isCoveredReasonsEmpty,
      deriveFocusedResult: deriveCoveredReasonsFromSections,
    },
  },
};

export function getExtractor(name: string): ExtractorDef | undefined {
  return EXTRACTORS[name];
}

export function formatExtractorCatalogForPrompt(): string {
  return Object.entries(EXTRACTORS)
    .map(([name, extractor]) => {
      const fallback = extractor.fallback
        ? `; fallback: ${extractor.fallback.extractorName}`
        : "";
      return `- ${name} (maxTokens: ${extractor.maxTokens ?? 4096}${fallback})`;
    })
    .join("\n");
}

export * from "./carrier-info";
export * from "./named-insured";
export * from "./coverage-limits";
export * from "./endorsements";
export * from "./exclusions";
export * from "./conditions";
export * from "./premium-breakdown";
export * from "./declarations";
export * from "./loss-history";
export * from "./sections";
export * from "./supplementary";
export * from "./definitions";
export * from "./covered-reasons";
