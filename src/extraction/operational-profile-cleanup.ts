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
type CoverageCleanupEntry = {
  coverage: OperationalCoverageLine;
  coverageIndex: number;
};

const CLEANUP_CANDIDATE_ID_LIMIT = 12;
const CLEANUP_SOURCE_NODE_LIMIT = 90;
const CLEANUP_SIBLING_WINDOW = 4;
const CLEANUP_KEYWORD =
  /\b(coverage|limit|liability|deductible|retention|retroactive|premium|aggregate|sublimit|sub-limit|claim|occurrence|loss|proceeding|endorsement|declarations?)\b|\$[0-9]/i;

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

function compactIds(ids: readonly string[] | undefined): string[] {
  return uniqueStrings([...(ids ?? [])]).slice(0, CLEANUP_CANDIDATE_ID_LIMIT);
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
    sourceNodeIds: compactIds(coverage.sourceNodeIds),
    sourceSpanIds: compactIds(coverage.sourceSpanIds),
    terms: coverage.limits.map((term, termIndex) => ({
      termIndex,
      kind: term.kind,
      label: term.label,
      value: term.value,
      amount: term.amount,
      appliesTo: term.appliesTo,
      sourceNodeIds: compactIds(term.sourceNodeIds),
      sourceSpanIds: compactIds(term.sourceSpanIds),
    })),
  };
}

function nodeTextForSelection(node: DocumentSourceNode): string {
  return [
    node.kind,
    node.title,
    node.description,
    node.textExcerpt,
  ].filter(Boolean).join(" ");
}

function coverageTextForSelection(coverage: OperationalCoverageLine): string {
  return [
    coverage.name,
    coverage.coverageCode,
    coverage.limit,
    coverage.deductible,
    coverage.premium,
    coverage.retroactiveDate,
    coverage.sectionRef,
    coverage.endorsementNumber,
    ...coverage.limits.flatMap((term) => [
      term.kind,
      term.label,
      term.value,
      term.appliesTo,
    ]),
  ].filter(Boolean).join(" ");
}

function coverageCleanupEntries(
  profile: PolicyOperationalProfile,
  coverageIndexes?: readonly number[],
): CoverageCleanupEntry[] {
  if (!coverageIndexes) {
    return profile.coverages.map((coverage, coverageIndex) => ({ coverage, coverageIndex }));
  }

  return [...new Set(coverageIndexes)]
    .sort((left, right) => left - right)
    .map((coverageIndex) => {
      const coverage = profile.coverages[coverageIndex];
      return coverage ? { coverage, coverageIndex } : undefined;
    })
    .filter((entry): entry is CoverageCleanupEntry => Boolean(entry));
}

function nodeTextMatchesCoverage(node: DocumentSourceNode, coverageTerms: string[]): boolean {
  const text = nodeTextForSelection(node).toLowerCase();
  return coverageTerms.some((term) => term.length >= 5 && text.includes(term));
}

