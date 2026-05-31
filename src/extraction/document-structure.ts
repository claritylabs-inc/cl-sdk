import type {
  DocumentAgentGuidance,
  DocumentMetadata,
  DocumentNode,
  DocumentPageMapEntry,
  DocumentTableOfContentsEntry,
  InsuranceDocument,
} from "../schemas/document";
import type { SourceSpan } from "../source";
import type { PageAssignment } from "../prompts/coordinator/page-map";

type FactRecord = Record<string, unknown>;

const FACT_ARRAY_PATHS = [
  "coverages",
  "enrichedCoverages",
  "endorsements",
  "exclusions",
  "conditions",
  "definitions",
  "coveredReasons",
  "taxesAndFees",
  "premiumBreakdown",
  "supplementaryFacts",
] as const;

function slugPart(value: unknown): string {
  const text = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || "node";
}

function numberValue(record: FactRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringValue(record: FactRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit;
}

function spanPage(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.page ?? span.location?.startPage;
}

function spanPageEnd(span: SourceSpan): number | undefined {
  return span.pageEnd ?? span.location?.endPage ?? spanPage(span);
}

function sourceSpansForPage(sourceSpans: SourceSpan[], page: number): string[] {
  return sourceSpans
    .filter((span) => spanPage(span) === page && sourceUnit(span) === "page")
    .map((span) => span.id);
}

function nodePageOverlaps(node: DocumentNode, record: FactRecord): boolean {
  const recordStart = numberValue(record, "pageNumber", "pageStart", "resolvedFromPage");
  const recordEnd = numberValue(record, "pageNumber", "pageEnd", "resolvedFromPage") ?? recordStart;
  if (!recordStart) return false;
  const nodeStart = node.pageStart ?? node.pageEnd;
  const nodeEnd = node.pageEnd ?? node.pageStart;
  if (!nodeStart) return false;
  return recordStart <= (nodeEnd ?? nodeStart) && (recordEnd ?? recordStart) >= nodeStart;
}

function nodeFormMatches(node: DocumentNode, record: FactRecord): boolean {
  const formNumber = stringValue(record, "formNumber");
  return Boolean(formNumber && node.formNumber && formNumber.toLowerCase() === node.formNumber.toLowerCase());
}

function nodeSourceOverlaps(node: DocumentNode, record: FactRecord): boolean {
  const nodeSourceIds = new Set(node.sourceSpanIds ?? []);
  if (nodeSourceIds.size === 0) return false;
  return stringArray(record.sourceSpanIds).some((id) => nodeSourceIds.has(id));
}

function findBestNode(nodes: DocumentNode[], record: FactRecord): DocumentNode | undefined {
  let best: { node: DocumentNode; score: number } | undefined;

  const visit = (node: DocumentNode) => {
    let score = 0;
    if (nodeSourceOverlaps(node, record)) score += 8;
    if (nodeFormMatches(node, record)) score += 4;
    if (nodePageOverlaps(node, record)) score += 3;
    if (score > 0 && (!best || score > best.score)) {
      best = { node, score };
    }
    for (const child of node.children ?? []) visit(child);
  };

  for (const node of nodes) visit(node);
  return best?.node;
}

function attachDocumentNodeIds(document: InsuranceDocument, nodes: DocumentNode[]): void {
  const doc = document as Record<string, unknown>;
  for (const path of FACT_ARRAY_PATHS) {
    const value = doc[path];
    if (!Array.isArray(value)) continue;
    doc[path] = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const record = item as FactRecord;
      if (typeof record.documentNodeId === "string" && record.documentNodeId.length > 0) return record;
      const node = findBestNode(nodes, record);
      return node ? { ...record, documentNodeId: node.id } : record;
    });
  }
}

