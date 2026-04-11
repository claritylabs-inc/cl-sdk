import type { PolicyDocument, QuoteDocument, InsuranceDocument } from "../schemas/document";
import { sanitizeNulls } from "../core/sanitize";

/**
 * Assemble extracted results from shared memory into a validated document.
 */
export function assembleDocument(
  documentId: string,
  documentType: "policy" | "quote",
  memory: Map<string, unknown>,
): InsuranceDocument {
  const carrier = memory.get("carrier_info") as Record<string, unknown> | undefined;
  const insured = memory.get("named_insured") as Record<string, unknown> | undefined;
  const coverages = memory.get("coverage_limits") as Record<string, unknown> | undefined;
  const endorsements = memory.get("endorsements") as Record<string, unknown> | undefined;
  const exclusions = memory.get("exclusions") as Record<string, unknown> | undefined;
  const conditions = memory.get("conditions") as Record<string, unknown> | undefined;
  const premium = memory.get("premium_breakdown") as Record<string, unknown> | undefined;
  const declarations = memory.get("declarations") as Record<string, unknown> | undefined;
  const lossHistory = memory.get("loss_history") as Record<string, unknown> | undefined;
  const sections = memory.get("sections") as Record<string, unknown> | undefined;
  const supplementary = memory.get("supplementary") as Record<string, unknown> | undefined;
  const classify = memory.get("classify") as Record<string, unknown> | undefined;

  const base = {
    id: documentId,
    carrier: (carrier as any)?.carrierName ?? "Unknown",
    insuredName: (insured as any)?.insuredName ?? "Unknown",
    coverages: (coverages as any)?.coverages ?? [],
    policyTypes: (classify as any)?.policyTypes,
    ...sanitizeNulls(carrier ?? {}),
    ...sanitizeNulls(insured ?? {}),
    ...sanitizeNulls(coverages ?? {}),
    ...sanitizeNulls(premium ?? {}),
    ...sanitizeNulls(supplementary ?? {}),
    endorsements: (endorsements as any)?.endorsements,
    exclusions: (exclusions as any)?.exclusions,
    conditions: (conditions as any)?.conditions,
    sections: (sections as any)?.sections,
    declarations: declarations ? sanitizeNulls(declarations) : undefined,
    ...sanitizeNulls(lossHistory ?? {}),
  };

  if (documentType === "policy") {
    return {
      ...base,
      type: "policy",
      policyNumber: (carrier as any)?.policyNumber ?? (insured as any)?.policyNumber ?? "Unknown",
      effectiveDate: (carrier as any)?.effectiveDate ?? (insured as any)?.effectiveDate ?? "Unknown",
      expirationDate: (carrier as any)?.expirationDate,
      policyTermType: (carrier as any)?.policyTermType,
    } as PolicyDocument;
  }

  return {
    ...base,
    type: "quote",
    quoteNumber: (carrier as any)?.quoteNumber ?? "Unknown",
    proposedEffectiveDate: (carrier as any)?.proposedEffectiveDate,
    proposedExpirationDate: (carrier as any)?.proposedExpirationDate,
    subjectivities: (coverages as any)?.subjectivities,
    underwritingConditions: (coverages as any)?.underwritingConditions,
    premiumBreakdown: (premium as any)?.premiumBreakdown,
  } as QuoteDocument;
}
