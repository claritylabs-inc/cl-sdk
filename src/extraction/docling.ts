import type { SourceKind, SourceSpan, SourceSpanBBox } from "../source";
import { buildSourceSpan, sourceSpanTextHash } from "../source";

type JsonRecord = Record<string, unknown>;

export interface DoclingReferenceLike {
  $ref?: string;
  ref?: string;
}

export interface DoclingProvenanceLike {
  page_no?: number;
  pageNo?: number;
  page?: number;
  bbox?: unknown;
}

export interface DoclingItemLike {
  self_ref?: string;
  selfRef?: string;
  label?: string;
  text?: string;
  orig?: string;
  prov?: DoclingProvenanceLike[];
  children?: Array<string | DoclingReferenceLike>;
  data?: unknown;
  captions?: Array<string | DoclingReferenceLike>;
}

export interface DoclingNodeLike {
  self_ref?: string;
  selfRef?: string;
  label?: string;
  children?: Array<string | DoclingReferenceLike>;
}

export interface DoclingDocumentLike {
  name?: string;
  texts?: DoclingItemLike[];
  tables?: DoclingItemLike[];
  pictures?: DoclingItemLike[];
  key_value_items?: DoclingItemLike[];
  keyValueItems?: DoclingItemLike[];
  groups?: DoclingNodeLike[];
  body?: DoclingNodeLike;
  furniture?: DoclingNodeLike;
  pages?: unknown;
}

export interface DoclingExtractionInput {
  kind: "docling_document";
  document: DoclingDocumentLike;
  sourceKind?: SourceKind;
}

export interface DoclingNormalizedUnit {
  ref: string;
  label?: string;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  bboxes?: SourceSpanBBox[];
}

export interface NormalizedDoclingDocument {
  pageCount: number;
  fullText: string;
  pageTexts: Map<number, string>;
  units: DoclingNormalizedUnit[];
  sourceSpans: SourceSpan[];
}

export function isDoclingExtractionInput(input: unknown): input is DoclingExtractionInput {
  return Boolean(
    input
      && typeof input === "object"
      && (input as { kind?: unknown }).kind === "docling_document"
      && (input as { document?: unknown }).document
      && typeof (input as { document?: unknown }).document === "object",
  );
}

export function normalizeDoclingDocument(
  document: DoclingDocumentLike,
  options: {
    documentId: string;
    sourceKind?: SourceKind;
  },
): NormalizedDoclingDocument {
  const itemMap = buildItemMap(document);
  const orderedRefs = getOrderedBodyRefs(document, itemMap);
  const orderedItems = orderedRefs.length > 0
    ? orderedRefs
      .map((ref) => itemMap.get(ref))
      .filter((item): item is { ref: string; item: DoclingItemLike } => Boolean(item))
    : getFallbackOrderedItems(document, itemMap);

  const units = orderedItems
    .map(({ ref, item }) => normalizeItem(ref, item))
    .filter((unit): unit is DoclingNormalizedUnit => Boolean(unit && unit.text.trim()));

  const pageCount = inferPageCount(document, units);
  const pageTexts = new Map<number, string>();
  for (const unit of units) {
    const page = clampPage(unit.pageStart ?? 1, pageCount);
    pageTexts.set(page, appendText(pageTexts.get(page), unit.text));
  }

  const fullText = Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    const text = pageTexts.get(pageNumber)?.trim();
    return text ? `Page ${pageNumber}\n${text}` : "";
  }).filter(Boolean).join("\n\n");

  const sourceKind = options.sourceKind ?? "policy_pdf";
  const sourceSpans = units.map((unit, index) => {
    const span = buildSourceSpan(
      {
        documentId: options.documentId,
        sourceKind,
        text: unit.text,
        pageStart: unit.pageStart,
        pageEnd: unit.pageEnd,
        sectionId: unit.label,
        metadata: {
          sourceSystem: "docling",
          sourceUnit: "docling_item",
          doclingRef: unit.ref,
          ...(unit.label ? { doclingLabel: unit.label } : {}),
        },
      },
      index,
    );

    return {
      ...span,
      kind: "plain_text" as const,
      bbox: unit.bboxes?.length ? unit.bboxes : undefined,
    };
  });

  return {
    pageCount,
    fullText,
    pageTexts,
    units,
    sourceSpans,
  };
}

