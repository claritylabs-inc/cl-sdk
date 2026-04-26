import type { PolicyDocument, QuoteDocument, InsuranceDocument } from "../schemas/document";
import { sanitizeNulls } from "../core/sanitize";
import {
  getCarrierInfo,
  getCoverageLimitCoverages,
  getCoverageLimits,
  getCoveredReasons,
  getDefinitions,
  getNamedInsured,
  getSections,
  readMemoryRecord,
  readRecordArray,
  readRecordValue,
} from "./memory";
import { promoteExtractedFields } from "./promote";

/**
 * Assemble extracted results from shared memory into a validated document.
 */
export function assembleDocument(
  documentId: string,
  documentType: "policy" | "quote",
  memory: Map<string, unknown>,
): InsuranceDocument {
  const carrier = getCarrierInfo(memory);
  const insured = getNamedInsured(memory);
  const coverages = getCoverageLimits(memory);
  const endorsements = readMemoryRecord(memory, "endorsements");
  const exclusions = readMemoryRecord(memory, "exclusions");
  const conditions = readMemoryRecord(memory, "conditions");
  const premium = readMemoryRecord(memory, "premium_breakdown");
  const declarations = readMemoryRecord(memory, "declarations");
  const lossHistory = readMemoryRecord(memory, "loss_history");
  const supplementary = readMemoryRecord(memory, "supplementary");
  const formInventory = readMemoryRecord(memory, "form_inventory");
  const classify = readMemoryRecord(memory, "classify");
  const lossPayees = readRecordArray(insured, "lossPayees");
  const mortgageHolders = readRecordArray(insured, "mortgageHolders");

  const base = {
    id: documentId,
    carrier: readRecordValue(carrier, "carrierName") ?? "Unknown",
    insuredName: readRecordValue(insured, "insuredName") ?? "Unknown",
    coverages: getCoverageLimitCoverages(memory),
    policyTypes: readRecordValue(classify, "policyTypes"),
    ...sanitizeNulls(carrier ?? {}),
    ...sanitizeNulls(insured ?? {}),
    // Map named_insured extractor's loss payees/mortgage holders to EndorsementParty shape
    ...(lossPayees && lossPayees.length > 0
      ? { lossPayees: lossPayees.map((lp) => ({ ...(lp as Record<string, unknown>), role: "loss_payee" })) }
      : {}),
    ...(mortgageHolders && mortgageHolders.length > 0
      ? {
          mortgageHolders: mortgageHolders.map((mh) => ({
            ...(mh as Record<string, unknown>),
            role: "mortgage_holder",
          })),
        }
      : {}),
    ...sanitizeNulls(coverages ?? {}),
    ...sanitizeNulls(premium ?? {}),
    ...sanitizeNulls(supplementary ?? {}),
    supplementaryFacts: readRecordValue(supplementary, "auxiliaryFacts"),
    endorsements: readRecordValue(endorsements, "endorsements"),
    exclusions: readRecordValue(exclusions, "exclusions"),
    conditions: readRecordValue(conditions, "conditions"),
    sections: getSections(memory),
    formInventory: readRecordValue(formInventory, "forms"),
    definitions: getDefinitions(memory),
    coveredReasons: getCoveredReasons(memory),
    declarations: declarations ? sanitizeNulls(declarations) : undefined,
    ...sanitizeNulls(lossHistory ?? {}),
  };

  let doc: InsuranceDocument;

  if (documentType === "policy") {
    doc = {
      ...base,
      type: "policy",
      policyNumber: readRecordValue(carrier, "policyNumber") ?? readRecordValue(insured, "policyNumber") ?? "Unknown",
      effectiveDate: readRecordValue(carrier, "effectiveDate") ?? readRecordValue(insured, "effectiveDate") ?? "Unknown",
      expirationDate: readRecordValue(carrier, "expirationDate"),
      policyTermType: readRecordValue(carrier, "policyTermType"),
    } as PolicyDocument;
  } else {
    doc = {
      ...base,
      type: "quote",
      quoteNumber: readRecordValue(carrier, "quoteNumber") ?? "Unknown",
      proposedEffectiveDate: readRecordValue(carrier, "proposedEffectiveDate"),
      proposedExpirationDate: readRecordValue(carrier, "proposedExpirationDate"),
      subjectivities: readRecordValue(coverages, "subjectivities"),
      underwritingConditions: readRecordValue(coverages, "underwritingConditions"),
      premiumBreakdown: readRecordValue(premium, "premiumBreakdown"),
    } as QuoteDocument;
  }

  // Promote declarations → top-level typed fields, fix field name mapping,
  // synthesize limits/deductibles from coverages
  promoteExtractedFields(doc);

  return doc;
}
