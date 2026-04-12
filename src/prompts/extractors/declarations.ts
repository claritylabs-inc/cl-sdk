import { z } from "zod";

export const DeclarationsExtractSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "Flexible declarations data — structure varies by line of business. Keys are descriptive field names, values are the extracted data.",
  );

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

Use descriptive field names as keys. Preserve original values exactly as they appear.

Return JSON only.`;
}
