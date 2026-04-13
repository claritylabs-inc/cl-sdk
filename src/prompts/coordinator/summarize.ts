import { z } from "zod";
import type { InsuranceDocument } from "../../schemas/document";

export const SummaryResultSchema = z.object({
  summary: z.string().describe("A 1-3 sentence overview of this insurance document"),
});

export type SummaryResult = z.infer<typeof SummaryResultSchema>;

/**
 * Build a prompt for generating a concise document summary from assembled extraction data.
 * This runs post-assembly, so it gets a structured JSON snapshot of the document.
 */
export function buildSummaryPrompt(doc: InsuranceDocument): string {
  // Build a concise snapshot of the key fields for the model
  const snapshot: Record<string, unknown> = {
    type: doc.type,
    carrier: doc.carrier,
    insuredName: doc.insuredName,
    policyTypes: doc.policyTypes,
    premium: doc.premium,
    coverageCount: doc.coverages?.length ?? 0,
  };

  if (doc.type === "policy") {
    snapshot.policyNumber = doc.policyNumber;
    snapshot.effectiveDate = doc.effectiveDate;
    snapshot.expirationDate = doc.expirationDate;
  } else {
    snapshot.quoteNumber = doc.quoteNumber;
    snapshot.proposedEffectiveDate = doc.proposedEffectiveDate;
  }

  const raw = doc as Record<string, unknown>;
  if (raw.limits) snapshot.limits = raw.limits;
  if (raw.deductibles) snapshot.deductibles = raw.deductibles;
  if (raw.brokerAgency) snapshot.brokerAgency = raw.brokerAgency;
  if (doc.endorsements?.length) snapshot.endorsementCount = doc.endorsements.length;
  if (doc.exclusions?.length) snapshot.exclusionCount = doc.exclusions.length;

  // Include top 5 coverage names
  if (doc.coverages?.length) {
    snapshot.topCoverages = doc.coverages.slice(0, 5).map((c) => c.name);
  }

  return `You are an expert insurance document analyst. Generate a brief summary of this insurance document.

Write 1-3 sentences that capture the essential facts a broker or underwriter would want at a glance:
- Who is insured and by whom
- What type of policy/quote and the key coverages
- Policy period and premium if available
- Any notable features (high limits, unusual exclusions, etc.)

Document data:
${JSON.stringify(snapshot, null, 2)}

Return JSON only with a "summary" field.`;
}
