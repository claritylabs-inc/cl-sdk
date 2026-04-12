import { z } from "zod";

export const DeclarationsFieldSchema = z.object({
  field: z.string().describe("Descriptive field name (e.g. 'policyNumber', 'effectiveDate', 'coverageALimit')"),
  value: z.string().describe("Extracted value exactly as it appears in the document"),
  section: z.string().optional().describe("Section or grouping this field belongs to (e.g. 'Coverage Limits', 'Vehicle Schedule')"),
});

export const DeclarationsExtractSchema = z.object({
  fields: z
    .array(DeclarationsFieldSchema)
    .describe("All declarations page fields extracted as key-value pairs. Structure varies by line of business."),
});

export type DeclarationsExtractResult = z.infer<typeof DeclarationsExtractSchema>;

export function buildDeclarationsPrompt(): string {
  return `You are an expert insurance document analyst. Extract all declarations page data from this document into a flexible key-value structure.

Declarations pages vary significantly by line of business. Extract ALL fields found, including but not limited to:
- Named insured and mailing address
- Policy number, effective/expiration dates, policy period
- Coverage limits and deductibles summary
- Premium summary
- Forms and endorsements schedule
- Locations or premises schedule
- Vehicle schedule (auto policies)
- Classification and rating schedule
- Mortgage/lienholder information
- Prior policy number (renewals)
- Agent/broker information
- Loss payees and additional interests

For PERSONAL LINES declarations:
- Homeowners (HO): Coverage A through F limits, dwelling details (construction, year built, roof), loss settlement, mortgagee
- Personal Auto (PAP): per-vehicle coverages, driver list, vehicle schedule with VINs
- Flood (NFIP): flood zone, community number, building/contents coverage
- Personal Articles: scheduled items list with appraised values

Return each field as an object with "field" (descriptive name), "value" (exact text from document), and optional "section" (grouping).

Example output:
{
  "fields": [
    { "field": "policyNumber", "value": "GL-2025-78432", "section": "Policy Info" },
    { "field": "effectiveDate", "value": "04/10/2025", "section": "Policy Info" },
    { "field": "eachOccurrenceLimit", "value": "$1,000,000", "section": "Coverage Limits" }
  ]
}

Preserve original values exactly as they appear. Return JSON only.`;
}
