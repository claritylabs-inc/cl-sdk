import { z } from "zod";
import { FormReferenceSchema } from "../../schemas/shared";

/**
 * Extends the canonical FormReferenceSchema with extraction-time descriptions.
 * The base shape (formNumber, editionDate, title, formType, pageStart, pageEnd)
 * comes from FormReferenceSchema so the inventory output is directly assignable
 * to the document's formInventory field.
 */
export const FormInventoryEntrySchema = FormReferenceSchema.extend({
  formNumber: FormReferenceSchema.shape.formNumber.describe("Form number or identifier, e.g. PR5070CF"),
  pageStart: FormReferenceSchema.shape.pageStart.describe("Original document page where the form begins"),
  pageEnd: FormReferenceSchema.shape.pageEnd.describe("Original document page where the form ends"),
});

export const FormInventorySchema = z.object({
  forms: z.array(FormInventoryEntrySchema),
});

export type FormInventoryEntry = z.infer<typeof FormInventoryEntrySchema>;
export type FormInventoryResult = z.infer<typeof FormInventorySchema>;

export function buildFormInventoryPrompt(templateHints: string): string {
  return `You are building a form inventory for an insurance document.

DOCUMENT TYPE HINTS:
${templateHints}

Extract every distinct declarations page set, policy form, coverage form, endorsement, application form, and notice form that appears in the document.

For EACH form, extract:
- formNumber: REQUIRED when present
- editionDate: if shown
- title: if shown
- formType: one of coverage, endorsement, declarations, application, notice, other
- pageStart: original page where the form begins
- pageEnd: original page where the form ends

Critical rules:
- Include declarations page sets even if they do not show a standard form number.
- Do not classify policy jackets, claim-reporting notices, privacy notices, OFAC notices, terrorism/TRIA notices, sanctions notices, signatures, countersignatures, or marketing/admin pages as declarations when they are only administrative content.
- Declarations pages contain policy-specific schedules such as named insured, policy number, policy period, premium, limits, retentions, coverage parts, or forms-and-endorsements schedules.
- Declarations pages may be internally itemized as "Item 1.", "Item 2.", etc. Keep the whole itemized declarations set together, including continuation pages for coverage schedules, premium, ERP options, producer information, and forms or endorsements attached at inception.
- A page that lists declaration items or form/endorsement schedules remains part of the declarations set even if the bottom of that page also contains countersignature, authorized-representative, or policy-execution language.
- When "Forms and Endorsements Attached at Inception" or similar form schedules continue onto the next page, extend the declarations pageEnd through that continuation instead of treating the continuation as a standalone signature page.
- Use original document page numbers, not local chunk page numbers.
- Do not emit duplicate entries for repeated headers/footers.
- Multi-page forms should be represented once with pageStart/pageEnd covering the full span when visible.
- If a form number is visible in endorsements, schedules, or form headers, include it even if the full form title is partial.

Respond with JSON only.`;
}