function buildNodeFromSection(section: FactRecord, index: number): DocumentNode {
  const title = stringValue(section, "title", "name", "sectionRef") ?? `Section ${index + 1}`;
  const id = stringValue(section, "documentNodeId", "recordId") ?? `section:${index}:${slugPart(title)}`;
  const pageStart = numberValue(section, "pageStart", "pageNumber");
  const pageEnd = numberValue(section, "pageEnd", "pageNumber") ?? pageStart;
  const type = stringValue(section, "type");
  const coverageType = stringValue(section, "coverageType");
  const sourceSpanIds = stringArray(section.sourceSpanIds);

  const children = Array.isArray(section.subsections)
    ? section.subsections
        .filter((item): item is FactRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((subsection, childIndex): DocumentNode => {
          const childTitle = stringValue(subsection, "title", "name") ?? `${title} ${childIndex + 1}`;
          const childId =
            stringValue(subsection, "documentNodeId", "recordId") ??
            `${id}:subsection:${childIndex}:${slugPart(childTitle)}`;
          return {
            id: childId,
            title: childTitle,
            originalTitle: childTitle,
            type,
            label: type,
            level: 2,
            sectionNumber: stringValue(subsection, "sectionNumber"),
            pageStart: numberValue(subsection, "pageNumber") ?? pageStart,
            pageEnd: numberValue(subsection, "pageNumber") ?? pageStart,
            excerpt: stringValue(subsection, "excerpt"),
            content: stringValue(subsection, "content"),
            sourceSpanIds: stringArray(subsection.sourceSpanIds),
            sourceTextHash: stringValue(subsection, "sourceTextHash"),
          };
        })
    : undefined;

  return {
    id,
    title,
    originalTitle: title,
    type,
    label: type,
    level: 1,
    sectionNumber: stringValue(section, "sectionNumber"),
    pageStart,
    pageEnd,
    formNumber: stringValue(section, "formNumber"),
    formTitle: stringValue(section, "formTitle"),
    excerpt: stringValue(section, "excerpt"),
    content: stringValue(section, "content"),
    interpretationLabels: [type, coverageType].filter((value): value is string => Boolean(value)),
    sourceSpanIds: sourceSpanIds.length > 0 ? sourceSpanIds : undefined,
    sourceTextHash: stringValue(section, "sourceTextHash"),
    children: children && children.length > 0 ? children : undefined,
  };
}

function buildNodesFromSourceSpans(sourceSpans: SourceSpan[]): DocumentNode[] {
  const candidates = sourceSpans.filter((span) => {
    const unit = sourceUnit(span);
    return unit === "section" || unit === "section_candidate" || unit === "page";
  });

  return candidates
    .sort((left, right) => (spanPage(left) ?? 0) - (spanPage(right) ?? 0) || left.id.localeCompare(right.id))
    .map((span, index): DocumentNode => {
      const title =
        span.sectionId ??
        span.formNumber ??
        (sourceUnit(span) === "page" && spanPage(span) ? `Page ${spanPage(span)}` : `Source unit ${index + 1}`);
      return {
        id: `source:${index}:${slugPart(span.id)}`,
        title,
        originalTitle: title,
        type: sourceUnit(span),
        label: sourceUnit(span),
        level: 1,
        pageStart: spanPage(span),
        pageEnd: spanPageEnd(span),
        formNumber: span.formNumber,
        excerpt: span.text.slice(0, 500),
        sourceSpanIds: [span.id],
        sourceTextHash: span.textHash ?? span.hash,
      };
    });
}

function flattenToc(nodes: DocumentNode[]): DocumentTableOfContentsEntry[] {
  const entries: DocumentTableOfContentsEntry[] = [];
  const visit = (node: DocumentNode) => {
    entries.push({
      title: node.title,
      level: node.level,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      documentNodeId: node.id,
      sourceSpanIds: node.sourceSpanIds,
    });
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return entries;
}

function buildPageMap(
  pageAssignments: PageAssignment[],
  sourceSpans: SourceSpan[],
  document: InsuranceDocument,
): DocumentPageMapEntry[] {
  const forms = document.formInventory ?? [];
  return pageAssignments
    .sort((left, right) => left.localPageNumber - right.localPageNumber)
    .map((assignment) => {
      const form = forms.find((item) => {
        const start = item.pageStart;
        const end = item.pageEnd ?? start;
        return start != null && end != null && assignment.localPageNumber >= start && assignment.localPageNumber <= end;
      });
      return {
        page: assignment.localPageNumber,
        label: assignment.notes,
        formNumber: form?.formNumber,
        formTitle: form?.title,
        extractorNames: assignment.extractorNames,
        sourceSpanIds: sourceSpansForPage(sourceSpans, assignment.localPageNumber),
      };
    });
}

function buildAgentGuidance(document: InsuranceDocument): DocumentAgentGuidance[] {
  const guidance: DocumentAgentGuidance[] = [
    {
      kind: "source_structure",
      title: "Use the source outline as navigation",
      detail:
        "The documentOutline preserves source order and page ranges. Treat interpretation labels as hints, not as a replacement for the source document structure.",
    },
  ];

  if (document.declarations) {
    guidance.push({
      kind: "declarations",
      title: "Declarations establish policy facts",
      detail:
        "Declarations and schedules generally establish named insured, policy period, limits, deductibles, premium, and rating facts unless modified elsewhere.",
    });
  }

  if (document.endorsements?.length || document.formInventory?.some((form) => form.formType === "endorsement")) {
    guidance.push({
      kind: "endorsement_override",
      title: "Endorsements may override base terms",
      detail:
        "Endorsements and change forms can add, remove, or override base policy wording. When terms conflict, inspect the effective endorsement language and source page.",
    });
  }

  return guidance;
}

export function attachDocumentStructure(params: {
  document: InsuranceDocument;
  pageAssignments: PageAssignment[];
  sourceSpans: SourceSpan[];
}): InsuranceDocument {
  const docRecord = params.document as Record<string, unknown>;
  const sections = Array.isArray(params.document.sections) ? params.document.sections : [];
  const existingOutline = Array.isArray(docRecord.documentOutline)
    ? (docRecord.documentOutline as DocumentNode[])
    : [];
  const documentOutline = existingOutline.length > 0
    ? existingOutline
    : sections.length > 0
      ? sections.map((section, index) => buildNodeFromSection(section as FactRecord, index))
      : buildNodesFromSourceSpans(params.sourceSpans);

  if (documentOutline.length > 0) {
    attachDocumentNodeIds(params.document, documentOutline);
  }

  const metadata: DocumentMetadata = {
    ...(docRecord.documentMetadata && typeof docRecord.documentMetadata === "object"
      ? (docRecord.documentMetadata as DocumentMetadata)
      : {}),
    ...(params.document.formInventory?.length ? { formInventory: params.document.formInventory } : {}),
    ...(documentOutline.length > 0 ? { tableOfContents: flattenToc(documentOutline) } : {}),
    ...(params.pageAssignments.length > 0
      ? { pageMap: buildPageMap(params.pageAssignments, params.sourceSpans, params.document) }
      : {}),
    agentGuidance: buildAgentGuidance(params.document),
  };

  docRecord.documentMetadata = metadata;
  docRecord.documentOutline = documentOutline;
  return params.document;
}
