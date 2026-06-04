import type { DocumentSourceNode, DocumentSourceNodeKind, SourceSpan } from "./schemas";
import { stableHash } from "./ids";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function truncate(value: string, maxChars: number): string {
  const text = normalizeWhitespace(value);
  return text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}...` : text;
}

function pageStart(span: SourceSpan): number | undefined {
  return span.pageStart ?? span.location?.page ?? span.location?.startPage;
}

function pageEnd(span: SourceSpan): number | undefined {
  return span.pageEnd ?? span.location?.endPage ?? pageStart(span);
}

function sourceUnit(span: SourceSpan): string | undefined {
  return span.sourceUnit ?? span.metadata?.sourceUnit ?? span.metadata?.elementType;
}

function elementType(span: SourceSpan): string | undefined {
  return span.metadata?.elementType ?? span.metadata?.sourceUnit ?? span.sourceUnit;
}

function tableId(span: SourceSpan): string | undefined {
  return span.table?.tableId ?? span.metadata?.tableId;
}

function rowSpanId(span: SourceSpan): string | undefined {
  return span.parentSpanId ?? span.table?.rowSpanId ?? span.metadata?.rowSpanId;
}

function nodeId(documentId: string, kind: string, parts: Array<string | number | undefined>): string {
  return [
    sanitizeIdPart(documentId),
    "source_node",
    kind,
    stableHash(parts.filter((part) => part !== undefined).join("|")).slice(0, 12),
  ].join(":");
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function nodeTextDescription(params: {
  kind: DocumentSourceNodeKind;
  title: string;
  text?: string;
  page?: number;
  formNumber?: string;
}): string {
  return [
    params.title,
    params.kind.replace(/_/g, " "),
    params.page ? `page ${params.page}` : undefined,
    params.formNumber ? `form ${params.formNumber}` : undefined,
    params.text ? truncate(params.text, 1200) : undefined,
  ].filter(Boolean).join(" | ");
}

function normalizeNodeKind(span: SourceSpan): DocumentSourceNodeKind {
  const unit = sourceUnit(span);
  const element = elementType(span);
  if (unit === "page") return "page";
  if (unit === "table") return "table";
  if (unit === "table_row") return "table_row";
  if (unit === "table_cell") return "table_cell";
  if (unit === "key_value") return "schedule";
  if (unit === "section") return "section";
  if (element === "section_candidate") {
    const text = span.text.toLowerCase();
    if (/endorsement/.test(text)) return "endorsement";
    if (/schedule|declarations?/.test(text)) return "schedule";
    if (/clause|condition|exclusion|definition/.test(text)) return "clause";
    return "section";
  }
  return "text";
}

function pageNodeTitle(page: number): string {
  return `Page ${page}`;
}

function makeNode(params: {
  id: string;
  documentId: string;
  parentId?: string;
  kind: DocumentSourceNodeKind;
  title: string;
  description?: string;
  textExcerpt?: string;
  sourceSpanIds?: string[];
  pageStart?: number;
  pageEnd?: number;
  bbox?: SourceSpan["bbox"];
  order: number;
  metadata?: Record<string, unknown>;
}): DocumentSourceNode {
  return {
    id: params.id,
    documentId: params.documentId,
    parentId: params.parentId,
    kind: params.kind,
    title: params.title,
    description: params.description ?? nodeTextDescription({
      kind: params.kind,
      title: params.title,
      text: params.textExcerpt,
      page: params.pageStart,
      formNumber: typeof params.metadata?.formNumber === "string" ? params.metadata.formNumber : undefined,
    }),
    textExcerpt: params.textExcerpt,
    sourceSpanIds: params.sourceSpanIds ?? [],
    pageStart: params.pageStart,
    pageEnd: params.pageEnd,
    bbox: params.bbox,
    order: params.order,
    path: "",
    metadata: params.metadata,
  };
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isTitleContentNode(node: DocumentSourceNode): boolean {
  if (node.kind !== "text") return false;
  const isMarkedTitle =
    metadataString(node.metadata, "elementType") === "title" ||
    metadataString(node.metadata, "sourceUnit") === "title";
  if (!isMarkedTitle) return false;

  const text = normalizeWhitespace(node.textExcerpt ?? node.title);
  if (!text || text.length > 140) return false;
  const words = text.split(/\s+/);
  if (words.length > 14) return false;

  const startsWithStructuredHeading = /^(section|item|part|coverage part|endorsement|schedule|article)\b|^[A-Z]\.\s|\b[IVX]+\.\s/i.test(text);
  const uppercaseLetters = [...text].filter((char) => /[A-Z]/.test(char)).length;
  const lowercaseLetters = [...text].filter((char) => /[a-z]/.test(char)).length;
  const mostlyUppercase = uppercaseLetters > 0 && uppercaseLetters >= lowercaseLetters * 1.6;
  const sentenceLike = /\b(is|are|was|were|will|shall|may|must|means|includes|provided|subject|available|attached|remain|constitutes)\b/i.test(text) &&
    /[a-z]/.test(text);

  return startsWithStructuredHeading || (mostlyUppercase && !sentenceLike);
}

function nodePageEnd(node: DocumentSourceNode): number | undefined {
  return node.pageEnd ?? node.pageStart;
}

function groupPageContentByTitles(nodes: DocumentSourceNode[]): DocumentSourceNode[] {
  const byParent = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of nodes) {
    const children = byParent.get(node.parentId) ?? [];
    children.push(node);
    byParent.set(node.parentId, children);
  }
  for (const children of byParent.values()) {
    children.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const pageNode of nodes.filter((node) => node.kind === "page")) {
    const children = (byParent.get(pageNode.id) ?? [])
      .filter((child) => child.kind !== "table_row" && child.kind !== "table_cell");
    let activeTitle: DocumentSourceNode | undefined;
    let activeContent: DocumentSourceNode[] = [];

    const flush = () => {
      if (!activeTitle || activeContent.length === 0) {
        activeTitle = undefined;
        activeContent = [];
        return;
      }

      const contentNodes = activeContent
        .map((node) => byId.get(node.id) ?? node)
        .filter((node) => node.parentId === pageNode.id);
      if (contentNodes.length === 0) {
        activeTitle = undefined;
        activeContent = [];
        return;
      }

      const evidenceNodes = [activeTitle, ...contentNodes];
      const title = truncate(activeTitle.textExcerpt ?? activeTitle.title, 120);
      const pageStarts = evidenceNodes
        .map((node) => node.pageStart)
        .filter((page): page is number => typeof page === "number");
      const pageEnds = evidenceNodes
        .map(nodePageEnd)
        .filter((page): page is number => typeof page === "number");
      const sourceSpanIds = [...new Set(evidenceNodes.flatMap((node) => node.sourceSpanIds))];
      const bbox = evidenceNodes.flatMap((node) => node.bbox ?? []).slice(0, 12);

      byId.set(activeTitle.id, {
        ...activeTitle,
        kind: "text",
        title,
        description: nodeTextDescription({
          kind: "text",
          title,
          text: evidenceNodes
            .map((node) => node.textExcerpt)
            .filter(Boolean)
            .join("\n\n"),
          page: activeTitle.pageStart,
        }),
        textExcerpt: evidenceNodes
          .map((node) => node.textExcerpt)
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 1600),
        sourceSpanIds,
        pageStart: pageStarts.length ? Math.min(...pageStarts) : activeTitle.pageStart,
        pageEnd: pageEnds.length ? Math.max(...pageEnds) : activeTitle.pageEnd,
        bbox,
        metadata: {
          ...activeTitle.metadata,
          sourceTreeVersion: "v3",
          organizer: "title_block",
        },
      });

      for (const node of contentNodes) {
        byId.set(node.id, { ...node, parentId: activeTitle.id });
      }
      activeTitle = undefined;
      activeContent = [];
    };

    for (const child of children) {
      if (isTitleContentNode(child)) {
        flush();
        activeTitle = child;
        activeContent = [];
        continue;
      }
      if (activeTitle) activeContent.push(child);
    }
    flush();
  }

  return nodes.map((node) => byId.get(node.id) ?? node);
}

function sortSpans(left: SourceSpan, right: SourceSpan): number {
  const leftPage = pageStart(left) ?? 0;
  const rightPage = pageStart(right) ?? 0;
  if (leftPage !== rightPage) return leftPage - rightPage;
  const leftRow = left.table?.rowIndex ?? Number(left.metadata?.rowIndex ?? 0);
  const rightRow = right.table?.rowIndex ?? Number(right.metadata?.rowIndex ?? 0);
  if (leftRow !== rightRow) return leftRow - rightRow;
  const leftCol = left.table?.columnIndex ?? Number(left.metadata?.columnIndex ?? 0);
  const rightCol = right.table?.columnIndex ?? Number(right.metadata?.columnIndex ?? 0);
  if (leftCol !== rightCol) return leftCol - rightCol;
  return left.id.localeCompare(right.id);
}

export function normalizeDocumentSourceTreePaths(nodes: DocumentSourceNode[]): DocumentSourceNode[] {
  const byParent = new Map<string | undefined, DocumentSourceNode[]>();
  for (const node of nodes) {
    const key = node.parentId;
    const group = byParent.get(key) ?? [];
    group.push(node);
    byParent.set(key, group);
  }
  for (const group of byParent.values()) {
    group.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  const result: DocumentSourceNode[] = [];
  const visited = new Set<string>();
  const visit = (node: DocumentSourceNode, path: string, ancestors: Set<string>, parentId?: string) => {
    if (visited.has(node.id) || ancestors.has(node.id)) return;
    visited.add(node.id);
    const next = { ...node, parentId, path };
    result.push(next);
    const children = byParent.get(node.id) ?? [];
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.id);
    children.forEach((child, index) => visit(child, `${path}.${index + 1}`, nextAncestors, node.id));
  };

  const roots = byParent.get(undefined) ?? [];
  roots.forEach((root, index) => visit(root, String(index + 1), new Set(), undefined));
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visit(node, String(result.length + 1), new Set(), undefined);
    }
  }
  return result;
}

export function buildDocumentSourceTree(sourceSpans: SourceSpan[], documentId?: string): DocumentSourceNode[] {
  const orderedSpans = [...sourceSpans].sort(sortSpans);
  const resolvedDocumentId = documentId ?? orderedSpans[0]?.documentId ?? "document";
  const nodes = new Map<string, DocumentSourceNode>();
  let order = 0;

  const rootId = nodeId(resolvedDocumentId, "document", [resolvedDocumentId]);
  nodes.set(rootId, makeNode({
    id: rootId,
    documentId: resolvedDocumentId,
    kind: "document",
    title: "Document",
    description: "Document root for source-native policy hierarchy",
    sourceSpanIds: orderedSpans.map((span) => span.id).slice(0, 200),
    pageStart: orderedSpans.map(pageStart).find((value): value is number => typeof value === "number"),
    pageEnd: [...orderedSpans].reverse().map(pageEnd).find((value): value is number => typeof value === "number"),
    order: order++,
    metadata: { sourceTreeVersion: "v3" },
  }));

  const pageNodeIds = new Map<number, string>();
  const tableNodeIds = new Map<string, string>();
  const rowNodeIds = new Map<string, string>();

  const ensurePage = (page: number) => {
    const existing = pageNodeIds.get(page);
    if (existing) return existing;
    const id = nodeId(resolvedDocumentId, "page", [page]);
    const pageSpan = orderedSpans.find((span) => pageStart(span) === page && sourceUnit(span) === "page");
    nodes.set(id, makeNode({
      id,
      documentId: resolvedDocumentId,
      parentId: rootId,
      kind: "page",
      title: pageNodeTitle(page),
      description: pageSpan
        ? nodeTextDescription({ kind: "page", title: pageNodeTitle(page), text: pageSpan.text, page })
        : pageNodeTitle(page),
      textExcerpt: pageSpan ? truncate(pageSpan.text, 1600) : undefined,
      sourceSpanIds: pageSpan ? [pageSpan.id] : [],
      pageStart: page,
      pageEnd: page,
      bbox: pageSpan?.bbox,
      order: order++,
      metadata: { sourceUnit: "page" },
    }));
    pageNodeIds.set(page, id);
    return id;
  };

  const ensureTable = (span: SourceSpan, pageParentId: string) => {
    const idSource = tableId(span) ?? `${span.documentId}:p${pageStart(span) ?? "na"}:table:${nodes.size}`;
    const existing = tableNodeIds.get(idSource);
    if (existing) return existing;
    const id = nodeId(resolvedDocumentId, "table", [idSource]);
    nodes.set(id, makeNode({
      id,
      documentId: resolvedDocumentId,
      parentId: pageParentId,
      kind: "table",
      title: `Table ${tableNodeIds.size + 1}`,
      description: `Table on page ${pageStart(span) ?? "unknown"} for source rows and cells`,
      sourceSpanIds: [],
      pageStart: pageStart(span),
      pageEnd: pageEnd(span),
      order: order++,
      metadata: { tableId: idSource, sourceUnit: "table" },
    }));
    tableNodeIds.set(idSource, id);
    return id;
  };

  const addStandaloneSpanNode = (span: SourceSpan, parentId: string) => {
    const kind = normalizeNodeKind(span);
    if (kind === "page") return;
    const page = pageStart(span);
    const title =
      span.sectionId ??
      span.formNumber ??
      (kind === "table_cell" && span.table?.columnName ? String(span.table.columnName) : undefined) ??
      titleCase(kind);
    const id = nodeId(resolvedDocumentId, kind, [span.id]);
    nodes.set(id, makeNode({
      id,
      documentId: resolvedDocumentId,
      parentId,
      kind,
      title,
      description: nodeTextDescription({ kind, title, text: span.text, page, formNumber: span.formNumber }),
      textExcerpt: truncate(span.text, 1600),
      sourceSpanIds: [span.id],
      pageStart: page,
      pageEnd: pageEnd(span),
      bbox: span.bbox,
      order: order++,
      metadata: {
        ...(span.metadata ?? {}),
        formNumber: span.formNumber,
        sourceUnit: sourceUnit(span),
      },
    }));
  };

  for (const span of orderedSpans) {
    const page = pageStart(span);
    const pageParentId = page ? ensurePage(page) : rootId;
    const kind = normalizeNodeKind(span);

    if (kind === "page") continue;

    if (kind === "table_row") {
      const tableParentId = ensureTable(span, pageParentId);
      const rowKey = span.id;
      const id = nodeId(resolvedDocumentId, "table_row", [span.id]);
      nodes.set(id, makeNode({
        id,
        documentId: resolvedDocumentId,
        parentId: tableParentId,
        kind,
        title: span.table?.isHeader ? "Header row" : `Row ${(span.table?.rowIndex ?? 0) + 1}`,
        description: nodeTextDescription({ kind, title: "Table row", text: span.text, page }),
        textExcerpt: truncate(span.text, 1600),
        sourceSpanIds: [span.id],
        pageStart: page,
        pageEnd: pageEnd(span),
        bbox: span.bbox,
        order: order++,
        metadata: {
          ...(span.metadata ?? {}),
          ...(span.table ?? {}),
          sourceUnit: "table_row",
        },
      }));
      rowNodeIds.set(rowKey, id);
      continue;
    }

    if (kind === "table_cell") {
      const tableParentId = ensureTable(span, pageParentId);
      const parentRowId = rowSpanId(span);
      const parentId = parentRowId ? rowNodeIds.get(parentRowId) ?? tableParentId : tableParentId;
      addStandaloneSpanNode(span, parentId);
      continue;
    }

    addStandaloneSpanNode(span, pageParentId);
  }

  return normalizeDocumentSourceTreePaths(groupPageContentByTitles([...nodes.values()]));
}
