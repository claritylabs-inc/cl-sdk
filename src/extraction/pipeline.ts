/**
 * Multi-pass extraction pipeline for insurance PDFs.
 *
 * Processes documents in up to 4 passes with adaptive fallback:
 *
 * - **Pass 0 (Classification)**: Classification model classifies document as policy or quote.
 * - **Pass 1 (Metadata)**: Metadata model extracts high-level metadata (carrier, dates,
 *   premium, coverages). Supports `onMetadata?()` callback for early persistence
 *   so metadata survives pass 2 failures.
 * - **Pass 2 (Sections)**: Chunked extraction with sections model. Documents are split into
 *   15-page chunks; on JSON parse failure (usually output truncation), re-splits
 *   to 10 -> 5 pages, then falls back to sectionsFallback model. `mergeChunkedSections()` combines.
 * - **Pass 3 (Enrichment)**: Enrichment model enriches supplementary fields (regulatory context,
 *   contacts) from raw text. Non-fatal on failure.
 *
 * Separate entry points exist for policies (`extractFromPdf`) vs quotes
 * (`extractQuoteFromPdf`). `extractSectionsOnly()` retries pass 2 using
 * saved metadata from a prior pass 1.
 *
 * Provider-agnostic: accepts `ModelConfig` with Vercel AI SDK `LanguageModel` instances.
 * Defaults to Anthropic models via `createDefaultModelConfig()`.
 */

import { generateText, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ModelConfig } from "../types/models";
import { createDefaultModelConfig, MODEL_TOKEN_LIMITS } from "../types/models";
import { METADATA_PROMPT, QUOTE_METADATA_PROMPT, CLASSIFY_DOCUMENT_PROMPT, buildSectionsPrompt, buildQuoteSectionsPrompt, buildSupplementaryEnrichmentPrompt, buildPersonalLinesHint } from "../prompts/extraction";
import { extractPageRange, getPdfPageCount } from "./pdf";

export const SONNET_MODEL = "claude-sonnet-4.6";
export const HAIKU_MODEL = "claude-haiku-4.5.20251001";

export type LogFn = (message: string) => Promise<void>;

/** Default provider options for metadata calls (Anthropic thinking). */
const DEFAULT_METADATA_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
};

/** Default provider options for fallback calls (Anthropic thinking). */
const DEFAULT_FALLBACK_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } },
};

/** Maximum number of retries for rate-limited requests. */
const MAX_RETRIES = 5;
/** Base delay in ms for exponential backoff (doubles each retry). */
const BASE_DELAY_MS = 2000;

/** Check if an error is a rate limit error (HTTP 429 or matching message). */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests")) {
      return true;
    }
  }
  if (typeof error === "object" && error !== null) {
    const status = (error as any).status ?? (error as any).statusCode;
    if (status === 429) return true;
  }
  return false;
}

