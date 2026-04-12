import { z } from "zod";

export const EndorsementsSchema = z.object({
  endorsements: z
    .array(
      z.object({
        formNumber: z.string().optional().describe("Form number, e.g. 'CG 21 47'"),
        title: z.string().optional().describe("Endorsement title"),
        type: z
          .enum(["broadening", "restrictive", "informational"])
          .optional()
          .describe("Effect type: broadening adds coverage, restrictive limits it"),
        content: z.string().optional().describe("Full verbatim text of the endorsement"),
        effectiveDate: z.string().optional().describe("Endorsement effective date"),
        premium: z.string().optional().describe("Additional premium or credit"),
        parties: z
          .array(z.string())
          .optional()
          .describe("Named parties (additional insureds, loss payees, etc.)"),
      }),
    )
    .describe("All endorsements found in the document"),
});

export type EndorsementsResult = z.infer<typeof EndorsementsSchema>;

export function buildEndorsementsPrompt(): string {
  return `You are an expert insurance document analyst. Extract ALL endorsements from this document. Preserve original language verbatim.

Focus on:
- Every endorsement listed in the forms schedule or endorsement schedule
- Standalone endorsements modifying the base policy
- Form number and edition date (e.g. "CG 21 47 12 07")
- Endorsement title and full verbatim content
- Effect type: "broadening" if it adds or expands coverage, "restrictive" if it limits or excludes coverage, "informational" if it changes administrative terms only
- Additional premium or credit shown on the endorsement
- Named parties: additional insureds, loss payees, certificate holders, mortgagees

PERSONAL LINES ENDORSEMENT RECOGNITION:
- HO 04 XX series: homeowners endorsements
- PP 03 XX series: personal auto endorsements
- HO 17 XX series: mobilehome endorsements
- DP 04 XX series: dwelling fire endorsements

Return JSON only.`;
}
