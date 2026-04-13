import { ExclusionsSchema } from "../extractors/exclusions";

export { ExclusionsSchema };

export function buildReconcileExclusionsPrompt(exclusionsJson: string): string {
  return `You are reconciling insurance exclusions after a deterministic merge pass.

Your job is to intelligently consolidate exclusions that are actually the same exclusion, or where one entry adds carvebacks, exceptions, narrower applicability, or more precise peril language to another.

Reconciliation rules:
- Combine entries that refer to the same exclusion even if wording differs slightly.
- Preserve distinct exclusions when they come from different forms and are substantively different.
- If any merged entry has an exception or carveback, the merged exclusion must set isAbsolute to false.
- Merge additive fields instead of dropping detail:
  - excludedPerils: union unique items
  - exceptions: union unique items
  - appliesTo: union unique items
- Keep the richer, more complete content text when choosing content.
- Keep formNumber when present.
- Keep the earliest pageNumber when multiple merged entries are combined.
- Do not invent buybacks, endorsements, exceptions, or applicability not supported by the inputs.

Return the reconciled exclusions in the same schema. Output JSON only.

Exclusions to reconcile:
${exclusionsJson}`;
}
