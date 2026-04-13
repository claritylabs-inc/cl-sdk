import { z } from "zod";

export const CarrierInfoSchema = z.object({
  carrierName: z.string().describe("Primary insurance company name for display"),
  carrierLegalName: z.string().optional().describe("Legal entity name of insurer"),
  naicNumber: z.string().optional().describe("NAIC company code"),
  amBestRating: z.string().optional().describe("AM Best rating, e.g. 'A+ XV'"),
  admittedStatus: z
    .enum(["admitted", "non_admitted", "surplus_lines"])
    .optional()
    .describe("Admitted status of the carrier"),
  mga: z.string().optional().describe("Managing General Agent or Program Administrator name"),
  underwriter: z.string().optional().describe("Named individual underwriter"),
  brokerAgency: z.string().optional().describe("Broker or producer agency name"),
  brokerContactName: z.string().optional().describe("Broker or producer contact person name"),
  brokerLicenseNumber: z.string().optional().describe("Broker or producer license number"),
  policyNumber: z.string().optional().describe("Policy or quote reference number"),
  effectiveDate: z.string().optional().describe("Policy effective date (MM/DD/YYYY)"),
  expirationDate: z.string().optional().describe("Policy expiration date (MM/DD/YYYY)"),
  quoteNumber: z.string().optional().describe("Quote or proposal reference number"),
  proposedEffectiveDate: z
    .string()
    .optional()
    .describe("Proposed effective date for quotes (MM/DD/YYYY)"),
});

export type CarrierInfoResult = z.infer<typeof CarrierInfoSchema>;

export function buildCarrierInfoPrompt(): string {
  return `You are an expert insurance document analyst. Extract carrier and policy identification information from this document.

Focus on:
- The PRIMARY insurance company name (for display) and its full legal entity name
- NAIC company code and AM Best rating if listed
- Whether the carrier is admitted, non-admitted, or surplus lines
- Managing General Agent (MGA) or Program Administrator if applicable
- Named individual underwriter if listed
- Broker/producer/agent: agency name, contact person name, and license number
- Policy number and effective/expiration dates
- For quotes: quote number and proposed effective date

For carrier vs. security distinction: "carrier" is the primary company name; the legal entity on risk (e.g. "Lloyd's Underwriters") may differ from the display name.

Look for broker/producer/agent information near the carrier or on the declarations page. This may be labeled "Producer", "Agent", "Broker", or similar.

Return JSON only.`;
}
