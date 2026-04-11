import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().optional().describe("Organization or person name"),
  phone: z.string().optional().describe("Phone number"),
  email: z.string().optional().describe("Email address"),
  address: z.string().optional().describe("Mailing address"),
  type: z.string().optional().describe("Contact type, e.g. 'State Department of Insurance'"),
});

export const SupplementarySchema = z.object({
  regulatoryContacts: z
    .array(ContactSchema)
    .optional()
    .describe("Regulatory body contacts (state department of insurance, ombudsman)"),
  claimsContacts: z
    .array(ContactSchema)
    .optional()
    .describe("Claims reporting contacts and instructions"),
  thirdPartyAdministrators: z
    .array(ContactSchema)
    .optional()
    .describe("Third-party administrators for claims handling"),
  cancellationNoticeDays: z
    .number()
    .optional()
    .describe("Required notice period for cancellation in days"),
  nonrenewalNoticeDays: z
    .number()
    .optional()
    .describe("Required notice period for nonrenewal in days"),
});

export type SupplementaryResult = z.infer<typeof SupplementarySchema>;

export function buildSupplementaryPrompt(): string {
  return `You are an expert insurance document analyst. Extract supplementary and regulatory information from this document.

Focus on:
- Regulatory contacts: state department of insurance, regulatory bodies, ombudsman offices — with phone, email, address
- Claims contacts: how to report claims, claims department contact info, hours of operation
- Third-party administrators (TPAs) for claims handling
- Cancellation notice period in days
- Nonrenewal notice period in days
- Complaint filing procedures and contacts
- Governing law or jurisdiction provisions

Look for regulatory notices, complaint contact sections, claims reporting instructions, and cancellation/nonrenewal provisions throughout the document.

Return JSON only.`;
}
