import { z } from "zod";

export const ExclusionSchema = z.object({
  name: z.string(),
  formNumber: z.string().optional(),
  excludedPerils: z.array(z.string()).optional(),
  isAbsolute: z.boolean().optional(),
  exceptions: z.array(z.string()).optional(),
  buybackAvailable: z.boolean().optional(),
  buybackEndorsement: z.string().optional(),
  appliesTo: z.array(z.string()).optional(),
  content: z.string(),
  pageNumber: z.number().optional(),
});
export type Exclusion = z.infer<typeof ExclusionSchema>;
