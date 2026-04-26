import { z } from "zod";

export const ExtractionTaskSchema = z.object({
  extractorName: z.string(),
  startPage: z.number(),
  endPage: z.number(),
  description: z.string(),
});

export const PageMapEntrySchema = z.object({
  section: z.string(),
  pages: z.string(),
});

export const ExtractionPlanSchema = z.object({
  tasks: z.array(ExtractionTaskSchema),
  pageMap: z.array(PageMapEntrySchema).optional(),
});

export type ExtractionTask = z.infer<typeof ExtractionTaskSchema>;
export type ExtractionPlan = z.infer<typeof ExtractionPlanSchema>;
