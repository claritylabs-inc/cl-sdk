import type {
  DocumentSourceNode,
  OperationalCoverageLine,
  OperationalCoverageTerm,
  OperationalEndorsementSupport,
  OperationalParty,
  PolicyOperationalProfile,
  SourceBackedValue,
  SourceSpan,
} from "./schemas";
import { PolicyOperationalProfileSchema } from "./schemas";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return normalizeWhitespace(value.replace(/^[\s:;#-]+|[\s;,.]+$/g, ""));
}

function cleanCoverageLabel(value: string | undefined): string | undefined {
  return cleanValue(value)?.replace(/^column\s+\d+\s*:\s*/i, "");
}

function moneyValue(value: string | undefined): string | undefined {
  const clean = cleanValue(value);
  if (!clean) return undefined;
  if (/^\$/.test(clean)) return clean;
  if (/^\d{1,3}(?:,\d{3})*(?:\.\d{2})?$/.test(clean)) return `$${clean}`;
  return clean;
}

function nodeText(node: DocumentSourceNode): string {
  return normalizeWhitespace([
    node.title,
    node.description,
    node.textExcerpt,
  ].filter(Boolean).join(" "));
}

function valueFromNode(node: DocumentSourceNode, value: string, confidence: SourceBackedValue["confidence"] = "medium"): SourceBackedValue {
  return {
    value,
    confidence,
    sourceNodeIds: [node.id],
    sourceSpanIds: node.sourceSpanIds,
  };
}

function firstMatch(nodes: DocumentSourceNode[], patterns: RegExp[]): SourceBackedValue | undefined {
  for (const node of nodes) {
    const text = nodeText(node);
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = cleanValue(match?.[1]);
      if (value) return valueFromNode(node, value, "high");
    }
  }
  return undefined;
}

function inferPolicyTypes(nodes: DocumentSourceNode[]): string[] {
  const text = nodes.slice(0, 40).map(nodeText).join(" ").toLowerCase();
  const types: string[] = [];
  const add = (pattern: RegExp, type: string) => {
    if (pattern.test(text) && !types.includes(type)) types.push(type);
  };
  add(/\b(cyber|network security|privacy liability|data breach)\b/i, "cyber");
  add(/\b(professional liability|errors?\s*&?\s*omissions|e&o)\b/i, "professional_liability");
  add(/\b(commercial general liability|general liability|cgl)\b/i, "general_liability");
  add(/\b(umbrella|excess liability)\b/i, "umbrella");
  add(/\b(workers'? compensation|employers'? liability)\b/i, "workers_comp");
  add(/\b(commercial auto|business auto|automobile liability)\b/i, "commercial_auto");
  add(/\b(commercial property|property coverage|building coverage)\b/i, "commercial_property");
  return types.length ? types : ["other"];
}

function inferDocumentType(nodes: DocumentSourceNode[]): "policy" | "quote" {
  const text = nodes.slice(0, 25).map(nodeText).join(" ").toLowerCase();
  if (/\b(quote|proposal|quotation|indication)\b/.test(text) && !/\bpolicy number\b/.test(text)) {
    return "quote";
  }
  return "policy";
}

function coverageNameFromRow(text: string): string | undefined {
  const labelled = text.match(/\b(coverage part|coverage|line)\s*:?\s*([^|;$]{3,80})/i);
  if (labelled) {
    const value = cleanCoverageLabel(labelled[2]);
    if (!value) return undefined;
    return /^coverage part$/i.test(labelled[1]) ? `Coverage Part ${value}` : value;
  }
  const parts = text.split(/\s+\|\s+| {2,}|\t/).map(cleanCoverageLabel).filter(Boolean) as string[];
  const first = parts.find((part) =>
    !/^(limit|limits?|deductible|premium|amount|basis|rate|retroactive|aggregate|each occurrence)$/i.test(part)
    && !/^\$?[\d,]+/.test(part),
  );
  return cleanCoverageLabel(first);
}

function limitFromText(text: string): string | undefined {
  return moneyValue(
    text.match(/\b(?:limit|liability|aggregate|occurrence|claim)\s*:?\s*(\$?\d[\d,]*(?:\.\d{2})?|\$?\d[\d,]*\s*(?:each|per|aggregate)[^|;]*)/i)?.[1]
    ?? text.match(/(\$\s?\d[\d,]*(?:\.\d{2})?)(?=.*\b(limit|aggregate|occurrence|claim|liability)\b)/i)?.[1],
  );
}

function deductibleFromText(text: string): string | undefined {
  return moneyValue(text.match(/\b(?:deductible|retention|sir)\s*:?\s*(\$?\d[\d,]*(?:\.\d{2})?)/i)?.[1]);
}

function premiumFromText(text: string): string | undefined {
  return moneyValue(text.match(/\b(?:premium|total premium|total cost|amount due)\s*:?\s*(\$?\d[\d,]*(?:\.\d{2})?)/i)?.[1]);
}

function moneyAmount(value: string | undefined): number | undefined {
  const match = value?.match(/\$?\s*([0-9][0-9,]*(?:\.\d+)?)/);
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function normalizeLabel(value: string | undefined): string {
  return normalizeWhitespace(value ?? "").toLowerCase();
}

const OPERATIONAL_COVERAGE_TERM_KINDS = new Set<OperationalCoverageTerm["kind"]>([
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
]);

function termKind(label: string, value: string): OperationalCoverageTerm["kind"] {
  const text = normalizeLabel(`${label} ${value}`);
  if (/\bretroactive\b/.test(text)) return "retroactive_date";
  if (/\b(self[-\s]?insured retention|retention|sir)\b/.test(text)) return "retention";
  if (/\bdeductible\b/.test(text)) return "deductible";
  if (/\bpremium\b/.test(text)) return "premium";
  if (/\bsub[-\s]?limit\b/.test(text)) return "sublimit";
  if (/\baggregate\b/.test(text)) return "aggregate_limit";
  if (/\beach\s+claim|per\s+claim\b/.test(text)) return "each_claim_limit";
  if (/\beach\s+occurrence|per\s+occurrence\b/.test(text)) return "each_occurrence_limit";
  if (/\beach\s+loss|per\s+loss\b/.test(text)) return "each_loss_limit";
  if (/\blimit\b/.test(text)) return "other";
  return "other";
}

function normalizeTermKind(value: unknown, label: string, termValue: string): OperationalCoverageTerm["kind"] {
  return typeof value === "string" && OPERATIONAL_COVERAGE_TERM_KINDS.has(value as OperationalCoverageTerm["kind"])
    ? value as OperationalCoverageTerm["kind"]
    : termKind(label, termValue);
}

function isValueCell(label: string, value: string): boolean {
  const normalizedLabel = normalizeLabel(label);
  const normalizedValue = normalizeLabel(value);
  if (!value || normalizedValue === "—") return false;
  if (/\b(policy\s*(number|no|#)|named insured|insured|carrier|company|broker|producer|agent|coverage|coverage part|description|item|name|form|source)\b/.test(normalizedLabel)) {
    return false;
  }
  return (
    /\b(limit|aggregate|retention|deductible|sir|retroactive|premium|amount)\b/.test(normalizedLabel) ||
    moneyAmount(value) !== undefined ||
    /\b(full prior acts|none|included|not included|as stated)\b/.test(normalizedValue)
  );
}

function isNameCell(label: string, value: string): boolean {
  const normalizedLabel = normalizeLabel(label);
  const normalizedValue = normalizeLabel(value);
  if (!value || moneyAmount(value) !== undefined) return false;
  if (/\b(coverage|coverage part|insuring agreement|description|item|name)\b/.test(normalizedLabel)) {
    return true;
  }
  if (/^column\s+\d+$/.test(normalizedLabel) && /\b(coverage|sub[-\s]?limit|liability|expense|part\s+[a-z])\b/.test(normalizedValue)) {
    return true;
  }
  return false;
}

function childMap(nodes: DocumentSourceNode[]): Map<string | undefined, DocumentSourceNode[]> {
  const children = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of nodes) {
    const group = children.get(node.parentId) ?? [];
    group.push(node);
    children.set(node.parentId, group);
  }
  for (const group of children.values()) group.sort((left, right) => left.order - right.order);
  return children;
}

function cellRows(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>) {
  return (children.get(row.id) ?? [])
    .filter((child) => child.kind === "table_cell")
    .map((cell) => ({
      label: cleanValue(cell.title) ?? "Value",
      value: cleanValue(cell.textExcerpt ?? cell.description ?? cell.title) ?? "",
      node: cell,
    }))
    .filter((cell) => cell.value);
}

function directChildren(parent: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): DocumentSourceNode[] {
  return children.get(parent.id) ?? [];
}

function descendants(parent: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): DocumentSourceNode[] {
  const stack = [...directChildren(parent, children)];
  const result: DocumentSourceNode[] = [];
  while (stack.length > 0) {
    const node = stack.shift()!;
    result.push(node);
    stack.unshift(...directChildren(node, children));
  }
  return result;
}

function ancestry(node: DocumentSourceNode, byId: Map<string, DocumentSourceNode>): DocumentSourceNode[] {
  const result: DocumentSourceNode[] = [];
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current) {
    result.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

function endorsementAncestor(node: DocumentSourceNode, byId: Map<string, DocumentSourceNode>): DocumentSourceNode | undefined {
  return ancestry(node, byId).find((ancestor) => ancestor.kind === "endorsement");
}

function endorsementNumberFrom(value: string | undefined): string | undefined {
  return cleanValue(value?.match(/\bendorsement\s+no\.?\s*([0-9A-Z-]+)/i)?.[1]);
}

function endorsementNameFrom(node: DocumentSourceNode): string {
  const candidates = [node.title, node.textExcerpt, node.description, nodeText(node)].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const match = candidate.match(/\bendorsement\s+no\.?\s*([0-9A-Z-]+)\s*[—-]\s*(.{3,140}?)(?=\s+This\s+endorsement\b|\.|$)/i);
    if (match) return cleanValue(`Endorsement No. ${match[1]} - ${match[2]}`) ?? node.title;
  }
  return node.title;
}

function sourceIds(nodes: DocumentSourceNode[]) {
  return {
    sourceNodeIds: [...new Set(nodes.map((node) => node.id))],
    sourceSpanIds: [...new Set(nodes.flatMap((node) => node.sourceSpanIds))],
  };
}

function relabelGenericTerm(term: OperationalCoverageTerm, label: string | undefined): OperationalCoverageTerm {
  const cleanLabel = cleanValue(label);
  if (!cleanLabel || !/^column\s+\d+$/i.test(term.label)) return term;
  return {
    ...term,
    kind: termKind(cleanLabel, term.value),
    label: cleanLabel,
  };
}

function termFromCell(params: {
  row: DocumentSourceNode;
  cell?: DocumentSourceNode;
  label: string;
  value: string;
  appliesTo?: string;
}): OperationalCoverageTerm | undefined {
  const value = cleanValue(params.value);
  if (!value) return undefined;
  const nodes = [params.row, params.cell].filter((node): node is DocumentSourceNode => Boolean(node));
  const kind = termKind(params.label, value);
  const amount = moneyAmount(value);
  return {
    kind,
    label: params.label,
    value,
    ...(amount !== undefined && kind !== "retroactive_date" ? { amount } : {}),
    ...(params.appliesTo ? { appliesTo: params.appliesTo } : {}),
    ...sourceIds(nodes),
  };
}

function termsFromRow(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): OperationalCoverageTerm[] {
  const cells = cellRows(row, children);
  if (cells.length > 0) {
    return cells
      .filter((cell) => isValueCell(cell.label, cell.value))
      .map((cell) => termFromCell({ row, cell: cell.node, label: cell.label, value: cell.value }))
      .filter((term): term is OperationalCoverageTerm => Boolean(term));
  }

  const text = normalizeWhitespace(row.textExcerpt ?? row.description ?? nodeText(row));
  const terms: OperationalCoverageTerm[] = [];
  for (const part of text.split(/\s+\|\s+/)) {
    const match = part.match(/^([^:]{2,80}):\s*(.+)$/);
    if (!match) continue;
    if (!isValueCell(match[1], match[2])) continue;
    const term = termFromCell({ row, label: cleanValue(match[1]) ?? "Value", value: match[2] });
    if (term) terms.push(term);
  }
  if (terms.length === 0) {
    const limit = limitFromText(text);
    if (limit) {
      const term = termFromCell({ row, label: "Limit", value: limit });
      if (term) terms.push(term);
    }
    const deductible = deductibleFromText(text);
    if (deductible) {
      const term = termFromCell({ row, label: "Deductible", value: deductible });
      if (term) terms.push(term);
    }
  }
  return terms;
}

function nameFromRow(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): string | undefined {
  const cells = cellRows(row, children);
  const named = cells.find((cell) => isNameCell(cell.label, cell.value));
  if (named) return cleanValue(named.value);
  return coverageNameFromRow(row.textExcerpt ?? row.description ?? nodeText(row));
}

function legacyLimit(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find((term) =>
    ["each_claim_limit", "each_occurrence_limit", "each_loss_limit", "aggregate_limit", "sublimit", "other"].includes(term.kind),
  )?.value;
}

function legacyDeductible(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find((term) => term.kind === "deductible" || term.kind === "retention")?.value;
}

function legacyPremium(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find((term) => term.kind === "premium")?.value;
}

function retroDate(terms: OperationalCoverageTerm[]): string | undefined {
  return terms.find((term) => term.kind === "retroactive_date")?.value;
}

function hasCoverageLimitTerm(terms: OperationalCoverageTerm[]): boolean {
  return terms.some((term) =>
    ["each_claim_limit", "each_occurrence_limit", "each_loss_limit", "aggregate_limit", "sublimit"].includes(term.kind)
    || (term.kind === "other" && /\blimit\b/i.test(term.label) && moneyAmount(term.value) !== undefined),
  );
}

function isOperationalCoverageRow(coverage: OperationalCoverageLine): boolean {
  const name = normalizeLabel(coverage.name);
  if (!hasCoverageLimitTerm(coverage.limits)) return false;
  if (/^(item\s+\d+|option:|annual policy premium|total premium|premium and payment)\b/i.test(coverage.name)) return false;
  if (/^(nwc|iso|cg|il|acord)[-\s]?[a-z0-9]/i.test(coverage.name)) return false;
  if (/\b(forms?|endorsements?|premium|payment|terrorism risk insurance act|tria|erp option|bilateral discovery)\b/i.test(name)) return false;
  if (coverage.name.split(/\s+/).length > 16 && !/\b(coverage|liability|sub[-\s]?limit|aggregate|each\s+(claim|loss|occurrence)|limit)\b/i.test(coverage.name)) {
    return false;
  }
  return /\b(coverage|coverage part|liability|sub[-\s]?limit|aggregate|each\s+(claim|loss|occurrence)|bricking|cyber|privacy|media|regulatory|defense|ai\/ml|errors?\s*&?\s*omissions|technology)\b/i.test(coverage.name);
}

function uniqueTerms(terms: OperationalCoverageTerm[]): OperationalCoverageTerm[] {
  const seen = new Set<string>();
  const result: OperationalCoverageTerm[] = [];
  for (const term of terms) {
    const key = [term.kind, term.label.toLowerCase(), term.value.toLowerCase(), term.appliesTo ?? ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(term);
  }
  return result;
}

function coverageFromTableRow(
  row: DocumentSourceNode,
  children: Map<string | undefined, DocumentSourceNode[]>,
  byId: Map<string, DocumentSourceNode>,
): OperationalCoverageLine | undefined {
  if (row.metadata?.isHeader === true || row.metadata?.isHeader === "true") return undefined;
  const name = nameFromRow(row, children);
  const terms = uniqueTerms(termsFromRow(row, children));
  if (!name || terms.length === 0) return undefined;
  const ids = sourceIds([row, ...directChildren(row, children)]);
  const endorsement = endorsementAncestor(row, byId);
  return {
    name,
    limit: legacyLimit(terms),
    deductible: legacyDeductible(terms),
    premium: legacyPremium(terms),
    retroactiveDate: retroDate(terms),
    formNumber: typeof row.metadata?.formNumber === "string" ? row.metadata.formNumber : undefined,
    sectionRef: endorsement?.title,
    coverageOrigin: endorsement ? "endorsement" : "core",
    endorsementNumber: endorsementNumberFrom(endorsement?.title),
    limits: terms,
    ...ids,
  };
}

function coverageFromEndorsement(
  endorsement: DocumentSourceNode,
  children: Map<string | undefined, DocumentSourceNode[]>,
): OperationalCoverageLine | undefined {
  const rows = descendants(endorsement, children).filter((node) => node.kind === "table_row");
  const terms = uniqueTerms(rows.flatMap((row) =>
    termsFromRow(row, children).map((term) => {
      const appliesTo = nameFromRow(row, children);
      const labelled = relabelGenericTerm(term, appliesTo);
      return appliesTo && labelled.label !== appliesTo
        ? { ...labelled, appliesTo }
        : labelled;
    }),
  ));
  if (terms.length === 0) return undefined;
  const ids = sourceIds([endorsement, ...rows, ...rows.flatMap((row) => directChildren(row, children))]);
  const name = endorsementNameFrom(endorsement);
  return {
    name,
    limit: legacyLimit(terms),
    deductible: legacyDeductible(terms),
    premium: legacyPremium(terms),
    retroactiveDate: retroDate(terms),
    formNumber: typeof endorsement.metadata?.formNumber === "string" ? endorsement.metadata.formNumber : undefined,
    sectionRef: name,
    coverageOrigin: "endorsement",
    endorsementNumber: endorsementNumberFrom(name),
    limits: terms,
    ...ids,
  };
}

function hasDescendantEndorsementWithTableRows(
  endorsement: DocumentSourceNode,
  children: Map<string | undefined, DocumentSourceNode[]>,
): boolean {
  return descendants(endorsement, children).some((node) =>
    node.kind === "endorsement" &&
    descendants(node, children).some((descendant) => descendant.kind === "table_row"),
  );
}

function buildCoverages(nodes: DocumentSourceNode[]): OperationalCoverageLine[] {
  const children = childMap(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const coverages: OperationalCoverageLine[] = [];
  const seen = new Set<string>();

  for (const endorsement of nodes.filter((node) => node.kind === "endorsement")) {
    if (hasDescendantEndorsementWithTableRows(endorsement, children)) continue;
    const coverage = coverageFromEndorsement(endorsement, children);
    if (!coverage) continue;
    const key = [coverage.name.toLowerCase(), coverage.sourceNodeIds.join(",")].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    coverages.push(coverage);
  }

  const rows = nodes.filter((node) => {
    const text = nodeText(node);
    return (
      node.kind === "table_row" || node.kind === "schedule" || node.kind === "text"
    ) && /\b(coverage|limit|deductible|aggregate|occurrence|liability|premium|retroactive|retention)\b/i.test(text);
  });

  for (const row of rows) {
    if (endorsementAncestor(row, byId)) continue;
    const structured = row.kind === "table_row" ? coverageFromTableRow(row, children, byId) : undefined;
    if (structured) {
      if (!isOperationalCoverageRow(structured)) continue;
      const key = [
        structured.name.toLowerCase(),
        structured.limits.map((term) => `${term.kind}:${term.value}`).join(","),
        structured.sourceNodeIds.join(","),
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      coverages.push(structured);
      if (coverages.length >= 60) break;
      continue;
    }

    const text = nodeText(row);
    const name = coverageNameFromRow(text);
    const limit = limitFromText(text);
    const deductible = deductibleFromText(text);
    const premium = premiumFromText(text);
    if (!name || (!limit && !deductible && !premium)) continue;
    if (!isOperationalCoverageRow({
      name,
      limit,
      deductible,
      premium,
      coverageOrigin: "core",
      limits: [
        ...(limit ? [{ kind: "other" as const, label: "Limit", value: limit, sourceNodeIds: [row.id], sourceSpanIds: row.sourceSpanIds }] : []),
        ...(deductible ? [{ kind: "deductible" as const, label: "Deductible", value: deductible, sourceNodeIds: [row.id], sourceSpanIds: row.sourceSpanIds }] : []),
        ...(premium ? [{ kind: "premium" as const, label: "Premium", value: premium, sourceNodeIds: [row.id], sourceSpanIds: row.sourceSpanIds }] : []),
      ],
      sourceNodeIds: [row.id],
      sourceSpanIds: row.sourceSpanIds,
    })) continue;
    const key = [name.toLowerCase(), limit, deductible, premium].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    coverages.push({
      name,
      limit,
      deductible,
      premium,
      formNumber: typeof row.metadata?.formNumber === "string" ? row.metadata.formNumber : undefined,
      coverageOrigin: "core",
      limits: [],
      sourceNodeIds: [row.id],
      sourceSpanIds: row.sourceSpanIds,
    });
    if (coverages.length >= 60) break;
  }

  return coverages;
}

function buildParties(profile: Partial<PolicyOperationalProfile>): OperationalParty[] {
  const parties: OperationalParty[] = [];
  if (profile.namedInsured) {
    parties.push({
      role: "named_insured",
      name: profile.namedInsured.value,
      sourceNodeIds: profile.namedInsured.sourceNodeIds,
      sourceSpanIds: profile.namedInsured.sourceSpanIds,
    });
  }
  if (profile.insurer) {
    parties.push({
      role: "insurer",
      name: profile.insurer.value,
      sourceNodeIds: profile.insurer.sourceNodeIds,
      sourceSpanIds: profile.insurer.sourceSpanIds,
    });
  }
  if (profile.broker) {
    parties.push({
      role: "broker",
      name: profile.broker.value,
      sourceNodeIds: profile.broker.sourceNodeIds,
      sourceSpanIds: profile.broker.sourceSpanIds,
    });
  }
  return parties;
}

function buildEndorsementSupport(nodes: DocumentSourceNode[]): OperationalEndorsementSupport[] {
  const support: OperationalEndorsementSupport[] = [];
  for (const node of nodes) {
    const text = nodeText(node);
    const add = (kind: string, status: OperationalEndorsementSupport["status"]) => {
      if (support.some((item) => item.kind === kind && item.status === status && item.sourceNodeIds.includes(node.id))) {
        return;
      }
      support.push({
        kind,
        status,
        summary: node.textExcerpt ?? node.description,
        sourceNodeIds: [node.id],
        sourceSpanIds: node.sourceSpanIds,
      });
    };
    if (/additional insured/i.test(text)) add("additional_insured", /not included|requires endorsement|only by endorsement/i.test(text) ? "requires_review" : "supported");
    if (/waiver of subrogation|subrogation.*waived/i.test(text)) add("waiver_of_subrogation", /not included|requires endorsement|only by endorsement/i.test(text) ? "requires_review" : "supported");
    if (/primary.*non[-\s]?contributory|non[-\s]?contributory/i.test(text)) add("primary_non_contributory", /not included|requires endorsement|only by endorsement/i.test(text) ? "requires_review" : "supported");
    if (/loss payee|mortgagee/i.test(text)) add(/mortgagee/i.test(text) ? "mortgagee" : "loss_payee", "supported");
    if (support.length >= 20) break;
  }
  return support;
}

export function buildDeterministicOperationalProfile(params: {
  sourceTree: DocumentSourceNode[];
  sourceSpans?: SourceSpan[];
}): PolicyOperationalProfile {
  const nodes = params.sourceTree.filter((node) => node.kind !== "document");
  const partial: Partial<PolicyOperationalProfile> = {
    documentType: inferDocumentType(nodes),
    policyTypes: inferPolicyTypes(nodes),
    policyNumber: firstMatch(nodes, [
      /\bpolicy\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
      /\bpolicy\s*[:#]\s*([A-Z0-9][A-Z0-9-]{4,})/i,
    ]),
    namedInsured: firstMatch(nodes, [
      /\b(?:named insured|insured name|insured)\s*:?\s*(.+?)(?=\s+(?:coverage|policy number|insurer|carrier|premium|effective|expiration)\b|[|;\n]|$)/i,
      /\b(?:applicant|policyholder)\s*:?\s*(.+?)(?=\s+(?:coverage|policy number|insurer|carrier|premium|effective|expiration)\b|[|;\n]|$)/i,
    ]),
    insurer: firstMatch(nodes, [
      /\b(?:insurer|carrier|company|security)\s*:?\s*([^|;\n]{3,120})/i,
      /\bunderwritten by\s+([^|;\n]{3,120})/i,
    ]),
    broker: firstMatch(nodes, [
      /\b(?:broker|producer|agent)\s*:?\s*([^|;\n]{3,120})/i,
    ]),
    effectiveDate: firstMatch(nodes, [
      /\b(?:effective date|policy period from|from)\s*:?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
      /\b([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})\s+(?:to|through|-)\s+[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}/i,
    ]),
    expirationDate: firstMatch(nodes, [
      /\b(?:expiration date|expiry date|expires|to)\s*:?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
      /\b[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}\s+(?:to|through|-)\s+([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
    ]),
    retroactiveDate: firstMatch(nodes, [
      /\bretroactive date\s*:?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}|full prior acts|none)/i,
    ]),
    premium: firstMatch(nodes, [
      /\b(?:total premium|premium|total cost|amount due)\s*:?\s*(\$?\d[\d,]*(?:\.\d{2})?)/i,
    ]),
  };
  const coverages = buildCoverages(nodes);
  const coverageTypes = [...new Set(coverages.map((coverage) => coverage.name))];
  const sourceNodeIds = [...new Set([
    ...Object.values(partial).flatMap((value) =>
      value && typeof value === "object" && "sourceNodeIds" in value
        ? (value.sourceNodeIds as string[])
        : [],
    ),
    ...coverages.flatMap((coverage) => coverage.sourceNodeIds),
  ])];
  const sourceSpanIds = [...new Set([
    ...Object.values(partial).flatMap((value) =>
      value && typeof value === "object" && "sourceSpanIds" in value
        ? (value.sourceSpanIds as string[])
        : [],
    ),
    ...coverages.flatMap((coverage) => coverage.sourceSpanIds),
  ])];

  return PolicyOperationalProfileSchema.parse({
    ...partial,
    coverageTypes,
    coverages,
    parties: buildParties(partial),
    endorsementSupport: buildEndorsementSupport(nodes),
    sourceNodeIds,
    sourceSpanIds,
    warnings: [
      ...(coverages.length === 0 ? ["No source-backed coverage schedule rows were identified deterministically."] : []),
      ...(!partial.policyNumber ? ["No source-backed policy number was identified deterministically."] : []),
      ...(!partial.namedInsured ? ["No source-backed named insured was identified deterministically."] : []),
    ],
  });
}

export function mergeOperationalProfile(
  base: PolicyOperationalProfile,
  candidate: Partial<PolicyOperationalProfile>,
  validNodeIds: Set<string>,
  validSpanIds: Set<string>,
): PolicyOperationalProfile {
  const keepIds = (ids: unknown, valid: Set<string>) =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && valid.has(id)) : [];
  const mergeValue = (fallback: SourceBackedValue | undefined, next: unknown): SourceBackedValue | undefined => {
    if (!next || typeof next !== "object" || Array.isArray(next)) return fallback;
    const record = next as Record<string, unknown>;
    const value = typeof record.value === "string" ? cleanValue(record.value) : undefined;
    if (!value) return fallback;
    const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
    const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
    if (sourceNodeIds.length === 0 && sourceSpanIds.length === 0) return fallback;
    return {
      value,
      normalizedValue: typeof record.normalizedValue === "string" ? record.normalizedValue : fallback?.normalizedValue,
      confidence: record.confidence === "high" || record.confidence === "low" || record.confidence === "medium"
        ? record.confidence
        : "medium",
      sourceNodeIds,
      sourceSpanIds,
    };
  };

  const coverages = base.coverages.length > 0
    ? base.coverages
    : Array.isArray(candidate.coverages)
    ? candidate.coverages
        .map((coverage) => {
          const record = coverage as Record<string, unknown>;
          const limits: OperationalCoverageTerm[] = Array.isArray(record.limits)
            ? record.limits
                .filter((term): term is Record<string, unknown> =>
                  Boolean(term) && typeof term === "object" && !Array.isArray(term),
                )
                .flatMap((term) => {
                  const label = typeof term.label === "string" ? cleanValue(term.label) : undefined;
                  const value = typeof term.value === "string" ? cleanValue(term.value) : undefined;
                  const sourceNodeIds = keepIds(term.sourceNodeIds, validNodeIds);
                  const sourceSpanIds = keepIds(term.sourceSpanIds, validSpanIds);
                  if (!label || !value || (sourceNodeIds.length === 0 && sourceSpanIds.length === 0)) return [];
                  return [{
                    kind: normalizeTermKind(term.kind, label, value),
                    label,
                    value,
                    amount: typeof term.amount === "number" && Number.isFinite(term.amount) ? term.amount : undefined,
                    appliesTo: typeof term.appliesTo === "string" ? term.appliesTo : undefined,
                    sourceNodeIds,
                    sourceSpanIds,
                  }];
                })
            : [];
          return {
            ...coverage,
            limits,
            sourceNodeIds: keepIds(record.sourceNodeIds, validNodeIds),
            sourceSpanIds: keepIds(record.sourceSpanIds, validSpanIds),
          };
        })
        .filter((coverage) => coverage.name && (coverage.sourceNodeIds.length > 0 || coverage.sourceSpanIds.length > 0))
    : base.coverages;

  return PolicyOperationalProfileSchema.parse({
    ...base,
    documentType: candidate.documentType === "quote" ? "quote" : candidate.documentType === "policy" ? "policy" : base.documentType,
    policyTypes: Array.isArray(candidate.policyTypes) && candidate.policyTypes.length > 0 ? candidate.policyTypes : base.policyTypes,
    policyNumber: mergeValue(base.policyNumber, candidate.policyNumber),
    namedInsured: mergeValue(base.namedInsured, candidate.namedInsured),
    insurer: mergeValue(base.insurer, candidate.insurer),
    broker: mergeValue(base.broker, candidate.broker),
    effectiveDate: mergeValue(base.effectiveDate, candidate.effectiveDate),
    expirationDate: mergeValue(base.expirationDate, candidate.expirationDate),
    retroactiveDate: mergeValue(base.retroactiveDate, candidate.retroactiveDate),
    premium: mergeValue(base.premium, candidate.premium),
    coverageTypes: Array.isArray(candidate.coverageTypes) && candidate.coverageTypes.length > 0
      ? candidate.coverageTypes
      : base.coverageTypes,
    coverages,
    parties: base.parties,
    endorsementSupport: base.endorsementSupport,
    sourceNodeIds: [...new Set([...base.sourceNodeIds, ...keepIds(candidate.sourceNodeIds, validNodeIds)])],
    sourceSpanIds: [...new Set([...base.sourceSpanIds, ...keepIds(candidate.sourceSpanIds, validSpanIds)])],
    warnings: base.warnings,
  });
}
