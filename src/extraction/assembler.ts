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
import { alignExtractionRecords } from "./alignment";

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
  const coverageRecords = alignExtractionRecords(
    documentId,
    "coverage",
    getCoverageLimitCoverages(memory) as Record<string, unknown>[],
    (coverage) => [coverage.name, coverage.formNumber, coverage.pageNumber, coverage.limit, coverage.deductible],
  );
  const endorsementRecords = alignExtractionRecords(
    documentId,
    "endorsement",
    readRecordValue(endorsements, "endorsements") as Record<string, unknown>[] | undefined,
    (endorsement) => [endorsement.formNumber, endorsement.title, endorsement.pageStart],
  );
  const exclusionRecords = alignExtractionRecords(
    documentId,
    "exclusion",
    readRecordValue(exclusions, "exclusions") as Record<string, unknown>[] | undefined,
    (exclusion) => [exclusion.name, exclusion.formNumber, exclusion.pageNumber],
  );
  const conditionRecords = alignExtractionRecords(
    documentId,
    "condition",
    readRecordValue(conditions, "conditions") as Record<string, unknown>[] | undefined,
    (condition) => [condition.name, condition.conditionType, condition.pageNumber],
  );
  const sectionRecords = alignExtractionRecords(
    documentId,
    "section",
    getSections(memory) as Record<string, unknown>[],
    (section) => [section.title, section.type, section.pageStart, section.pageEnd],
  );
  const definitionRecords = alignExtractionRecords(
    documentId,
    "definition",
    getDefinitions(memory) as Record<string, unknown>[],
    (definition) => [definition.term, definition.formNumber, definition.pageNumber],
  );
  const coveredReasonRecords = alignExtractionRecords(
    documentId,
    "covered_reason",
    getCoveredReasons(memory) as Record<string, unknown>[],
    (reason) => [reason.coverageName, reason.reasonNumber, reason.title, reason.pageNumber],
  );

  const base = {
    id: documentId,
    carrier: readRecordValue(carrier, "carrierName") ?? "Unknown",
    insuredName: readRecordValue(insured, "insuredName") ?? "Unknown",
    coverages: coverageRecords,
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
    endorsements: endorsementRecords.length > 0 ? endorsementRecords : undefined,
    exclusions: exclusionRecords.length > 0 ? exclusionRecords : undefined,
    conditions: conditionRecords.length > 0 ? conditionRecords : undefined,
    sections: sectionRecords.length > 0 ? sectionRecords : undefined,
    formInventory: readRecordValue(formInventory, "forms"),
    definitions: definitionRecords.length > 0 ? definitionRecords : undefined,
    coveredReasons: coveredReasonRecords.length > 0 ? coveredReasonRecords : undefined,
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