function selectCoverageCleanupNodes(
  sourceTree: DocumentSourceNode[],
  coverages: OperationalCoverageLine[],
): DocumentSourceNode[] {
  const nodeById = new Map(sourceTree.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, DocumentSourceNode[]>();
  for (const node of sourceTree) {
    if (!node.parentId) continue;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.order - right.order);
  }

  const selected = new Map<string, { node: DocumentSourceNode; score: number }>();
  const addNode = (node: DocumentSourceNode | undefined, score: number) => {
    if (!node || node.kind === "document") return;
    const current = selected.get(node.id);
    if (!current || score > current.score) selected.set(node.id, { node, score });
  };

  const sourceNodeIds = uniqueStrings(coverages.flatMap((coverage) => [
    ...coverage.sourceNodeIds,
    ...coverage.limits.flatMap((term) => term.sourceNodeIds),
  ]));
  const coveragePages = new Set<number>();
  const coverageTerms = uniqueStrings(coverages.flatMap((coverage) =>
    coverageTextForSelection(coverage)
      .toLowerCase()
      .split(/[^a-z0-9$,.]+/i)
      .filter((part) => part.length >= 5)
  ));

  for (const id of sourceNodeIds) {
    const node = nodeById.get(id);
    if (!node) continue;
    addNode(node, 1000);
    if (node.pageStart) coveragePages.add(node.pageStart);
    if (node.pageEnd) coveragePages.add(node.pageEnd);

    let parentId = node.parentId;
    let parentScore = 940;
    while (parentId) {
      const parent = nodeById.get(parentId);
      if (!parent) break;
      addNode(parent, parentScore);
      parentId = parent.parentId;
      parentScore -= 30;
    }

    const siblings = node.parentId ? childrenByParent.get(node.parentId) ?? [] : [];
    for (const sibling of siblings) {
      if (Math.abs(sibling.order - node.order) <= CLEANUP_SIBLING_WINDOW) {
        addNode(sibling, 850 - Math.abs(sibling.order - node.order));
      }
    }
  }

  for (const selectedNode of [...selected.values()].map((entry) => entry.node)) {
    const children = childrenByParent.get(selectedNode.id) ?? [];
    for (const child of children.slice(0, 24)) addNode(child, 760);
  }

  for (const node of sourceTree) {
    if (node.kind === "document") continue;
    if (!node.pageStart || !coveragePages.has(node.pageStart)) continue;
    const text = nodeTextForSelection(node);
    if (CLEANUP_KEYWORD.test(text) || nodeTextMatchesCoverage(node, coverageTerms)) {
      addNode(node, 600);
    }
  }

  return [...selected.values()]
    .sort((left, right) =>
      right.score - left.score
      || (left.node.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.node.pageStart ?? Number.MAX_SAFE_INTEGER)
      || left.node.order - right.node.order
    )
    .slice(0, CLEANUP_SOURCE_NODE_LIMIT)
    .sort((left, right) =>
      (left.node.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.node.pageStart ?? Number.MAX_SAFE_INTEGER)
      || left.node.order - right.node.order
    )
    .map((entry) => entry.node);
}

