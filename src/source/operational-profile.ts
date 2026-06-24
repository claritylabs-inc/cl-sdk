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

function premiumValue(value: string | undefined): string | undefined {
  const clean = cleanValue(value);
  if (!clean) return undefined;
  if (/\$[A-Z0-9]/i.test(clean)) return clean;
  if (/\b(?:CAD|USD)\b/i.test(clean) && /(?:\d|X{2,})/i.test(clean)) return clean;
  if (/^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(clean) || /^\d+\.\d{2}$/.test(clean)) return `$${clean}`;
  if (/^X{2,}(?:,X{3})*(?:\.X{2})$/i.test(clean)) return clean;
  return undefined;
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

function valueFromNodes(
  nodes: DocumentSourceNode[],
  value: string,
  confidence: SourceBackedValue["confidence"] = "medium",
  normalizedValue?: string,
): SourceBackedValue {
  return {
    value,
    ...(normalizedValue ? { normalizedValue } : {}),
    confidence,
    ...sourceIds(nodes),
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

const POLICY_NUMBER_PATTERNS = [
  /\bpolicy\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9,.-]{4,}[A-Z0-9])/i,
  /\bpolicy\s*[:#]\s*([A-Z0-9][A-Z0-9,.-]{4,}[A-Z0-9])/i,
];

function policyNumberEvidenceScore(node: DocumentSourceNode): number {
  const text = normalizeWhitespace([node.path, nodeText(node)].filter(Boolean).join(" ")).toLowerCase();
  let score = 0;
  if (/\b(policy\s+summary|declarations?|declaration\s+page|schedule)\b/.test(text)) score += 80;
  if (/\b(plan|policy\s+date|insured\s+person|named\s+insured|insurance\s+amount|benefit\s+amount)\b/.test(text)) score += 35;
  if (node.kind === "table_row" || node.kind === "table_cell" || node.kind === "text") score += 20;
  if (node.kind === "page") score += 10;
  if (typeof node.pageStart === "number" && node.pageStart > 1 && node.pageStart <= 10) score += 20;
  if (typeof node.pageStart === "number" && node.pageStart === 1) score -= 30;
  if (/\b(notices?\s+and\s+jacket|policy\s+jacket|front\s+matter|table\s+of\s+contents)\b/.test(text)) score -= 70;
  if (node.kind === "page_group" || node.kind === "form") score -= 30;
  return score;
}

function policyNumberFromNodes(nodes: DocumentSourceNode[]): SourceBackedValue | undefined {
  const candidates = nodes
    .slice(0, 120)
    .flatMap((node) => {
      const text = nodeText(node);
      for (const pattern of POLICY_NUMBER_PATTERNS) {
        const value = cleanValue(text.match(pattern)?.[1]);
        if (value) return [{ node, value, score: policyNumberEvidenceScore(node) }];
      }
      return [];
    })
    .sort((left, right) =>
      right.score - left.score ||
      (left.node.pageStart ?? Number.MAX_SAFE_INTEGER) - (right.node.pageStart ?? Number.MAX_SAFE_INTEGER) ||
      left.node.order - right.node.order,
    );
  const candidate = candidates[0];
  return candidate ? valueFromNode(candidate.node, candidate.value, "high") : undefined;
}

function compactFactNodes(nodes: DocumentSourceNode[]): DocumentSourceNode[] {
  return nodes.filter((node) => {
    if (node.kind === "document" || node.kind === "page_group" || node.kind === "form") return false;
    const text = nodeText(node);
    if (text.length > 900) return false;
    if (/\b(table of contents|provided solely for your convenience|not to be construed|actual policy issued)\b/i.test(text)) return false;
    return node.kind === "text" || node.kind === "table_row" || node.kind === "table_cell" || node.kind === "page";
  });
}

function firstCleanMatch(
  nodes: DocumentSourceNode[],
  patterns: RegExp[],
  clean: (value: string) => string | undefined,
): SourceBackedValue | undefined {
  for (const node of compactFactNodes(nodes)) {
    const text = nodeText(node);
    for (const pattern of patterns) {
      const raw = cleanValue(text.match(pattern)?.[1]);
      if (!raw) continue;
      const value = clean(raw);
      if (value) return valueFromNode(node, value, "high");
    }
  }
  return undefined;
}

function cleanNamedInsured(value: string): string | undefined {
  const clean = cleanValue(value
    .replace(/\bborn\s+on\b.*$/i, "")
    .replace(/\bage\s+nearest\b.*$/i, "")
    .replace(/\bbeneficiary\b.*$/i, ""));
  if (!clean || clean.length > 160) return undefined;
  if (!/[A-Za-z0-9]/.test(clean)) return undefined;
  if (/^(person|persons)\b/i.test(clean)) return undefined;
  if (/^(insurance amount|benefit amount|policy number|policy date|owner|beneficiary|premium|coverage|risk classification)\b/i.test(clean)) {
    return undefined;
  }
  if (/\b(table of contents|policy wording|provided solely|convenience|not to be construed|actual policy issued)\b/i.test(clean)) {
    return undefined;
  }
  return clean;
}

const PARTY_LABEL_PATTERNS = {
  namedInsured: /^(?:item\s*\d+[.)]?\s*)?(?:named insured(?:\s+and\s+address)?|insured name)$/i,
  insurer: /^(?:carrier|insurer|security)$/i,
  broker: /^(?:broker(?:\s+of\s+record)?|producer|agent)$/i,
};

function partyLabelKind(value: string): "namedInsured" | "insurer" | "broker" | undefined {
  const clean = cleanValue(value.replace(/^\s*column\s+\d+\s*:\s*/i, ""));
  if (!clean) return undefined;
  if (PARTY_LABEL_PATTERNS.namedInsured.test(clean)) return "namedInsured";
  if (PARTY_LABEL_PATTERNS.insurer.test(clean)) return "insurer";
  if (PARTY_LABEL_PATTERNS.broker.test(clean)) return "broker";
  return undefined;
}

function isRejectedPartyValue(value: string): boolean {
  const clean = normalizeWhitespace(value);
  return /^(?:and address|of record|insurer|carrier|security|broker|producer|agent|the|a|an|is|are|was|were|agrees?|means?|includes?|shall|will)\b/i.test(clean);
}

function identityWithoutAddress(value: string): string | undefined {
  const clean = cleanValue(value
    .replace(/\b(?:phone|tel|telephone|email|e-mail)\b.*$/i, "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b.*$/i, ""));
  if (!clean) return undefined;
  const beforeStreet = clean.match(/^(.+?)\s+\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|suite|ste\.?|floor|fl\.?|way|court|ct\.?)\b/i)?.[1];
  const beforeCityState = clean.match(/^(.+?)\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/)?.[1];
  return cleanValue(beforeStreet ?? beforeCityState ?? clean);
}

function cleanPartyIdentity(value: string, clean: (value: string) => string | undefined): { value: string; normalizedValue?: string } | undefined {
  const raw = cleanValue(value);
  if (!raw || isRejectedPartyValue(raw)) return undefined;
  const identity = identityWithoutAddress(raw);
  const cleaned = identity ? clean(identity) : undefined;
  if (!cleaned || isRejectedPartyValue(cleaned)) return undefined;
  return {
    value: cleaned,
    ...(cleaned !== raw ? { normalizedValue: cleaned } : {}),
  };
}

function partyFromTableRows(
  nodes: DocumentSourceNode[],
  wanted: "namedInsured" | "insurer" | "broker",
  clean: (value: string) => string | undefined,
): SourceBackedValue | undefined {
  const children = childMap(nodes);
  for (const row of compactFactNodes(nodes).filter((node) => node.kind === "table_row")) {
    const cells = cellRows(row, children);
    for (const [index, cell] of cells.entries()) {
      const labelKind = partyLabelKind(cell.value) ?? partyLabelKind(cell.label);
      if (labelKind !== wanted) continue;
      const valueCell = cells.slice(index + 1).find((candidate) => !partyLabelKind(candidate.value) && !partyLabelKind(candidate.label));
      if (!valueCell) continue;
      const cleaned = cleanPartyIdentity(valueCell.value, clean);
      if (cleaned) return valueFromNodes([row, valueCell.node], cleaned.value, "high", cleaned.normalizedValue);
    }

    const parts = normalizeWhitespace(row.textExcerpt ?? row.description ?? nodeText(row))
      .split(/\s+\|\s+|\t/)
      .map(cleanValue)
      .filter((part): part is string => Boolean(part));
    for (const [index, part] of parts.entries()) {
      const labelKind = partyLabelKind(part);
      if (labelKind !== wanted) continue;
      const cleaned = cleanPartyIdentity(parts[index + 1] ?? "", clean);
      if (cleaned) return valueFromNodes([row], cleaned.value, "high", cleaned.normalizedValue);
    }
  }
  return undefined;
}

function namedInsuredFromNodes(nodes: DocumentSourceNode[]): SourceBackedValue | undefined {
  return partyFromTableRows(nodes, "namedInsured", cleanNamedInsured) ?? firstCleanMatch(nodes, [
    /\b(?:named insured|insured name)\s*:?\s*(.+?)(?=\s+(?:insurance amount|benefit amount|policy number|policy date|owner|beneficiary|premium|coverage|risk classification|date this)\b|[|;\n]|$)/i,
    /\b(?:insured persons?|insured person)\s*:\s*(.+?)(?=\s+(?:insurance amount|benefit amount|policy number|policy date|owner|beneficiary|premium|coverage|risk classification|date this)\b|[|;\n]|$)/i,
    /\b(?:applicant|policyholder)\s*:?\s*(.+?)(?=\s+(?:coverage|policy number|insurer|carrier|premium|effective|expiration)\b|[|;\n]|$)/i,
  ], cleanNamedInsured);
}

function cleanInsurer(value: string): string | undefined {
  const clean = cleanValue(value);
  if (!clean || clean.length > 140) return undefined;
  if (/^(mean|means|we|us|our|the|a|an|agrees?|shall|will)\b/i.test(clean)) return undefined;
  if (/\b(table of contents|policy wording|provided solely|convenience)\b/i.test(clean)) return undefined;
  const known = clean.match(/\b(Sun Life Assurance Company of Canada|Manulife|The Manufacturers Life Insurance Company)\b/i)?.[1];
  return known ?? clean;
}

function insurerFromNodes(nodes: DocumentSourceNode[]): SourceBackedValue | undefined {
  const tableValue = partyFromTableRows(nodes, "insurer", cleanInsurer);
  if (tableValue) return tableValue;
  for (const node of compactFactNodes(nodes)) {
    const text = nodeText(node);
    const value = cleanInsurer(text.match(/\b([A-Z][A-Za-z&.,' -]{2,120}?(?:Insurance|Assurance|Indemnity|Casualty|Underwriting|Mutual|Risk|Reinsurance)\s+Company(?:\s+of\s+[A-Z][A-Za-z .'-]+)?)\s*\(\s*the\s+["']?Insurer["']?\s*\)/i)?.[1] ?? "");
    if (value) return valueFromNode(node, value, "high");
  }
  return firstCleanMatch(nodes, [
    /\bunderwritten by\s+([^|;\n.]{3,160})/i,
    /\b(?:insurer|carrier|company|security)\s*:?\s*([^|;\n]{3,120})/i,
    /\b(Sun Life Assurance Company of Canada|Manulife|The Manufacturers Life Insurance Company)\b/i,
  ], cleanInsurer);
}

function inferPolicyTypes(nodes: DocumentSourceNode[]): string[] {
  const text = nodes.slice(0, 40).map(nodeText).join(" ").toLowerCase();
  const types: string[] = [];
  const add = (pattern: RegExp, type: string) => {
    if (pattern.test(text) && !types.includes(type)) types.push(type);
  };
  add(/\b(life insurance|permanent life|term life|whole life|universal life|sun permanent life|sun par protector|manulife par|vitality\s*plus|death benefit)\b/i, "life");
  add(/\b(critical illness|critical illness insurance|covered critical illness|partial benefit payout)\b/i, "critical_illness");
  add(/\b(disability benefit|total disability|catastrophic disability|disability waiver|waiver of premium disability)\b/i, "disability");
  add(/\b(long[-\s]?term care|long term care conversion)\b/i, "long_term_care");
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

function isDeclarationLimitLabel(value: string | undefined): boolean {
  const label = normalizeLabel(value);
  return /\bitem\s*\d+[.)]?\s*limits?\s+of\s+liability\b/.test(label) ||
    /^limits?\s+of\s+liability$/.test(label) ||
    /^policy\s+limits?$/.test(label);
}

function declarationCoverageNameFromRow(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): string | undefined {
  const cells = cellRows(row, children);
  const candidates = [
    row.title,
    ...cells.flatMap((cell) => [cell.label, cell.value]),
  ];
  if (!candidates.some(isDeclarationLimitLabel)) return undefined;
  return candidates.some((candidate) => /\blimits?\s+of\s+liability\b/i.test(candidate ?? ""))
    ? "Limits of Liability"
    : "Policy Limits";
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
  return premiumValue(text.match(/\b(?:premium|total premium|total cost|amount due)\b(?:\s*(?:is|:|-))?\s*(\$?(?:\d[\d,]*(?:\.\d{2})?|X{2,}(?:,X{3})*(?:\.X{2})?))/i)?.[1]);
}

function premiumFromNodes(nodes: DocumentSourceNode[]): SourceBackedValue | undefined {
  for (const node of compactFactNodes(nodes)) {
    const value = premiumFromText(nodeText(node));
    if (value) return valueFromNode(node, value, "high");
  }
  return undefined;
}

function moneyAmount(value: string | undefined): number | undefined {
  const clean = cleanValue(value);
  if (!clean) return undefined;
  const currency = clean.match(/\$\s*([0-9][0-9,]*(?:\.\d+)?)/);
  const percent = clean.match(/\b([0-9][0-9,]*(?:\.\d+)?)\s*%/);
  const explicitNumeric = !/\bitem\s*\d+\b/i.test(clean) &&
    /\b(?:limit|aggregate|claim|occurrence|loss|retention|deductible|sir|premium|amount)\b/i.test(clean)
    ? clean.match(/\b([0-9][0-9,]*(?:\.\d+)?)\b/)
    : undefined;
  const match = currency ?? percent ?? explicitNumeric;
  if (!match) return undefined;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : undefined;
}

function normalizeLabel(value: string | undefined): string {
  return normalizeWhitespace(value ?? "").toLowerCase();
}

function isGenericColumnLabel(value: string | undefined): boolean {
  return /^column\s+\d+$/i.test(cleanValue(value) ?? "");
}

function isHeaderRow(row: DocumentSourceNode): boolean {
  return row.metadata?.isHeader === true || row.metadata?.isHeader === "true";
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
  if (/\beach\s+proceeding|per\s+proceeding\b/.test(text)) return "sublimit";
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

function isCoverageTermLabel(value: string): boolean {
  const label = normalizeLabel(value);
  return /\b(limit|aggregate|retention|deductible|sir|retroactive|premium|amount|sub[-\s]?limit)\b/.test(label);
}

function isNameCell(label: string, value: string): boolean {
  const normalizedLabel = normalizeLabel(label);
  const normalizedValue = normalizeLabel(value);
  if (!value || moneyAmount(value) !== undefined) return false;
  if (/^item\s+\d+[.)]?\s*limits?\s+of\s+liability\b/.test(normalizedValue)) return false;
  if (/\b(coverage|coverage part|insuring agreement|description|item|name)\b/.test(normalizedLabel)) {
    return true;
  }
  if (/\b(sub[-\s]?limit|aggregate(?:\s+policy)?\s+limit|limit\s+of\s+liability)\b/.test(normalizedLabel) &&
    /\b[a-z][a-z0-9&/ -]{2,}\b/.test(normalizedValue) &&
    !/\bcoverage\s+part\s+[a-z]\)?$/.test(normalizedValue)) {
    return true;
  }
  if (/^column\s+1$/.test(normalizedLabel) && !/^(item\s+\d+|nwc-|iso-|cg |il |form\b|page\b)/i.test(normalizedValue)) {
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

function rawCellRows(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>) {
  return (children.get(row.id) ?? [])
    .filter((child) => child.kind === "table_cell")
    .map((cell) => ({
      label: cleanValue(cell.title) ?? "Value",
      value: cleanValue(cell.textExcerpt ?? cell.description ?? cell.title) ?? "",
      node: cell,
    }))
    .filter((cell) => cell.value);
}

function headerLabelsForRow(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): string[] {
  if (!row.parentId) return [];
  const labels: string[] = [];
  const siblingRows = (children.get(row.parentId) ?? [])
    .filter((candidate) => candidate.kind === "table_row" && candidate.order < row.order)
    .sort((left, right) => left.order - right.order);
  for (const sibling of siblingRows) {
    if (!isHeaderRow(sibling)) continue;
    for (const [index, cell] of rawCellRows(sibling, children).entries()) {
      const label = cleanValue(cell.value) ?? cleanValue(cell.label);
      if (label && !isGenericColumnLabel(label)) labels[index] = label;
    }
  }
  return labels;
}

function cellRows(
  row: DocumentSourceNode,
  children: Map<string | undefined, DocumentSourceNode[]>,
  headerLabels: string[] = [],
) {
  return rawCellRows(row, children).map((cell, index) => ({
    ...cell,
    label: isGenericColumnLabel(cell.label) && headerLabels[index] ? headerLabels[index] : cell.label,
  }));
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

function termFromCell(params: {
  row: DocumentSourceNode;
  cell?: DocumentSourceNode;
  label: string;
  value: string;
  appliesTo?: string;
}): OperationalCoverageTerm | undefined {
  const value = cleanCoverageTermValue(params.value);
  if (!value) return undefined;
  if (isRejectedCoverageTermValue(params.label, value)) return undefined;
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

function cleanCoverageTermValue(value: string | undefined): string | undefined {
  return cleanValue(value)?.replace(/\s+\/\s*$/, "").trim();
}

function isRejectedCoverageTermValue(label: string, value: string): boolean {
  if (/\bshown\s+in\s+item\s*\d+\b/i.test(value) && moneyAmount(value) === undefined) return true;
  if (/\b(does not afford coverage|doesn't afford coverage|no coverage|remains excluded|is excluded|are excluded|shall not cover|will not cover)\b/i.test(value) &&
    moneyAmount(value) === undefined) {
    return true;
  }
  if (/^for:\s*\(\d+\)/i.test(label) && moneyAmount(value) === undefined) return true;
  if (value.length > 80 && /\b(exclusion|excluded|shall not|will not|does not|failure to)\b/i.test(value) && moneyAmount(value) === undefined) return true;
  return false;
}

function termsFromRow(row: DocumentSourceNode, children: Map<string | undefined, DocumentSourceNode[]>): OperationalCoverageTerm[] {
  const cells = cellRows(row, children, headerLabelsForRow(row, children));
  if (cells.length > 0) {
    const pairedTerms: OperationalCoverageTerm[] = [];
    const pairedIndexes = new Set<number>();
    for (const [index, cell] of cells.entries()) {
      const next = cells[index + 1];
      if (!next) continue;
      if (!isGenericColumnLabel(cell.label) && isNameCell(cell.label, cell.value)) continue;
      if (!isCoverageTermLabel(cell.value)) continue;
      if (isCoverageTermLabel(next.value) && moneyAmount(next.value) === undefined) continue;
      const term = termFromCell({ row, cell: next.node, label: cell.value, value: next.value });
      if (term) {
        pairedTerms.push(term);
        pairedIndexes.add(index);
        pairedIndexes.add(index + 1);
      }
    }

    const valueTerms = cells
      .filter((_, index) => !pairedIndexes.has(index))
      .filter((cell) => isValueCell(cell.label, cell.value))
      .map((cell) => termFromCell({ row, cell: cell.node, label: cell.label, value: cell.value }))
      .filter((term): term is OperationalCoverageTerm => Boolean(term));
    return [...pairedTerms, ...valueTerms];
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
  const cells = cellRows(row, children, headerLabelsForRow(row, children));
  const named = cells.find((cell) => isNameCell(cell.label, cell.value));
  if (named) return cleanValue(named.value);
  const declarationName = declarationCoverageNameFromRow(row, children);
  if (declarationName) return declarationName;
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
  if (/^coverage part\s+s\b/i.test(coverage.name)) return false;
  if (/^(nwc|iso|cg|il|acord)[-\s]?[a-z0-9]/i.test(coverage.name)) return false;
  if (/\b(forms?|endorsements?|premium|payment|terrorism risk insurance act|tria|erp option|bilateral discovery)\b/i.test(name)) return false;
  if (/\b(incurred in excess|shall erode|subject to|combined defense expenses)\b/i.test(name)) return false;
  if (coverage.name.split(/\s+/).length > 16 && !/\b(coverage|liability|sub[-\s]?limit|aggregate|each\s+(claim|loss|occurrence)|limit)\b/i.test(coverage.name)) {
    return false;
  }
  return /\b(coverage|coverage part|liability|sub[-\s]?limit|aggregate|each\s+(claim|loss|occurrence|proceeding)|bricking|cyber|privacy|media|regulatory|defense|fraud|social engineering|ai\/ml|errors?\s*&?\s*omissions|technology)\b/i.test(coverage.name);
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
  if (isHeaderRow(row)) return undefined;
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
      return appliesTo && term.label !== appliesTo ? { ...term, appliesTo } : term;
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
      name: profile.namedInsured.normalizedValue ?? profile.namedInsured.value,
      sourceNodeIds: profile.namedInsured.sourceNodeIds,
      sourceSpanIds: profile.namedInsured.sourceSpanIds,
    });
  }
  if (profile.insurer) {
    parties.push({
      role: "insurer",
      name: profile.insurer.normalizedValue ?? profile.insurer.value,
      sourceNodeIds: profile.insurer.sourceNodeIds,
      sourceSpanIds: profile.insurer.sourceSpanIds,
    });
  }
  if (profile.broker) {
    parties.push({
      role: "broker",
      name: profile.broker.normalizedValue ?? profile.broker.value,
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
    policyNumber: policyNumberFromNodes(nodes),
    namedInsured: namedInsuredFromNodes(nodes),
    insurer: insurerFromNodes(nodes),
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
    premium: premiumFromNodes(nodes),
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
          const name = typeof record.name === "string" ? cleanValue(record.name) : undefined;
          const sourceNodeIds = keepIds(record.sourceNodeIds, validNodeIds);
          const sourceSpanIds = keepIds(record.sourceSpanIds, validSpanIds);
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
            name,
            coverageCode: typeof record.coverageCode === "string" ? cleanValue(record.coverageCode) : undefined,
            limit: typeof record.limit === "string" ? cleanValue(record.limit) : undefined,
            deductible: typeof record.deductible === "string" ? cleanValue(record.deductible) : undefined,
            premium: typeof record.premium === "string" ? cleanValue(record.premium) : undefined,
            retroactiveDate: typeof record.retroactiveDate === "string" ? cleanValue(record.retroactiveDate) : undefined,
            formNumber: typeof record.formNumber === "string" ? cleanValue(record.formNumber) : undefined,
            sectionRef: typeof record.sectionRef === "string" ? cleanValue(record.sectionRef) : undefined,
            coverageOrigin: record.coverageOrigin === "core" || record.coverageOrigin === "endorsement"
              ? record.coverageOrigin
              : undefined,
            endorsementNumber: typeof record.endorsementNumber === "string" ? cleanValue(record.endorsementNumber) : undefined,
            limits,
            sourceNodeIds,
            sourceSpanIds,
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