/** Retry a function with exponential backoff on rate limit errors. */
async function withRetry<T>(
  fn: () => Promise<T>,
  log?: LogFn,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const jitter = Math.random() * 1000;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + jitter;
      await log?.(`Rate limited, retrying in ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Concurrency limiter — returns a function that wraps async tasks
 * so at most `concurrency` run simultaneously. No external dependency.
 */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      queue.push(run);
      next();
    });
}

/** Strip markdown code fences from AI response text. */
export function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
}

/**
 * Recursively convert null values to undefined.
 *
 * Required because Convex rejects `null` for optional fields, but Claude
 * routinely returns `null` for missing values in JSON output. Applied to
 * all extraction results before persistence.
 */
export function sanitizeNulls<T>(obj: T): T {
  if (obj === null || obj === undefined) return undefined as any;
  if (Array.isArray(obj)) return obj.map(sanitizeNulls) as any;
  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj as any)) {
      result[key] = sanitizeNulls(value);
    }
    return result;
  }
  return obj;
}

/**
 * Construct a typed Declarations variant from extracted metadata and policyTypes.
 * Returns undefined if the primary line can't be mapped to a known variant.
 */
function buildDeclarations(meta: any, extracted: any): any {
  const policyTypes: string[] = Array.isArray(meta.policyTypes) ? meta.policyTypes : [];
  const primary = policyTypes[0];
  if (!primary) return undefined;

  // Personal lines mapping
  if (primary === "homeowners_ho3" || primary === "homeowners_ho5" || primary === "renters_ho4" || primary === "condo_ho6" || primary === "mobile_home") {
    const formMap: Record<string, string> = {
      homeowners_ho3: "HO-3", homeowners_ho5: "HO-5", renters_ho4: "HO-4",
      condo_ho6: "HO-6", mobile_home: "HO-7",
    };
    return sanitizeNulls({
      line: "homeowners",
      formType: formMap[primary],
      coverageA: meta.coverageA ?? meta.declarations?.coverageA,
      coverageB: meta.coverageB ?? meta.declarations?.coverageB,
      coverageC: meta.coverageC ?? meta.declarations?.coverageC,
      coverageD: meta.coverageD ?? meta.declarations?.coverageD,
      coverageE: meta.coverageE ?? meta.declarations?.coverageE,
      coverageF: meta.coverageF ?? meta.declarations?.coverageF,
      allPerilDeductible: meta.allPerilDeductible ?? meta.declarations?.allPerilDeductible,
      windHailDeductible: meta.windHailDeductible ?? meta.declarations?.windHailDeductible,
      hurricaneDeductible: meta.hurricaneDeductible ?? meta.declarations?.hurricaneDeductible,
      lossSettlement: meta.lossSettlement ?? meta.declarations?.lossSettlement,
      dwelling: meta.dwelling ?? meta.declarations?.dwelling ?? {},
      mortgagee: meta.mortgagee ?? meta.declarations?.mortgagee,
      additionalMortgagees: meta.additionalMortgagees ?? meta.declarations?.additionalMortgagees,
    });
  }

  if (primary === "personal_auto") {
    return sanitizeNulls({
      line: "personal_auto",
      vehicles: meta.vehicles ?? meta.declarations?.vehicles ?? extracted.vehicles ?? [],
      drivers: meta.drivers ?? meta.declarations?.drivers ?? [],
      liabilityLimits: meta.liabilityLimits ?? meta.declarations?.liabilityLimits,
      umLimits: meta.umLimits ?? meta.declarations?.umLimits,
      uimLimits: meta.uimLimits ?? meta.declarations?.uimLimits,
      pipLimit: meta.pipLimit ?? meta.declarations?.pipLimit,
      medPayLimit: meta.medPayLimit ?? meta.declarations?.medPayLimit,
    });
  }

  if (primary === "dwelling_fire") {
    return sanitizeNulls({
      line: "dwelling_fire",
      formType: meta.dwellingFireFormType ?? meta.declarations?.formType ?? "DP-3",
      dwellingLimit: meta.dwellingLimit ?? meta.declarations?.dwellingLimit,
      otherStructuresLimit: meta.otherStructuresLimit ?? meta.declarations?.otherStructuresLimit,
      personalPropertyLimit: meta.personalPropertyLimit ?? meta.declarations?.personalPropertyLimit,
      fairRentalValueLimit: meta.fairRentalValueLimit ?? meta.declarations?.fairRentalValueLimit,
      liabilityLimit: meta.liabilityLimit ?? meta.declarations?.liabilityLimit,
      medicalPaymentsLimit: meta.medicalPaymentsLimit ?? meta.declarations?.medicalPaymentsLimit,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      dwelling: meta.dwelling ?? meta.declarations?.dwelling ?? {},
    });
  }

  if (primary === "flood_nfip" || primary === "flood_private") {
    return sanitizeNulls({
      line: "flood",
      programType: primary === "flood_nfip" ? "nfip" : "private",
      floodZone: meta.floodZone ?? meta.declarations?.floodZone,
      communityNumber: meta.communityNumber ?? meta.declarations?.communityNumber,
      communityRating: meta.communityRating ?? meta.declarations?.communityRating,
      buildingCoverage: meta.buildingCoverage ?? meta.declarations?.buildingCoverage,
      contentsCoverage: meta.contentsCoverage ?? meta.declarations?.contentsCoverage,
      iccCoverage: meta.iccCoverage ?? meta.declarations?.iccCoverage,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      waitingPeriodDays: meta.waitingPeriodDays ?? meta.declarations?.waitingPeriodDays,
      elevationCertificate: meta.elevationCertificate ?? meta.declarations?.elevationCertificate,
      elevationDifference: meta.elevationDifference ?? meta.declarations?.elevationDifference,
      buildingDiagramNumber: meta.buildingDiagramNumber ?? meta.declarations?.buildingDiagramNumber,
      basementOrEnclosure: meta.basementOrEnclosure ?? meta.declarations?.basementOrEnclosure,
      postFirmConstruction: meta.postFirmConstruction ?? meta.declarations?.postFirmConstruction,
    });
  }

  if (primary === "earthquake") {
    return sanitizeNulls({
      line: "earthquake",
      dwellingCoverage: meta.dwellingCoverage ?? meta.declarations?.dwellingCoverage,
      contentsCoverage: meta.contentsCoverage ?? meta.declarations?.contentsCoverage,
      lossOfUseCoverage: meta.lossOfUseCoverage ?? meta.declarations?.lossOfUseCoverage,
      deductiblePercent: meta.deductiblePercent ?? meta.declarations?.deductiblePercent,
      retrofitDiscount: meta.retrofitDiscount ?? meta.declarations?.retrofitDiscount,
      masonryVeneerCoverage: meta.masonryVeneerCoverage ?? meta.declarations?.masonryVeneerCoverage,
    });
  }

  if (primary === "personal_umbrella") {
    return sanitizeNulls({
      line: "personal_umbrella",
      perOccurrenceLimit: meta.perOccurrenceLimit ?? meta.declarations?.perOccurrenceLimit,
      aggregateLimit: meta.aggregateLimit ?? meta.declarations?.aggregateLimit,
      retainedLimit: meta.retainedLimit ?? meta.declarations?.retainedLimit,
      underlyingPolicies: meta.underlyingPolicies ?? meta.declarations?.underlyingPolicies ?? [],
    });
  }

  if (primary === "personal_inland_marine") {
    return sanitizeNulls({
      line: "personal_articles",
      scheduledItems: meta.scheduledItems ?? meta.declarations?.scheduledItems ?? [],
      blanketCoverage: meta.blanketCoverage ?? meta.declarations?.blanketCoverage,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      worldwideCoverage: meta.worldwideCoverage ?? meta.declarations?.worldwideCoverage,
      breakageCoverage: meta.breakageCoverage ?? meta.declarations?.breakageCoverage,
    });
  }

  if (primary === "watercraft") {
    return sanitizeNulls({
      line: "watercraft",
      boatType: meta.boatType ?? meta.declarations?.boatType,
      year: meta.boatYear ?? meta.declarations?.year,
      make: meta.boatMake ?? meta.declarations?.make,
      model: meta.boatModel ?? meta.declarations?.model,
      length: meta.boatLength ?? meta.declarations?.length,
      hullMaterial: meta.hullMaterial ?? meta.declarations?.hullMaterial,
      hullValue: meta.hullValue ?? meta.declarations?.hullValue,
      motorHorsepower: meta.motorHorsepower ?? meta.declarations?.motorHorsepower,
      motorType: meta.motorType ?? meta.declarations?.motorType,
      navigationLimits: meta.navigationLimits ?? meta.declarations?.navigationLimits,
      layupPeriod: meta.layupPeriod ?? meta.declarations?.layupPeriod,
      liabilityLimit: meta.liabilityLimit ?? meta.declarations?.liabilityLimit,
      medicalPaymentsLimit: meta.medicalPaymentsLimit ?? meta.declarations?.medicalPaymentsLimit,
      physicalDamageDeductible: meta.physicalDamageDeductible ?? meta.declarations?.physicalDamageDeductible,
      uninsuredBoaterLimit: meta.uninsuredBoaterLimit ?? meta.declarations?.uninsuredBoaterLimit,
      trailerCovered: meta.trailerCovered ?? meta.declarations?.trailerCovered,
      trailerValue: meta.trailerValue ?? meta.declarations?.trailerValue,
    });
  }

  if (primary === "recreational_vehicle") {
    return sanitizeNulls({
      line: "recreational_vehicle",
      vehicleType: meta.rvType ?? meta.declarations?.vehicleType ?? "other",
      year: meta.rvYear ?? meta.declarations?.year,
      make: meta.rvMake ?? meta.declarations?.make,
      model: meta.rvModel ?? meta.declarations?.model,
      vin: meta.rvVin ?? meta.declarations?.vin,
      value: meta.rvValue ?? meta.declarations?.value,
      liabilityLimit: meta.liabilityLimit ?? meta.declarations?.liabilityLimit,
      collisionDeductible: meta.collisionDeductible ?? meta.declarations?.collisionDeductible,
      comprehensiveDeductible: meta.comprehensiveDeductible ?? meta.declarations?.comprehensiveDeductible,
      personalEffectsCoverage: meta.personalEffectsCoverage ?? meta.declarations?.personalEffectsCoverage,
      fullTimerCoverage: meta.fullTimerCoverage ?? meta.declarations?.fullTimerCoverage,
    });
  }

  if (primary === "farm_ranch") {
    return sanitizeNulls({
      line: "farm_ranch",
      dwellingCoverage: meta.dwellingCoverage ?? meta.declarations?.dwellingCoverage,
      farmPersonalPropertyCoverage: meta.farmPersonalPropertyCoverage ?? meta.declarations?.farmPersonalPropertyCoverage,
      farmLiabilityLimit: meta.farmLiabilityLimit ?? meta.declarations?.farmLiabilityLimit,
      farmAutoIncluded: meta.farmAutoIncluded ?? meta.declarations?.farmAutoIncluded,
      livestock: meta.livestock ?? meta.declarations?.livestock,
      equipmentSchedule: meta.equipmentSchedule ?? meta.declarations?.equipmentSchedule,
      acreage: meta.acreage ?? meta.declarations?.acreage,
      dwelling: meta.dwelling ?? meta.declarations?.dwelling,
    });
  }

  if (primary === "pet") {
    return sanitizeNulls({
      line: "pet",
      species: meta.species ?? meta.declarations?.species ?? "other",
      breed: meta.breed ?? meta.declarations?.breed,
      petName: meta.petName ?? meta.declarations?.petName,
      age: meta.petAge ?? meta.declarations?.age,
      annualLimit: meta.annualLimit ?? meta.declarations?.annualLimit,
      perIncidentLimit: meta.perIncidentLimit ?? meta.declarations?.perIncidentLimit,
      deductible: meta.deductible ?? meta.declarations?.deductible,
      reimbursementPercent: meta.reimbursementPercent ?? meta.declarations?.reimbursementPercent,
      waitingPeriodDays: meta.waitingPeriodDays ?? meta.declarations?.waitingPeriodDays,
      preExistingConditionsExcluded: meta.preExistingConditionsExcluded ?? meta.declarations?.preExistingConditionsExcluded,
      wellnessCoverage: meta.wellnessCoverage ?? meta.declarations?.wellnessCoverage,
    });
  }

  if (primary === "travel") {
    return sanitizeNulls({
      line: "travel",
      tripDepartureDate: meta.tripDepartureDate ?? meta.declarations?.tripDepartureDate,
      tripReturnDate: meta.tripReturnDate ?? meta.declarations?.tripReturnDate,
      destinations: meta.destinations ?? meta.declarations?.destinations,
      travelers: meta.travelers ?? meta.declarations?.travelers,
      tripCost: meta.tripCost ?? meta.declarations?.tripCost,
      tripCancellationLimit: meta.tripCancellationLimit ?? meta.declarations?.tripCancellationLimit,
      medicalLimit: meta.medicalLimit ?? meta.declarations?.medicalLimit,
      evacuationLimit: meta.evacuationLimit ?? meta.declarations?.evacuationLimit,
      baggageLimit: meta.baggageLimit ?? meta.declarations?.baggageLimit,
    });
  }

  if (primary === "identity_theft") {
    return sanitizeNulls({
      line: "identity_theft",
      coverageLimit: meta.coverageLimit ?? meta.declarations?.coverageLimit,
      expenseReimbursement: meta.expenseReimbursement ?? meta.declarations?.expenseReimbursement,
      creditMonitoring: meta.creditMonitoring ?? meta.declarations?.creditMonitoring,
      restorationServices: meta.restorationServices ?? meta.declarations?.restorationServices,
      lostWagesLimit: meta.lostWagesLimit ?? meta.declarations?.lostWagesLimit,
    });
  }

  if (primary === "title") {
    return sanitizeNulls({
      line: "title",
      policyType: meta.titlePolicyType ?? meta.declarations?.policyType ?? "owners",
      policyAmount: meta.titlePolicyAmount ?? meta.declarations?.policyAmount ?? "",
      legalDescription: meta.legalDescription ?? meta.declarations?.legalDescription,
      propertyAddress: meta.propertyAddress ?? meta.declarations?.propertyAddress,
      effectiveDate: meta.titleEffectiveDate ?? meta.declarations?.effectiveDate,
      exceptions: meta.exceptions ?? meta.declarations?.exceptions,
      underwriter: meta.titleUnderwriter ?? meta.declarations?.underwriter,
    });
  }

  // Commercial lines mapping
  if (primary === "general_liability") {
    return sanitizeNulls({
      line: "gl",
      coverageForm: meta.coverageForm ?? extracted.coverageForm,
      perOccurrenceLimit: extracted.limits?.perOccurrence,
      generalAggregate: extracted.limits?.generalAggregate,
      productsCompletedOpsAggregate: extracted.limits?.productsCompletedOpsAggregate,
      personalAdvertisingInjury: extracted.limits?.personalAdvertisingInjury,
      fireDamage: extracted.limits?.fireDamage,
      medicalExpense: extracted.limits?.medicalExpense,
      defenseCostTreatment: extracted.limits?.defenseCostTreatment,
      deductible: extracted.deductibles?.perOccurrence,
      classifications: extracted.classifications,
      retroactiveDate: meta.retroactiveDate,
    });
  }

  if (primary === "commercial_property" || primary === "property") {
    return sanitizeNulls({
      line: "commercial_property",
      locations: extracted.locations ?? [],
      blanketLimit: meta.blanketLimit,
      businessIncomeLimit: meta.businessIncomeLimit,
      extraExpenseLimit: meta.extraExpenseLimit,
    });
  }

  if (primary === "commercial_auto") {
    return sanitizeNulls({
      line: "commercial_auto",
      vehicles: extracted.vehicles ?? [],
      liabilityLimit: extracted.limits?.combinedSingleLimit ?? extracted.limits?.perOccurrence,
      umLimit: meta.umLimit,
      uimLimit: meta.uimLimit,
    });
  }

  if (primary === "workers_comp") {
    return sanitizeNulls({
      line: "workers_comp",
      classifications: extracted.classifications ?? [],
      experienceMod: extracted.experienceMod,
      employersLiability: extracted.limits?.employersLiability,
    });
  }

  if (primary === "umbrella" || primary === "excess_liability") {
    return sanitizeNulls({
      line: "umbrella_excess",
      perOccurrenceLimit: extracted.limits?.eachOccurrenceUmbrella ?? extracted.limits?.perOccurrence,
      aggregateLimit: extracted.limits?.umbrellaAggregate ?? extracted.limits?.generalAggregate,
      retention: extracted.limits?.umbrellaRetention ?? extracted.deductibles?.selfInsuredRetention,
      underlyingPolicies: meta.underlyingPolicies ?? [],
    });
  }

  if (primary === "professional_liability") {
    return sanitizeNulls({
      line: "professional_liability",
      perClaimLimit: extracted.limits?.perOccurrence,
      aggregateLimit: extracted.limits?.generalAggregate,
      retroactiveDate: meta.retroactiveDate,
      defenseCostTreatment: extracted.limits?.defenseCostTreatment,
    });
  }

  if (primary === "cyber") {
    return sanitizeNulls({
      line: "cyber",
      aggregateLimit: extracted.limits?.generalAggregate ?? extracted.limits?.perOccurrence,
      retroactiveDate: meta.retroactiveDate,
    });
  }

  if (primary === "directors_officers") {
    return sanitizeNulls({
      line: "directors_officers",
      sideALimit: meta.sideALimit,
      sideBLimit: meta.sideBLimit,
      sideCLimit: meta.sideCLimit,
    });
  }

  if (primary === "crime_fidelity") {
    return sanitizeNulls({
      line: "crime",
      agreements: meta.agreements ?? [],
    });
  }

  return undefined;
}

/** Map raw Claude extraction JSON to mutation-compatible fields. */
export function applyExtracted(extracted: any) {
  const meta = extracted.metadata ?? extracted;

  const policyTypes = Array.isArray(meta.policyTypes)
    ? meta.policyTypes
    : meta.policyType
      ? [meta.policyType]
      : ["other"];

  const fields: any = {
    carrier: meta.carrier || meta.security || "Unknown",
    security: meta.security ?? undefined,
    underwriter: meta.underwriter ?? undefined,
    mga: meta.mga ?? undefined,
    broker: meta.broker ?? undefined,
    policyNumber: meta.policyNumber || "Unknown",
    policyTypes,
    documentType: (meta.documentType === "quote" ? "quote" : "policy") as "policy" | "quote",
    policyYear: meta.policyYear || new Date().getFullYear(),
    effectiveDate: meta.effectiveDate || "Unknown",
    expirationDate: meta.expirationDate || "Unknown",
    isRenewal: meta.isRenewal ?? false,
    coverages: sanitizeNulls(extracted.coverages || meta.coverages || []),
    premium: meta.premium ?? undefined,
    insuredName: meta.insuredName || "Unknown",
    summary: meta.summary ?? undefined,
    metadataSource: extracted.metadataSource ? sanitizeNulls(extracted.metadataSource) : undefined,
    document: extracted.document ? sanitizeNulls(extracted.document) : undefined,
    extractionStatus: "complete" as const,
    extractionError: "",
  };

  // Enriched metadata fields (v1.2+)
  if (extracted.metadata?.carrierLegalName) fields.carrierLegalName = extracted.metadata.carrierLegalName;
  if (extracted.metadata?.carrierNaicNumber) fields.carrierNaicNumber = extracted.metadata.carrierNaicNumber;
  if (extracted.metadata?.carrierAmBestRating) fields.carrierAmBestRating = extracted.metadata.carrierAmBestRating;
  if (extracted.metadata?.carrierAdmittedStatus) fields.carrierAdmittedStatus = extracted.metadata.carrierAdmittedStatus;
  if (extracted.metadata?.mga) fields.mga = extracted.metadata.mga;
  if (extracted.metadata?.underwriter) fields.underwriter = extracted.metadata.underwriter;
  if (extracted.metadata?.brokerAgency ?? extracted.metadata?.broker) fields.brokerAgency = extracted.metadata.brokerAgency ?? extracted.metadata.broker;
  if (extracted.metadata?.brokerContactName) fields.brokerContactName = extracted.metadata.brokerContactName;
  if (extracted.metadata?.brokerLicenseNumber) fields.brokerLicenseNumber = extracted.metadata.brokerLicenseNumber;
  if (extracted.metadata?.priorPolicyNumber) fields.priorPolicyNumber = extracted.metadata.priorPolicyNumber;
  if (extracted.metadata?.programName) fields.programName = extracted.metadata.programName;
  if (extracted.metadata?.isRenewal != null) fields.isRenewal = extracted.metadata.isRenewal;
  if (extracted.metadata?.isPackage != null) fields.isPackage = extracted.metadata.isPackage;
  if (extracted.metadata?.coverageForm) fields.coverageForm = extracted.metadata.coverageForm;
  if (extracted.metadata?.retroactiveDate) fields.retroactiveDate = extracted.metadata.retroactiveDate;
  if (extracted.metadata?.effectiveTime) fields.effectiveTime = extracted.metadata.effectiveTime;
  if (extracted.metadata?.insuredDba) fields.insuredDba = extracted.metadata.insuredDba;
  if (extracted.metadata?.insuredAddress) fields.insuredAddress = extracted.metadata.insuredAddress;
  if (extracted.metadata?.insuredEntityType) fields.insuredEntityType = extracted.metadata.insuredEntityType;
  if (extracted.metadata?.insuredFein) fields.insuredFein = extracted.metadata.insuredFein;
  if (extracted.additionalNamedInsureds?.length) fields.additionalNamedInsureds = extracted.additionalNamedInsureds;
  if (extracted.limits) fields.limits = extracted.limits;
  if (extracted.deductibles) fields.deductibles = extracted.deductibles;
  if (extracted.locations?.length) fields.locations = extracted.locations;
  if (extracted.vehicles?.length) fields.vehicles = extracted.vehicles;
  if (extracted.classifications?.length) fields.classifications = extracted.classifications;
  if (extracted.formInventory?.length) fields.formInventory = extracted.formInventory;
  if (extracted.taxesAndFees?.length) fields.taxesAndFees = extracted.taxesAndFees;

  // Construct typed declarations (v1.3+)
  const declarations = buildDeclarations(meta, extracted);
  if (declarations) fields.declarations = declarations;

  return fields;
}

/**
 * Merge document sections from chunked extraction passes.
 *
 * Combines sections from all chunks into a single array and takes the last
 * non-null value for supplementary fields (regulatoryContext, complaintContact,
 * costsAndFees, claimsContact) since these typically appear only once.
 */
export function mergeChunkedSections(
  metadataResult: any,
  sectionChunks: any[],
): any {
  const allSections: any[] = [];
  let regulatoryContext: any = null;
  let complaintContact: any = null;
  let costsAndFees: any = null;
  let claimsContact: any = null;

  // Merge structured endorsements, exclusions, conditions from all chunks
  const allEndorsements: any[] = [];
  const allExclusions: any[] = [];
  const allPolicyConditions: any[] = [];

  for (const chunk of sectionChunks) {
    if (chunk.sections) {
      allSections.push(...chunk.sections);
    }
    if (chunk.regulatoryContext) regulatoryContext = chunk.regulatoryContext;
    if (chunk.complaintContact) complaintContact = chunk.complaintContact;
    if (chunk.costsAndFees) costsAndFees = chunk.costsAndFees;
    if (chunk.claimsContact) claimsContact = chunk.claimsContact;
    if (chunk.endorsements?.length) allEndorsements.push(...chunk.endorsements);
    if (chunk.exclusions?.length) allExclusions.push(...chunk.exclusions);
    if (chunk.conditions?.length) allPolicyConditions.push(...chunk.conditions);
  }

  const result = {
    metadata: metadataResult.metadata,
    metadataSource: metadataResult.metadataSource,
    coverages: metadataResult.coverages,
    document: {
      sections: allSections,
      ...(regulatoryContext && { regulatoryContext }),
      ...(complaintContact && { complaintContact }),
      ...(costsAndFees && { costsAndFees }),
      ...(claimsContact && { claimsContact }),
    } as any,
    totalPages: metadataResult.totalPages,
  };

  if (allEndorsements.length) result.document.endorsements = allEndorsements;
  if (allExclusions.length) result.document.exclusions = allExclusions;
  if (allPolicyConditions.length) result.document.conditions = allPolicyConditions;

  return result;
}

/** Determine page ranges for chunked extraction. */
export function getPageChunks(totalPages: number, chunkSize: number = 30): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  for (let start = 1; start <= totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalPages);
    chunks.push([start, end]);
  }
  return chunks;
}

/**
 * Call a model with a PDF document and prompt via Vercel AI SDK.
 * Retries automatically on rate limit errors with exponential backoff.
 *
 * @param pageRange - Optional [startPage, endPage] (1-indexed) to trim the PDF
 *   before sending, reducing input token count for large documents.
 */
async function callModel(
  model: LanguageModel,
  pdfBase64: string,
  prompt: string,
  maxTokens: number,
  providerOptions?: ProviderOptions,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
  pageRange?: [number, number],
): Promise<string> {
  // Trim PDF to page range if specified
  const pdfToSend = pageRange
    ? await extractPageRange(pdfBase64, pageRange[0], pageRange[1])
    : pdfBase64;

  const rangeLabel = pageRange ? ` [pages ${pageRange[0]}–${pageRange[1]}]` : "";
  await log?.(`Calling model (max ${maxTokens} tokens)${rangeLabel}...`);
  const start = Date.now();

  const { text, usage } = await withRetry(
    () => generateText({
      model,
      maxOutputTokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "file", data: pdfToSend, mediaType: "application/pdf" },
          { type: "text", text: prompt },
        ],
      }],
      ...(providerOptions ? { providerOptions } : {}),
    }),
    log,
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  await log?.(`${inputTokens} in / ${outputTokens} out tokens (${elapsed}s)`);
  onTokenUsage?.({ inputTokens, outputTokens });

  return text || "{}";
}

/**
 * Call a model with text-only prompt (no PDF) via Vercel AI SDK.
 * Used for pass 3 enrichment. Retries on rate limit errors.
 */
async function callModelText(
  model: LanguageModel,
  prompt: string,
  maxTokens: number,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  await log?.(`Calling model text-only (max ${maxTokens} tokens)...`);
  const start = Date.now();

  const { text, usage } = await withRetry(
    () => generateText({
      model,
      maxOutputTokens: maxTokens,
      messages: [{
        role: "user",
        content: prompt,
      }],
    }),
    log,
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  await log?.(`text: ${inputTokens} in / ${outputTokens} out tokens (${elapsed}s)`);
  onTokenUsage?.({ inputTokens, outputTokens });

  return text || "{}";
}

/** Resolve models, lazily creating defaults if not provided. */
function resolveModels(models?: ModelConfig): ModelConfig {
  return models ?? createDefaultModelConfig();
}

/**
 * Pass 3: Enrich supplementary fields with structured data.
 * Text-only enrichment call — non-fatal on failure (returns document unchanged).
 */
export async function enrichSupplementaryFields(
  document: any,
  models?: ModelConfig,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
): Promise<any> {
  const fields: Record<string, string> = {};
  if (document.regulatoryContext?.content) {
    fields.regulatoryContext = document.regulatoryContext.content;
  }
  if (document.complaintContact?.content) {
    fields.complaintContact = document.complaintContact.content;
  }
  if (document.costsAndFees?.content) {
    fields.costsAndFees = document.costsAndFees.content;
  }
  if (document.claimsContact?.content) {
    fields.claimsContact = document.claimsContact.content;
  }

  if (Object.keys(fields).length === 0) {
    await log?.("Pass 3: No supplementary fields to enrich, skipping.");
    return document;
  }

  await log?.(`Pass 3: Enriching ${Object.keys(fields).length} supplementary field(s)...`);

  try {
    const resolved = resolveModels(models);
    const prompt = buildSupplementaryEnrichmentPrompt(fields);
    const raw = await callModelText(resolved.enrichment, prompt, MODEL_TOKEN_LIMITS.enrichment, log, onTokenUsage);
    const parsed = JSON.parse(stripFences(raw));

    const enriched = { ...document };

    if (parsed.regulatoryContext && enriched.regulatoryContext) {
      enriched.regulatoryContext = {
        ...enriched.regulatoryContext,
        ...sanitizeNulls(parsed.regulatoryContext),
      };
    }
    if (parsed.complaintContact && enriched.complaintContact) {
      enriched.complaintContact = {
        ...enriched.complaintContact,
        ...sanitizeNulls(parsed.complaintContact),
      };
    }
    if (parsed.costsAndFees && enriched.costsAndFees) {
      enriched.costsAndFees = {
        ...enriched.costsAndFees,
        ...sanitizeNulls(parsed.costsAndFees),
      };
    }
    if (parsed.claimsContact && enriched.claimsContact) {
      enriched.claimsContact = {
        ...enriched.claimsContact,
        ...sanitizeNulls(parsed.claimsContact),
      };
    }

    await log?.("Pass 3: Supplementary enrichment complete.");
    return enriched;
  } catch (e: any) {
    await log?.(`Pass 3: Enrichment failed (non-fatal): ${e.message}`);
    return document;
  }
}

export interface ClassifyOptions {
  log?: LogFn;
  models?: ModelConfig;
  /** Called after each model call with token usage for tracking. */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Pass 0: Classify document as policy or quote.
 */
export async function classifyDocumentType(
  pdfBase64: string,
  options?: ClassifyOptions,
): Promise<{ documentType: "policy" | "quote"; confidence: number; signals: string[] }> {
  const { log, models, onTokenUsage } = options ?? {};
  const resolved = resolveModels(models);
  await log?.("Pass 0: Classifying document type...");
  const raw = await callModel(
    resolved.classification, pdfBase64, CLASSIFY_DOCUMENT_PROMPT,
    MODEL_TOKEN_LIMITS.classification, undefined, log, onTokenUsage,
    [1, 3], // Only need first 3 pages for classification
  );
  try {
    const parsed = JSON.parse(stripFences(raw));
    const documentType = parsed.documentType === "quote" ? "quote" : "policy";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const signals = Array.isArray(parsed.signals) ? parsed.signals : [];
    await log?.(`Pass 0: Classified as "${documentType}" (confidence: ${confidence.toFixed(2)}, signals: ${signals.join(", ")})`);
    return { documentType, confidence, signals };
  } catch {
    await log?.("Pass 0: Classification parse failed, defaulting to policy");
    return { documentType: "policy", confidence: 0, signals: ["parse_failed"] };
  }
}

/** Map raw Claude quote extraction JSON to mutation-compatible fields. */
export function applyExtractedQuote(extracted: any) {
  const meta = extracted.metadata ?? extracted;

  const policyTypes = Array.isArray(meta.policyTypes)
    ? meta.policyTypes
    : ["other"];

  const fields: any = {
    carrier: meta.carrier || meta.security || "Unknown",
    security: meta.security ?? undefined,
    underwriter: meta.underwriter ?? undefined,
    mga: meta.mga ?? undefined,
    broker: meta.broker ?? undefined,
    quoteNumber: meta.quoteNumber || meta.policyNumber || "Unknown",
    policyTypes,
    quoteYear: meta.quoteYear || meta.policyYear || new Date().getFullYear(),
    proposedEffectiveDate: meta.proposedEffectiveDate || meta.effectiveDate || undefined,
    proposedExpirationDate: meta.proposedExpirationDate || meta.expirationDate || undefined,
    quoteExpirationDate: meta.quoteExpirationDate ?? undefined,
    isRenewal: meta.isRenewal ?? false,
    coverages: sanitizeNulls(
      (extracted.coverages || meta.coverages || []).map((c: any) => ({
        name: c.name,
        proposedLimit: c.proposedLimit || c.limit || "N/A",
        proposedDeductible: c.proposedDeductible || c.deductible,
        pageNumber: c.pageNumber,
        sectionRef: c.sectionRef,
      }))
    ),
    premium: meta.premium ?? undefined,
    premiumBreakdown: sanitizeNulls(extracted.premiumBreakdown || meta.premiumBreakdown) ?? undefined,
    insuredName: meta.insuredName || "Unknown",
    summary: meta.summary ?? undefined,
    subjectivities: sanitizeNulls(extracted.subjectivities || meta.subjectivities) ?? undefined,
    underwritingConditions: sanitizeNulls(extracted.underwritingConditions || meta.underwritingConditions) ?? undefined,
    metadataSource: extracted.metadataSource ? sanitizeNulls(extracted.metadataSource) : undefined,
    document: extracted.document ? sanitizeNulls(extracted.document) : undefined,
    extractionStatus: "complete" as const,
    extractionError: "",
  };

  // Enriched quote fields (v1.2+)
  if (meta.carrierLegalName) fields.carrierLegalName = meta.carrierLegalName;
  if (meta.carrierNaicNumber) fields.carrierNaicNumber = meta.carrierNaicNumber;
  if (meta.carrierAdmittedStatus) fields.carrierAdmittedStatus = meta.carrierAdmittedStatus;
  if (meta.coverageForm) fields.coverageForm = meta.coverageForm;
  if (meta.retroactiveDate) fields.retroactiveDate = meta.retroactiveDate;
  if (meta.insuredAddress) fields.insuredAddress = meta.insuredAddress;
  if (extracted.limits) fields.limits = extracted.limits;
  if (extracted.deductibles) fields.deductibles = extracted.deductibles;
  if (extracted.warrantyRequirements?.length) fields.warrantyRequirements = extracted.warrantyRequirements;
  if (extracted.taxesAndFees?.length) fields.taxesAndFees = extracted.taxesAndFees;

  // Map enriched subjectivities
  if (extracted.subjectivities?.length) {
    fields.enrichedSubjectivities = extracted.subjectivities.map((s: any) => ({
      description: s.description,
      category: s.category ?? undefined,
      dueDate: s.dueDate ?? undefined,
      pageNumber: s.pageNumber ?? undefined,
    }));
  }

  // Map enriched underwriting conditions
  if (extracted.underwritingConditions?.length) {
    fields.enrichedUnderwritingConditions = extracted.underwritingConditions.map((c: any) => ({
      description: c.description,
      category: c.category ?? undefined,
      pageNumber: c.pageNumber ?? undefined,
    }));
  }

  // Construct typed declarations (v1.3+)
  const declarations = buildDeclarations(meta, extracted);
  if (declarations) fields.declarations = declarations;

  return fields;
}

/**
 * Merge document sections from chunked quote extraction passes.
 *
 * Similar to `mergeChunkedSections` but also accumulates quote-specific
 * fields: subjectivities and underwriting conditions from all chunks.
 */
export function mergeChunkedQuoteSections(
  metadataResult: any,
  sectionChunks: any[],
): any {
  const allSections: any[] = [];
  const allSubjectivities: any[] = metadataResult.subjectivities || [];
  const allConditions: any[] = metadataResult.underwritingConditions || [];

  const allExclusions: any[] = [];

  for (const chunk of sectionChunks) {
    if (chunk.sections) {
      allSections.push(...chunk.sections);
    }
    if (chunk.subjectivities) {
      allSubjectivities.push(...chunk.subjectivities);
    }
    if (chunk.underwritingConditions) {
      allConditions.push(...chunk.underwritingConditions);
    }
    if (chunk.exclusions?.length) {
      allExclusions.push(...chunk.exclusions);
    }
  }

  const result = {
    metadata: metadataResult.metadata,
    metadataSource: metadataResult.metadataSource,
    coverages: metadataResult.coverages,
    premiumBreakdown: metadataResult.premiumBreakdown,
    subjectivities: allSubjectivities.length > 0 ? allSubjectivities : undefined,
    underwritingConditions: allConditions.length > 0 ? allConditions : undefined,
    document: {
      sections: allSections,
    } as any,
    totalPages: metadataResult.totalPages,
  };

  if (allExclusions.length) result.document.exclusions = allExclusions;

  return result;
}

/** Chunk sizes to try in order — progressively smaller to avoid output token limits. */
const CHUNK_SIZES = [15, 10, 5];

export type PromptBuilder = (pageStart: number, pageEnd: number) => string;

/**
 * Extract sections from a single page range with recursive retry.
 *
 * Strategy: attempt sections model first. On JSON parse failure (typically output
 * truncation), re-split the range into smaller sub-chunks using the next size
 * in `CHUNK_SIZES` [15, 10, 5] and retry recursively. After exhausting all
 * smaller sizes, falls back to sectionsFallback model with higher token limit.
 */
async function extractChunkWithRetry(
  models: ModelConfig,
  pdfBase64: string,
  start: number,
  end: number,
  sizeIndex: number,
  promptBuilder: PromptBuilder,
  fallbackProviderOptions?: ProviderOptions,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
  concurrency: number = 2,
): Promise<any[]> {
  await log?.(`Pass 2: Extracting sections pages ${start}–${end}...`);
  const chunkRaw = await callModel(
    models.sections, pdfBase64, promptBuilder(start, end),
    MODEL_TOKEN_LIMITS.sections, undefined, log, onTokenUsage,
    [start, end], // Only send this chunk's pages
  );
  try {
    return [JSON.parse(stripFences(chunkRaw))];
  } catch {
    // Try re-splitting into smaller sub-chunks
    const nextSizeIndex = sizeIndex + 1;
    if (nextSizeIndex < CHUNK_SIZES.length) {
      const smallerSize = CHUNK_SIZES[nextSizeIndex];
      const pageSpan = end - start + 1;
      if (pageSpan > smallerSize) {
        await log?.(`Truncated pages ${start}–${end}, re-splitting into ${smallerSize}-page chunks...`);
        const subChunks = getPageChunks(pageSpan, smallerSize).map(
          ([s, e]) => [s + start - 1, e + start - 1] as [number, number],
        );
        const limit = pLimit(concurrency);
        const nestedResults = await Promise.all(
          subChunks.map(([subStart, subEnd]) =>
            limit(() => extractChunkWithRetry(
              models, pdfBase64, subStart, subEnd, nextSizeIndex,
              promptBuilder, fallbackProviderOptions, log, onTokenUsage, concurrency,
            ))
          ),
        );
        return nestedResults.flat();
      }
    }

    // All smaller sizes exhausted — fall back to sectionsFallback model
    await log?.(`Sections model exhausted for pages ${start}–${end}, falling back...`);
    const fallbackRaw = await callModel(
      models.sectionsFallback, pdfBase64, promptBuilder(start, end),
      MODEL_TOKEN_LIMITS.sectionsFallback, fallbackProviderOptions, log, onTokenUsage,
      [start, end], // Only send this chunk's pages
    );
    try {
      return [JSON.parse(stripFences(fallbackRaw))];
    } catch (e2: any) {
      const preview = fallbackRaw.slice(0, 200);
      await log?.(`Failed to parse sections JSON (fallback): ${preview}`);
      throw new Error(`Sections JSON parse failed: ${e2.message}`);
    }
  }
}

/**
 * Extract sections from page chunks with adaptive re-splitting and fallback.
 */
async function extractSectionChunks(
  models: ModelConfig,
  pdfBase64: string,
  pageCount: number,
  promptBuilder: PromptBuilder = buildSectionsPrompt,
  fallbackProviderOptions?: ProviderOptions,
  log?: LogFn,
  onTokenUsage?: (usage: TokenUsage) => void,
  concurrency: number = 2,
): Promise<any[]> {
  const chunks = getPageChunks(pageCount, CHUNK_SIZES[0]);
  const limit = pLimit(concurrency);

  const nestedResults = await Promise.all(
    chunks.map(([start, end]) =>
      limit(() => extractChunkWithRetry(
        models, pdfBase64, start, end, 0, promptBuilder,
        fallbackProviderOptions, log, onTokenUsage, concurrency,
      ))
    ),
  );

  return nestedResults.flat();
}

/** Token usage reported per model call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ExtractOptions {
  log?: LogFn;
  onMetadata?: (raw: string) => Promise<void>;
  models?: ModelConfig;
  /** Provider-specific options for metadata calls (e.g. Anthropic thinking). Defaults to Anthropic thinking enabled. */
  metadataProviderOptions?: ProviderOptions;
  /** Provider-specific options for fallback calls. Defaults to Anthropic thinking enabled. */
  fallbackProviderOptions?: ProviderOptions;
  /** Maximum number of chunk extractions to run in parallel (default: 2). */
  concurrency?: number;
  /** Called after each model call with token usage for tracking. */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Full extraction pipeline for policy documents (passes 1 through 3).
 *
 * - **Pass 1**: Metadata model extracts metadata, coverages, and page count.
 * - **Pass 2**: Sections model extracts sections in chunks (with adaptive retry and fallback).
 * - **Pass 3**: Enrichment model enriches supplementary fields (non-fatal).
 *
 * @param pdfBase64 - Base64-encoded PDF document.
 * @param options - Extraction options (models, logging, callbacks, provider options).
 */
export async function extractFromPdf(
  pdfBase64: string,
  options?: ExtractOptions,
) {
  const {
    log,
    onMetadata,
    models,
    metadataProviderOptions = DEFAULT_METADATA_PROVIDER_OPTIONS,
    fallbackProviderOptions = DEFAULT_FALLBACK_PROVIDER_OPTIONS,
    concurrency = 2,
    onTokenUsage,
  } = options ?? {};
  const resolved = resolveModels(models);

  // Get actual page count for smart page trimming
  const actualPageCount = await getPdfPageCount(pdfBase64);

  // Pass 1: Metadata extraction (first 10 pages contain declarations, schedule, coverages)
  await log?.("Pass 1: Extracting metadata...");
  const metadataPageRange: [number, number] = [1, Math.min(10, actualPageCount)];
  const metadataRaw = await callModel(
    resolved.metadata, pdfBase64, METADATA_PROMPT,
    MODEL_TOKEN_LIMITS.metadata, metadataProviderOptions, log, onTokenUsage,
    metadataPageRange,
  );

  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    const preview = metadataRaw.slice(0, 200);
    await log?.(`Failed to parse metadata JSON: ${preview}`);
    throw new Error(`Metadata JSON parse failed: ${e.message}`);
  }

  // Persist metadata early so it survives pass 2 failures
  await onMetadata?.(metadataRaw);

  // Use actual page count (metadata may report wrong count)
  const pageCount = actualPageCount;
  await log?.(`Document: ${pageCount} page(s)`);

  // Pass 2: Sections (chunked, with fallback)
  const sectionChunks = await extractSectionChunks(
    resolved, pdfBase64, pageCount, buildSectionsPrompt,
    fallbackProviderOptions, log, onTokenUsage, concurrency,
  );

  await log?.("Merging extraction results...");
  const merged = mergeChunkedSections(metadataResult, sectionChunks);

  // Pass 3: Enrich supplementary fields (non-fatal)
  if (merged.document) {
    merged.document = await enrichSupplementaryFields(merged.document, resolved, log, onTokenUsage);
  }

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

export interface ExtractSectionsOptions {
  log?: LogFn;
  promptBuilder?: PromptBuilder;
  models?: ModelConfig;
  /** Provider-specific options for fallback calls. */
  fallbackProviderOptions?: ProviderOptions;
  /** Maximum number of chunk extractions to run in parallel (default: 2). */
  concurrency?: number;
  /** Called after each model call with token usage for tracking. */
  onTokenUsage?: (usage: TokenUsage) => void;
}

/**
 * Sections-only extraction: skip pass 1, use saved metadata.
 * For retrying when metadata succeeded but sections failed.
 */
export async function extractSectionsOnly(
  pdfBase64: string,
  metadataRaw: string,
  options?: ExtractSectionsOptions,
) {
  const {
    log,
    promptBuilder = buildSectionsPrompt,
    models,
    fallbackProviderOptions = DEFAULT_FALLBACK_PROVIDER_OPTIONS,
    concurrency = 2,
    onTokenUsage,
  } = options ?? {};
  const resolved = resolveModels(models);

  await log?.("Using saved metadata, skipping pass 1...");
  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    throw new Error(`Saved metadata JSON parse failed: ${e.message}`);
  }

  const pageCount = metadataResult.totalPages || 1;
  await log?.(`Document: ${pageCount} page(s)`);

  const sectionChunks = await extractSectionChunks(
    resolved, pdfBase64, pageCount, promptBuilder,
    fallbackProviderOptions, log, onTokenUsage, concurrency,
  );

  await log?.("Merging extraction results...");
  const merged = mergeChunkedSections(metadataResult, sectionChunks);

  // Pass 3: Enrich supplementary fields (non-fatal)
  if (merged.document) {
    merged.document = await enrichSupplementaryFields(merged.document, resolved, log, onTokenUsage);
  }

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}

/**
 * Full extraction pipeline for quote documents (passes 1 through 2).
 *
 * - **Pass 1**: Metadata model extracts quote-specific metadata (proposed dates,
 *   subjectivities, premium breakdown).
 * - **Pass 2**: Sections model extracts sections in chunks (with adaptive retry).
 *
 * Does not run pass 3 enrichment (quotes rarely have supplementary fields).
 *
 * @param pdfBase64 - Base64-encoded PDF document.
 * @param options - Extraction options (models, logging, callbacks, provider options).
 */
export async function extractQuoteFromPdf(
  pdfBase64: string,
  options?: ExtractOptions,
) {
  const {
    log,
    onMetadata,
    models,
    metadataProviderOptions = DEFAULT_METADATA_PROVIDER_OPTIONS,
    fallbackProviderOptions = DEFAULT_FALLBACK_PROVIDER_OPTIONS,
    concurrency = 2,
    onTokenUsage,
  } = options ?? {};
  const resolved = resolveModels(models);

  // Get actual page count for smart page trimming
  const actualPageCount = await getPdfPageCount(pdfBase64);

  // Pass 1: Quote metadata (first 10 pages contain key quote info)
  await log?.("Pass 1: Extracting quote metadata...");
  const metadataPageRange: [number, number] = [1, Math.min(10, actualPageCount)];
  const metadataRaw = await callModel(
    resolved.metadata, pdfBase64, QUOTE_METADATA_PROMPT,
    MODEL_TOKEN_LIMITS.metadata, metadataProviderOptions, log, onTokenUsage,
    metadataPageRange,
  );

  let metadataResult: any;
  try {
    metadataResult = JSON.parse(stripFences(metadataRaw));
  } catch (e: any) {
    const preview = metadataRaw.slice(0, 200);
    await log?.(`Failed to parse quote metadata JSON: ${preview}`);
    throw new Error(`Quote metadata JSON parse failed: ${e.message}`);
  }

  // Persist metadata early
  await onMetadata?.(metadataRaw);

  // Use actual page count (metadata may report wrong count)
  const pageCount = actualPageCount;
  await log?.(`Quote document: ${pageCount} page(s)`);

  // Pass 2: Quote sections (chunked)
  const sectionChunks = await extractSectionChunks(
    resolved, pdfBase64, pageCount, buildQuoteSectionsPrompt,
    fallbackProviderOptions, log, onTokenUsage, concurrency,
  );

  await log?.("Merging quote extraction results...");
  const merged = mergeChunkedQuoteSections(metadataResult, sectionChunks);

  const mergedRaw = JSON.stringify(merged);
  return { rawText: mergedRaw, extracted: merged };
}
