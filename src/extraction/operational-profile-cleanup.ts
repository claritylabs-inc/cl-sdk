import { z } from "zod";
import type {
  DocumentSourceNode,
  OperationalCoverageLine,
  OperationalCoverageTerm,
  PolicyOperationalProfile,
} from "../source";
import { PolicyOperationalProfileSchema } from "../source";

export const OPERATIONAL_COVERAGE_TERM_KINDS = [
  "each_claim_limit",
  "each_occurrence_limit",
  "each_loss_limit",
  "aggregate_limit",
  "sublimit",
  "retention",
  "deductible",
  "retroactive_date",
  "premium",
  "other",
] as const;

export const OperationalCoverageTermKindSchema = z.enum(OPERATIONAL_COVERAGE_TERM_KINDS);

export const OperationalProfileCleanupSchema = z.object({
  coverageDecisions: z.array(z.object({
    coverageIndex: z.number().int().nonnegative(),
    action: z.enum(["keep", "drop", "update"]),
    reason: z.string().optional(),
    name: z.string().optional(),
    limit: z.string().nullable().optional(),
    deductible: z.string().nullable().optional(),
    premium: z.string().nullable().optional(),
    retroactiveDate: z.string().nullable().optional(),
    coverageOrigin: z.enum(["core", "endorsement"]).optional(),
    sourceNodeIds: z.array(z.string()).optional(),
    sourceSpanIds: z.array(z.string()).optional(),
    termDecisions: z.array(z.object({
      termIndex: z.number().int().nonnegative(),
      action: z.enum(["keep", "drop", "update"]),
      reason: z.string().optional(),
      kind: OperationalCoverageTermKindSchema.optional(),
      label: z.string().optional(),
      value: z.string().optional(),
      amount: z.number().nullable().optional(),
      appliesTo: z.string().nullable().optional(),
      sourceNodeIds: z.array(z.string()).optional(),
      sourceSpanIds: z.array(z.string()).optional(),
    })).optional(),
  })).default([]),
  warnings: z.array(z.string()).default([]),
});

export type OperationalProfileCleanup = z.infer<typeof OperationalProfileCleanupSchema>;
type CoverageCleanupDecision = OperationalProfileCleanup["coverageDecisions"][number];
type TermCleanupDecision = NonNullable<CoverageCleanupDecision["termDecisions"]>[number];

function compactNode(node: DocumentSourceNode, maxText = 700) {
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    path: node.path,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    sourceSpanIds: node.sourceSpanIds.slice(0, 8),
    text: (node.textExcerpt ?? node.description).slice(0, maxText),
  };
}

function compactCoverageForCleanup(coverage: OperationalCoverageLine, coverageIndex: number) {
  return {
    coverageIndex,
    name: coverage.name,
    limit: coverage.limit,
    deductible: coverage.deductible,
    premium: coverage.premium,
    retroactiveDate: coverage.retroactiveDate,
    coverageOrigin: coverage.coverageOrigin,
    sourceNodeIds: coverage.sourceNodeIds,
    sourceSpanIds: coverage.sourceSpanIds,
    terms: coverage.limits.map((term, termIndex) => ({
      termIndex,
      kind: term.kind,
      label: term.label,
      value: term.value,
      amount: term.amount,
      appliesTo: term.appliesTo,
      sourceNodeIds: term.sourceNodeIds,
      sourceSpanIds: term.sourceSpanIds,
    })),
  };
}