export function getDoclingPageRangeText(
  normalized: NormalizedDoclingDocument,
  startPage: number,
  endPage: number,
): string {
  const start = clampPage(startPage, normalized.pageCount);
  const end = clampPage(endPage, normalized.pageCount);
  const lines: string[] = [];
  for (let page = start; page <= end; page++) {
    const text = normalized.pageTexts.get(page)?.trim();
    if (text) {
      lines.push(`Page ${page}\n${text}`);
    }
  }
  return lines.join("\n\n");
}

export function buildDoclingProviderOptions(
  normalized: NormalizedDoclingDocument,
  existingOptions?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existingOptions,
    doclingText: normalized.fullText,
    doclingPageCount: normalized.pageCount,
  };
}

export function mergeSourceSpans(spans: SourceSpan[]): SourceSpan[] {
  const seen = new Set<string>();
  const merged: SourceSpan[] = [];
  for (const span of spans) {
    const key = [
      span.documentId,
      span.pageStart ?? span.location?.startPage ?? span.location?.page ?? "na",
      span.pageEnd ?? span.location?.endPage ?? span.pageStart ?? "na",
      span.sectionId ?? span.location?.fieldPath ?? "na",
      span.textHash ?? sourceSpanTextHash(span.text),
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(span);
  }
  return merged;
}

function buildItemMap(document: DoclingDocumentLike): Map<string, { ref: string; item: DoclingItemLike }> {
  const map = new Map<string, { ref: string; item: DoclingItemLike }>();
  addItems(map, "#/texts", document.texts ?? []);
  addItems(map, "#/tables", document.tables ?? []);
  addItems(map, "#/key_value_items", document.key_value_items ?? document.keyValueItems ?? []);
  addItems(map, "#/pictures", document.pictures ?? []);
  return map;
}

function addItems(
  map: Map<string, { ref: string; item: DoclingItemLike }>,
  baseRef: string,
  items: DoclingItemLike[],
): void {
  items.forEach((item, index) => {
    const ref = getSelfRef(item) ?? `${baseRef}/${index}`;
    map.set(ref, { ref, item });
  });
}

function getFallbackOrderedItems(
  document: DoclingDocumentLike,
  itemMap: Map<string, { ref: string; item: DoclingItemLike }>,
): Array<{ ref: string; item: DoclingItemLike }> {
  const refs = [
    ...(document.texts ?? []).map((item, index) => getSelfRef(item) ?? `#/texts/${index}`),
    ...(document.tables ?? []).map((item, index) => getSelfRef(item) ?? `#/tables/${index}`),
    ...(document.key_value_items ?? document.keyValueItems ?? []).map((item, index) => getSelfRef(item) ?? `#/key_value_items/${index}`),
  ];
  return refs
    .map((ref) => itemMap.get(ref))
    .filter((item): item is { ref: string; item: DoclingItemLike } => Boolean(item));
}

function getOrderedBodyRefs(
  document: DoclingDocumentLike,
  itemMap: Map<string, { ref: string; item: DoclingItemLike }>,
): string[] {
  const groupMap = new Map<string, DoclingNodeLike>();
  (document.groups ?? []).forEach((group, index) => {
    groupMap.set(getSelfRef(group) ?? `#/groups/${index}`, group);
  });

  const refs: string[] = [];
  const visited = new Set<string>();
  const visitRef = (ref: string): void => {
    const itemEntry = itemMap.get(ref);
    if (itemEntry) {
      if (!visited.has(ref)) {
        visited.add(ref);
        refs.push(ref);
      }
      visitNode(itemEntry.item);
      return;
    }
    visitNode(groupMap.get(ref));
  };

  const visitNode = (node: DoclingNodeLike | undefined): void => {
    for (const child of node?.children ?? []) {
      const ref = getRef(child);
      if (!ref) continue;
      visitRef(ref);
    }
  };

  visitNode(document.body);
  return refs;
}

function normalizeItem(ref: string, item: DoclingItemLike): DoclingNormalizedUnit | undefined {
  const text = getItemText(item).trim();
  if (!text) return undefined;

  const pages = (item.prov ?? [])
    .map((prov) => getPageNumber(prov))
    .filter((page): page is number => typeof page === "number" && page > 0);
  const pageStart = pages.length ? Math.min(...pages) : undefined;
  const pageEnd = pages.length ? Math.max(...pages) : pageStart;
  const bboxes = (item.prov ?? [])
    .map((prov) => toSourceSpanBBox(prov))
    .filter((bbox): bbox is SourceSpanBBox => Boolean(bbox));

  return {
    ref,
    label: typeof item.label === "string" ? item.label : undefined,
    text,
    pageStart,
    pageEnd,
    bboxes: bboxes.length ? bboxes : undefined,
  };
}

function getItemText(item: DoclingItemLike): string {
  if (typeof item.text === "string" && item.text.trim()) return item.text;
  if (typeof item.orig === "string" && item.orig.trim()) return item.orig;

  const table = tableToMarkdown(item.data);
  if (table) return table;

  return "";
}

function tableToMarkdown(data: unknown): string | undefined {
  const record = asRecord(data);
  const cells = Array.isArray(record?.table_cells)
    ? record.table_cells
    : Array.isArray(record?.tableCells)
      ? record.tableCells
      : undefined;
  if (!cells) return undefined;

  const parsedCells = cells
    .map((cell) => asRecord(cell))
    .filter((cell): cell is JsonRecord => Boolean(cell))
    .map((cell) => ({
      row: firstNumber([cell.start_row_offset, cell.row_header, cell.row, cell.rowIndex]) ?? 0,
      col: firstNumber([cell.start_col_offset, cell.col, cell.colIndex]) ?? 0,
      text: firstString([cell.text, cell.orig, cell.content]),
    }))
    .filter((cell) => cell.text);

  if (parsedCells.length === 0) return undefined;
  const maxRow = Math.max(...parsedCells.map((cell) => cell.row));
  const maxCol = Math.max(...parsedCells.map((cell) => cell.col));
  const rows = Array.from({ length: maxRow + 1 }, () => Array.from({ length: maxCol + 1 }, () => ""));
  for (const cell of parsedCells) {
    rows[cell.row][cell.col] = cell.text;
  }

  if (rows.length === 1) return rows[0].filter(Boolean).join(" | ");
  const header = rows[0];
  const separator = header.map(() => "---");
  return [header, separator, ...rows.slice(1)]
    .map((row) => `| ${row.map((value) => value.trim()).join(" | ")} |`)
    .join("\n");
}

function inferPageCount(document: DoclingDocumentLike, units: DoclingNormalizedUnit[]): number {
  const pages = document.pages;
  if (Array.isArray(pages)) return Math.max(1, pages.length);
  if (pages && typeof pages === "object") {
    const keys = Object.keys(pages);
    const numericMax = Math.max(0, ...keys.map((key) => Number(key)).filter((value) => Number.isFinite(value)));
    return Math.max(1, numericMax || keys.length);
  }
  return Math.max(1, ...units.flatMap((unit) => [unit.pageStart ?? 0, unit.pageEnd ?? 0]));
}

function getSelfRef(value: { self_ref?: string; selfRef?: string }): string | undefined {
  return value.self_ref ?? value.selfRef;
}

function getRef(value: string | DoclingReferenceLike): string | undefined {
  if (typeof value === "string") return value;
  return value.$ref ?? value.ref;
}

function getPageNumber(prov: DoclingProvenanceLike): number | undefined {
  return prov.page_no ?? prov.pageNo ?? prov.page;
}

function toSourceSpanBBox(prov: DoclingProvenanceLike): SourceSpanBBox | undefined {
  const page = getPageNumber(prov);
  const bbox = asRecord(prov.bbox);
  if (!page || !bbox) return undefined;

  const x = firstNumber([bbox.x, bbox.l, bbox.left]);
  const y = firstNumber([bbox.y, bbox.t, bbox.top]);
  const width = firstNumber([bbox.width]);
  const height = firstNumber([bbox.height]);
  const right = firstNumber([bbox.r, bbox.right]);
  const bottom = firstNumber([bbox.b, bbox.bottom]);

  if (x == null || y == null) return undefined;
  const resolvedWidth = width ?? (right != null ? right - x : undefined);
  const resolvedHeight = height ?? (bottom != null ? bottom - y : undefined);
  if (resolvedWidth == null || resolvedHeight == null) return undefined;

  return { page, x, y, width: resolvedWidth, height: resolvedHeight };
}

function clampPage(page: number, pageCount: number): number {
  return Math.max(1, Math.min(pageCount, page));
}

function appendText(existing: string | undefined, next: string): string {
  return existing ? `${existing}\n\n${next}` : next;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function firstString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