export function buildOperationalProfileCleanupPrompt(
  sourceTree: DocumentSourceNode[],
  profile: PolicyOperationalProfile,
  options: { coverageIndexes?: readonly number[]; label?: string } = {},
): string {
  const coverageEntries = coverageCleanupEntries(profile, options.coverageIndexes);
  const nodes = selectCoverageCleanupNodes(sourceTree, coverageEntries.map((entry) => entry.coverage))
    .map((node) => compactNode(
      node,
      node.kind === "page" || node.kind === "page_group"
        ? 260
        : node.kind === "table_row" || node.kind === "table_cell"
          ? 520
          : 360,
    ));
  const candidate = {
    documentType: profile.documentType,
    policyTypes: profile.policyTypes,
    coverageTypes: profile.coverageTypes,
    coverages: coverageEntries.map(({ coverage, coverageIndex }) => compactCoverageForCleanup(coverage, coverageIndex)),
  };

  return `Review and clean a source-backed operational profile projection for an insurance policy.
${options.label ? `\nCoverage group: ${options.label}\n` : ""}

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
- Include every JSON key in each decision. Use null for scalar fields you are not changing and [] for source ID lists you are not changing.
- For each coverage decision, always include termDecisions. Use [] when no terms need cleanup.
- Keep reasons concise and factual.

Candidate projection:
${JSON.stringify(candidate, null, 2)}

Source nodes:
${JSON.stringify(nodes, null, 2)}

Return JSON with coverageDecisions and warnings only.`;
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

function isPrimaryLimitTerm(term: OperationalCoverageTerm): boolean {
  return ["each_claim_limit", "each_occurrence_limit", "each_loss_limit", "aggregate_limit"].includes(term.kind);
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

function fallbackLimitScope(kind: OperationalCoverageTerm["kind"]): string | undefined {
  switch (kind) {
    case "each_claim_limit":
      return "Each Claim";
    case "each_occurrence_limit":
      return "Each Occurrence";
    case "each_loss_limit":
      return "Each Loss";
    case "aggregate_limit":
      return "Aggregate";
    case "sublimit":
      return "Sub-Limit";
    default:
      return undefined;
  }
}

function displayLabelForLimitTerm(term: OperationalCoverageTerm): string | undefined {
  const label = cleanProfileValue(term.label)?.replace(/\s+Limit$/i, "");
  if (label && !/^(?:limit|amount|value)$/i.test(label)) return label;
  return fallbackLimitScope(term.kind);
}

function displayValueForLimitTerm(term: OperationalCoverageTerm): string | undefined {
  const value = cleanProfileValue(term.value);
  if (!value) return undefined;
  if (/\b(each|aggregate|occurrence|claim|loss|proceeding|policy|sublimit|sub-limit)\b/i.test(value)) {
    return value;
  }
  const label = displayLabelForLimitTerm(term);
  return label ? `${value} ${label}` : value;
}

function primaryLimitFromTerms(terms: OperationalCoverageTerm[]): string | undefined {
  const primaryTerms = terms.filter(isPrimaryLimitTerm);
  const candidateTerms = primaryTerms.length > 0 ? primaryTerms : terms.filter(isLimitTerm);
  const values = uniqueStrings(candidateTerms.map((term) => displayValueForLimitTerm(term)).filter((value): value is string => Boolean(value)));
  return values.length > 0 ? values.join(" / ") : undefined;
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

function shouldUseTermLimitDisplay(currentLimit: string | undefined, termLimit: string): boolean {
  const current = cleanProfileValue(currentLimit);
  if (!current) return true;
  if (/\s+\/\s*$/.test(current)) return true;
  if (!/\b(each|aggregate|occurrence|claim|loss|proceeding|policy|sublimit|sub-limit)\b/i.test(current)) return true;
  return !current.includes("/") && termLimit.includes("/");
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

  if (typeof decision.amount === "number" && Number.isFinite(decision.amount)) {
    next.amount = decision.amount;
  } else if (decision.value || decision.kind) {
    const amount = next.kind === "retroactive_date" ? undefined : amountFromOperationalValue(next.value);
    if (amount === undefined) delete next.amount;
    else next.amount = amount;
  }

  if (decision.appliesTo != null) {
    const appliesTo = cleanProfileValue(decision.appliesTo);
    if (appliesTo) next.appliesTo = appliesTo;
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

  if (decision.limit != null) {
    const value = cleanProfileValue(decision.limit);
    if (value) next.limit = value;
  }
  if (decision.deductible != null) {
    const value = cleanProfileValue(decision.deductible);
    if (value) next.deductible = value;
  }
  if (decision.premium != null) {
    const value = cleanProfileValue(decision.premium);
    if (value) next.premium = value;
  }
  if (decision.retroactiveDate != null) {
    const value = cleanProfileValue(decision.retroactiveDate);
    if (value) next.retroactiveDate = value;
  }

  const termDecisions = (decision.termDecisions ?? []).filter((termDecision) => termDecision.termIndex < coverage.limits.length);
  const termDecisionByIndex = new Map(termDecisions.map((termDecision) => [termDecision.termIndex, termDecision]));
  next.limits = coverage.limits
    .map((term, index) => applyTermCleanupDecision(term, termDecisionByIndex.get(index), validNodeIds, validSpanIds))
    .filter((term): term is OperationalCoverageTerm => Boolean(term));

  if (termDecisions.length > 0) {
    if (decision.limit == null && termDecisionsTouch(coverage, termDecisions, isLimitTerm)) {
      const value = primaryLimitFromTerms(next.limits);
      if (value) next.limit = value;
      else delete next.limit;
    }
    if (decision.deductible == null && termDecisionsTouch(coverage, termDecisions, isDeductibleTerm)) {
      const value = deductibleFromTerms(next.limits);
      if (value) next.deductible = value;
      else delete next.deductible;
    }
    if (decision.premium == null && termDecisionsTouch(coverage, termDecisions, isPremiumTerm)) {
      const value = premiumFromTerms(next.limits);
      if (value) next.premium = value;
      else delete next.premium;
    }
    if (decision.retroactiveDate == null && termDecisionsTouch(coverage, termDecisions, isRetroactiveDateTerm)) {
      const value = retroactiveDateFromTerms(next.limits);
      if (value) next.retroactiveDate = value;
      else delete next.retroactiveDate;
    }
  }

  const termLimit = primaryLimitFromTerms(next.limits);
  if (termLimit && shouldUseTermLimitDisplay(next.limit, termLimit)) {
    next.limit = termLimit;
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