export function buildOperationalProfileCleanupPrompt(
  sourceTree: DocumentSourceNode[],
  profile: PolicyOperationalProfile,
): string {
  const nodes = sourceTree
    .filter((node) => node.kind !== "document")
    .slice(0, 320)
    .map((node) => compactNode(node, node.kind === "page" ? 900 : 700));
  const candidate = {
    documentType: profile.documentType,
    policyTypes: profile.policyTypes,
    coverageTypes: profile.coverageTypes,
    coverages: profile.coverages.map(compactCoverageForCleanup),
  };

  return `Review and clean a source-backed operational profile projection for an insurance policy.

Task:
- Inspect the candidate coverage projection against the source nodes.
- Return cleanup decisions only for coverage rows or terms that are malformed, unsupported, mismatched, or misleading.
- If the projection is already acceptable, return an empty coverageDecisions array.

Projection defects to look for:
- Generic labels such as "Column 3" that should be renamed from nearby row/header evidence.
- Declaration or section headers projected as coverage names when the row evidence is actually a specific coverage, sub-limit, deductible, retention, retroactive date, or premium.
- Dangling continuation punctuation such as a trailing "/" copied into values.
- Item references such as "shown in Item 7" or bare item numbers treated as money amounts.
- Policy wording, exclusions, or unsupported prose copied into operational limit/deductible fields.
- Header/value splits where "Limit of Liability", "Deductible", "Retroactive Date", "Aggregate", "Each Claim", or similar terms are attached to the wrong coverage row.
- Repeated schedule headings projected as separate coverages when they only introduce the next coverage group.

Rules:
- Use internal reasoning, but return JSON decisions only.
- Do not invent policy facts. Keep, drop, or update only existing coverageIndex and termIndex entries.
- Use sourceNodeIds and sourceSpanIds only from the provided source nodes or from the existing candidate entry.
- Prefer dropping a malformed fact over speculative rewriting.
- Keep a coverage when it is a real operational coverage/benefit even if only one term needs cleanup.
- When changing a term's semantic meaning, set kind to the corrected normalized term kind.
- Do not add new coverage rows or new terms; this pass cleans the existing projection.
- Keep reasons concise and factual.

Candidate projection:
${JSON.stringify(candidate, null, 2)}

Source nodes:
${JSON.stringify(nodes, null, 2)}

Return JSON with coverageDecisions and warnings only.`;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function cleanProfileValue(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/\s+\/\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;#-]+|[\s;,.]+$/g, "")
    .trim();
  return cleaned || undefined;
}

function validIds(ids: readonly string[] | undefined, valid: Set<string>): string[] {
  return uniqueStrings((ids ?? []).filter((id) => valid.has(id)));
}

function cleanupIds(ids: readonly string[] | undefined, valid: Set<string>, fallback: readonly string[]): string[] {
  if (ids === undefined) return validIds(fallback, valid);
  const next = validIds(ids, valid);
  return next.length > 0 ? next : validIds(fallback, valid);
}

function amountFromOperationalValue(value: string): number | undefined {
  const match = value.match(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/)
    ?? value.match(/\b([0-9][0-9,]*(?:\.\d+)?)\s*%/);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function normalizedTermText(term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">): string {
  return `${term.kind} ${term.label} ${term.value}`.toLowerCase();
}

function isLimitTerm(term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">): boolean {
  return ["each_claim_limit", "each_occurrence_limit", "each_loss_limit", "aggregate_limit", "sublimit"].includes(term.kind)
    || (term.kind === "other" && /\b(limit|aggregate|claim|occurrence|loss|proceeding)\b/i.test(normalizedTermText(term)));
}

function isDeductibleTerm(term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">): boolean {
  return term.kind === "deductible" || term.kind === "retention" || /\b(deductible|retention|sir)\b/i.test(normalizedTermText(term));
}

function isPremiumTerm(term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">): boolean {
  return term.kind === "premium" || /\bpremium\b/i.test(normalizedTermText(term));
}

function isRetroactiveDateTerm(term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">): boolean {
  return term.kind === "retroactive_date" || /\bretroactive\b/i.test(normalizedTermText(term));
}

function primaryLimitFromTerms(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find(isLimitTerm)?.value;
}

function deductibleFromTerms(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find(isDeductibleTerm)?.value;
}

function premiumFromTerms(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find(isPremiumTerm)?.value;
}

function retroactiveDateFromTerms(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find(isRetroactiveDateTerm)?.value;
}

function termDecisionTouches(
  coverage: OperationalCoverageLine,
  decision: TermCleanupDecision,
  predicate: (term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">) => boolean,
): boolean {
  const existing = coverage.limits[decision.termIndex];
  if (existing && predicate(existing)) return true;
  if (!decision.kind && !decision.label && !decision.value) return false;
  return predicate({
    kind: decision.kind ?? existing?.kind ?? "other",
    label: cleanProfileValue(decision.label) ?? existing?.label ?? "",
    value: cleanProfileValue(decision.value) ?? existing?.value ?? "",
  });
}

function applyTermCleanupDecision(
  term: OperationalCoverageTerm,
  decision: TermCleanupDecision | undefined,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): OperationalCoverageTerm | undefined {
  if (!decision || decision.action === "keep") return term;
  if (decision.action === "drop") return undefined;

  const label = cleanProfileValue(decision.label) ?? term.label;
  const value = cleanProfileValue(decision.value) ?? term.value;
  if (!label || !value) return term;

  const next: OperationalCoverageTerm = {
    ...term,
    kind: decision.kind ?? term.kind,
    label,
    value,
    sourceNodeIds: cleanupIds(decision.sourceNodeIds, validNodeIds, term.sourceNodeIds),
    sourceSpanIds: cleanupIds(decision.sourceSpanIds, validSpanIds, term.sourceSpanIds),
  };
  if (next.sourceNodeIds.length === 0 && next.sourceSpanIds.length === 0) return term;

  if (hasOwn(decision, "amount")) {
    if (typeof decision.amount === "number" && Number.isFinite(decision.amount)) next.amount = decision.amount;
    else delete next.amount;
  } else if (decision.value || decision.kind) {
    const amount = next.kind === "retroactive_date" ? undefined : amountFromOperationalValue(next.value);
    if (amount === undefined) delete next.amount;
    else next.amount = amount;
  }

  if (hasOwn(decision, "appliesTo")) {
    const appliesTo = cleanProfileValue(decision.appliesTo);
    if (appliesTo) next.appliesTo = appliesTo;
    else delete next.appliesTo;
  }

  return next;
}

function termDecisionsTouch(
  coverage: OperationalCoverageLine,
  decisions: TermCleanupDecision[],
  predicate: (term: Pick<OperationalCoverageTerm, "kind" | "label" | "value">) => boolean,
): boolean {
  return decisions
    .filter((decision) => decision.action !== "keep")
    .some((decision) => termDecisionTouches(coverage, decision, predicate));
}

function applyCoverageCleanupDecision(
  coverage: OperationalCoverageLine,
  decision: CoverageCleanupDecision | undefined,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): OperationalCoverageLine | undefined {
  if (!decision || decision.action === "keep") return coverage;
  if (decision.action === "drop") return undefined;

  const next: OperationalCoverageLine = {
    ...coverage,
    limits: [...coverage.limits],
    sourceNodeIds: cleanupIds(decision.sourceNodeIds, validNodeIds, coverage.sourceNodeIds),
    sourceSpanIds: cleanupIds(decision.sourceSpanIds, validSpanIds, coverage.sourceSpanIds),
  };

  const name = cleanProfileValue(decision.name);
  if (name) next.name = name;
  if (decision.coverageOrigin) next.coverageOrigin = decision.coverageOrigin;

  if (hasOwn(decision, "limit")) {
    const value = cleanProfileValue(decision.limit);
    if (value) next.limit = value;
    else delete next.limit;
  }
  if (hasOwn(decision, "deductible")) {
    const value = cleanProfileValue(decision.deductible);
    if (value) next.deductible = value;
    else delete next.deductible;
  }
  if (hasOwn(decision, "premium")) {
    const value = cleanProfileValue(decision.premium);
    if (value) next.premium = value;
    else delete next.premium;
  }
  if (hasOwn(decision, "retroactiveDate")) {
    const value = cleanProfileValue(decision.retroactiveDate);
    if (value) next.retroactiveDate = value;
    else delete next.retroactiveDate;
  }

  const termDecisions = (decision.termDecisions ?? []).filter((termDecision) => termDecision.termIndex < coverage.limits.length);
  const termDecisionByIndex = new Map(termDecisions.map((termDecision) => [termDecision.termIndex, termDecision]));
  next.limits = coverage.limits
    .map((term, index) => applyTermCleanupDecision(term, termDecisionByIndex.get(index), validNodeIds, validSpanIds))
    .filter((term): term is OperationalCoverageTerm => Boolean(term));

  if (termDecisions.length > 0) {
    if (!hasOwn(decision, "limit") && termDecisionsTouch(coverage, termDecisions, isLimitTerm)) {
      const value = primaryLimitFromTerms(next.limits);
      if (value) next.limit = value;
      else delete next.limit;
    }
    if (!hasOwn(decision, "deductible") && termDecisionsTouch(coverage, termDecisions, isDeductibleTerm)) {
      const value = deductibleFromTerms(next.limits);
      if (value) next.deductible = value;
      else delete next.deductible;
    }
    if (!hasOwn(decision, "premium") && termDecisionsTouch(coverage, termDecisions, isPremiumTerm)) {
      const value = premiumFromTerms(next.limits);
      if (value) next.premium = value;
      else delete next.premium;
    }
    if (!hasOwn(decision, "retroactiveDate") && termDecisionsTouch(coverage, termDecisions, isRetroactiveDateTerm)) {
      const value = retroactiveDateFromTerms(next.limits);
      if (value) next.retroactiveDate = value;
      else delete next.retroactiveDate;
    }
  }

  next.sourceNodeIds = uniqueStrings([
    ...next.sourceNodeIds,
    ...next.limits.flatMap((term) => term.sourceNodeIds),
  ]);
  next.sourceSpanIds = uniqueStrings([
    ...next.sourceSpanIds,
    ...next.limits.flatMap((term) => term.sourceSpanIds),
  ]);

  return next.name ? next : coverage;
}

function sourceIdsFromOperationalProfile(profile: PolicyOperationalProfile) {
  const backedValues = [
    profile.policyNumber,
    profile.namedInsured,
    profile.insurer,
    profile.broker,
    profile.effectiveDate,
    profile.expirationDate,
    profile.retroactiveDate,
    profile.premium,
  ].filter(Boolean);
  return {
    sourceNodeIds: uniqueStrings([
      ...backedValues.flatMap((value) => value?.sourceNodeIds ?? []),
      ...profile.coverages.flatMap((coverage) => coverage.sourceNodeIds),
      ...profile.coverages.flatMap((coverage) => coverage.limits.flatMap((term) => term.sourceNodeIds)),
      ...profile.parties.flatMap((party) => party.sourceNodeIds),
      ...profile.endorsementSupport.flatMap((support) => support.sourceNodeIds),
    ]),
    sourceSpanIds: uniqueStrings([
      ...backedValues.flatMap((value) => value?.sourceSpanIds ?? []),
      ...profile.coverages.flatMap((coverage) => coverage.sourceSpanIds),
      ...profile.coverages.flatMap((coverage) => coverage.limits.flatMap((term) => term.sourceSpanIds)),
      ...profile.parties.flatMap((party) => party.sourceSpanIds),
      ...profile.endorsementSupport.flatMap((support) => support.sourceSpanIds),
    ]),
  };
}

export function applyOperationalProfileCleanup(
  profile: PolicyOperationalProfile,
  cleanup: OperationalProfileCleanup,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): PolicyOperationalProfile {
  const coverageDecisionByIndex = new Map<number, CoverageCleanupDecision>();
  for (const decision of cleanup.coverageDecisions) {
    if (decision.coverageIndex < profile.coverages.length) coverageDecisionByIndex.set(decision.coverageIndex, decision);
  }

  const coverages = profile.coverages
    .map((coverage, index) =>
      applyCoverageCleanupDecision(coverage, coverageDecisionByIndex.get(index), validNodeIds, validSpanIds)
    )
    .filter((coverage): coverage is OperationalCoverageLine => Boolean(coverage));
  const cleanupWarnings = cleanup.warnings
    .map((warning) => cleanProfileValue(warning))
    .filter((warning): warning is string => Boolean(warning));
  const nextProfile = {
    ...profile,
    coverages,
    coverageTypes: uniqueStrings(coverages.map((coverage) => coverage.name)),
    warnings: uniqueStrings([
      ...profile.warnings,
      ...cleanupWarnings.map((warning) => `Operational profile cleanup warning: ${warning}`),
    ]),
  };

  return PolicyOperationalProfileSchema.parse({
    ...nextProfile,
    ...sourceIdsFromOperationalProfile(nextProfile),
  });
}
