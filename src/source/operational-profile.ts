import type {
  DocumentSourceNode,
  OperationalCoverageLine,
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
  const labelled = text.match(/\b(?:coverage|coverage part|line)\s*:?\s*([^|;$]{3,80})/i)?.[1];
  if (labelled) return cleanValue(labelled);
  const parts = text.split(/\s+\|\s+| {2,}|\t/).map(cleanValue).filter(Boolean) as string[];
  const first = parts.find((part) =>
    !/^(limit|limits?|deductible|premium|amount|basis|rate|retroactive|aggregate|each occurrence)$/i.test(part)
    && !/^\$?[\d,]+/.test(part),
  );
  return cleanValue(first);
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

function buildCoverages(nodes: DocumentSourceNode[]): OperationalCoverageLine[] {
  const rows = nodes.filter((node) => {
    const text = nodeText(node);
    return (
      node.kind === "table_row" || node.kind === "schedule" || node.kind === "text"
    ) && /\b(coverage|limit|deductible|aggregate|occurrence|liability|premium)\b/i.test(text);
  });
  const coverages: OperationalCoverageLine[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const text = nodeText(row);
    const name = coverageNameFromRow(text);
    const limit = limitFromText(text);
    const deductible = deductibleFromText(text);
    const premium = premiumFromText(text);
    if (!name || (!limit && !deductible && !premium)) continue;
    const key = [name.toLowerCase(), limit, deductible, premium].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    coverages.push({
      name,
      limit,
      deductible,
      premium,
      formNumber: typeof row.metadata?.formNumber === "string" ? row.metadata.formNumber : undefined,
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

  const coverages = Array.isArray(candidate.coverages)
    ? candidate.coverages
        .map((coverage) => ({
          ...coverage,
          sourceNodeIds: keepIds((coverage as Record<string, unknown>).sourceNodeIds, validNodeIds),
          sourceSpanIds: keepIds((coverage as Record<string, unknown>).sourceSpanIds, validSpanIds),
        }))
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
