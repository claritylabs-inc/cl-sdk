import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().optional().describe("Organization or person name"),
  phone: z.string().optional().describe("Phone number"),
  email: z.string().optional().describe("Email address"),
  address: z.string().optional().describe("Mailing address"),
  type: z.string().optional().describe("Contact type, e.g. 'State Department of Insurance'"),
});

export const AuxiliaryFactSchema = z.object({
  key: z.string().describe("Normalized machine-readable fact key, e.g. 'policyholder_age' or 'insured_name'"),
  value: z.string().describe("Concrete extracted fact value"),
  subject: z.string().optional().describe("Person, entity, vehicle, property, or schedule item this fact belongs to"),
  context: z.string().optional().describe("Short disambiguating context, such as 'Driver Schedule' or 'Named Insured'"),
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
  auxiliaryFacts: z
    .array(AuxiliaryFactSchema)
    .optional()
    .describe("Additional retrieval-only facts that do not fit the strict primary schema"),
});

export type SupplementaryResult = z.infer<typeof SupplementarySchema>;

export function buildSupplementaryPrompt(): string {
  return `You are an expert insurance document analyst. Extract supplementary, retrieval-only information from this document.

Focus on:
- Regulatory contacts: state department of insurance, regulatory bodies, ombudsman offices — with phone, email, address
- Claims contacts: how to report claims, claims department contact info, hours of operation
- Third-party administrators (TPAs) for claims handling
- Cancellation notice period in days
- Nonrenewal notice period in days
- Complaint filing procedures and contacts
- Governing law or jurisdiction provisions
- Additional policy-specific facts that are useful for memory and retrieval even if they do not belong in the strict primary schema

Look for regulatory notices, complaint contact sections, claims reporting instructions, and cancellation/nonrenewal provisions throughout the document.

For auxiliaryFacts:
- Capture concrete, policy-specific facts as structured key/value pairs.
- Prioritize facts that agents may need later but that are often omitted from strict schemas: policyholder names, insured person names, driver names, ages, dates of birth, marital status, garaging information, lienholders, household members, vehicle assignments, schedule row details, and other discrete identifiers.
- Use short normalized keys like "policyholder_name", "policyholder_age", "insured_name", "driver_age", "driver_date_of_birth", "garaging_zip", "vehicle_principal_driver".
- Use subject when the fact belongs to a specific person, vehicle, property, or scheduled item.
- Do not invent facts.
- Do not include vague boilerplate or generic form language.
- Do not repeat large narrative excerpts; keep facts atomic.

Return JSON only.`;
}
