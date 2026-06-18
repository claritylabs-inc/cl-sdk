import type {
  ApplicationField,
  ApplicationQuestionCondition,
  ApplicationQuestionGraph,
  ApplicationQuestionNode,
  ApplicationState,
} from "../schemas/application";

export interface BuildQuestionGraphOptions {
  id: string;
  version?: string;
  title?: string;
  applicationType?: string | null;
  source?: ApplicationQuestionGraph["source"];
}

export function buildQuestionGraphFromFields(
  fields: ApplicationField[],
  options: BuildQuestionGraphOptions,
): ApplicationQuestionGraph {
  const sectionNodes = new Map<string, ApplicationQuestionNode>();
  const nodes: ApplicationQuestionNode[] = [];

  for (const [index, field] of fields.entries()) {
    const sectionId = stableNodeId(["section", field.section]);
    let sectionNode = sectionNodes.get(sectionId);
    if (!sectionNode) {
      sectionNode = {
        id: sectionId,
        nodeType: "group",
        label: field.section,
        order: sectionNodes.size,
        children: [],
      };
      sectionNodes.set(sectionId, sectionNode);
      nodes.push(sectionNode);
    }

    const child: ApplicationQuestionNode = {
      id: field.fieldAnchorId ?? stableNodeId(["field", field.section, field.id || field.label]),
      nodeType: field.fieldType === "table" ? "table" : "question",
      fieldId: field.id,
      fieldPath: `${field.section}.${field.id}`,
      parentId: sectionId,
      order: index,
      label: field.label,
      section: field.section,
      fieldType: field.fieldType,
      required: field.required,
      options: field.options,
      columns: field.columns,
      condition: field.condition
        ? {
            dependsOn: field.condition.dependsOn,
            operator: "equals",
            value: field.condition.whenValue,
            whenValue: field.condition.whenValue,
          }
        : undefined,
    };
    sectionNode.children = [...(sectionNode.children ?? []), child];
  }

  return normalizeApplicationQuestionGraph({
    id: options.id,
    version: options.version ?? "v1",
    title: options.title,
    applicationType: options.applicationType,
    source: options.source ?? "generated",
    rootNodeIds: nodes.map((node) => node.id),
    nodes,
  });
}

export function normalizeApplicationQuestionGraph(graph: ApplicationQuestionGraph): ApplicationQuestionGraph {
  const normalizedNodes = graph.nodes
    .map((node, index) => normalizeNode(node, undefined, index))
    .sort(compareNodes);

  return {
    ...graph,
    rootNodeIds: graph.rootNodeIds?.length
      ? graph.rootNodeIds
      : normalizedNodes.map((node) => node.id),
    nodes: normalizedNodes,
  };
}

export function flattenQuestionGraph(graph: ApplicationQuestionGraph): ApplicationField[] {
  const fields: ApplicationField[] = [];

  for (const node of graph.nodes.sort(compareNodes)) {
    collectFields(node, fields);
  }

  return fields;
}

export function getActiveApplicationFields(state: Pick<ApplicationState, "fields" | "questionGraph">): ApplicationField[] {
  const valueByFieldId = new Map(
    state.fields
      .filter((field) => field.value !== undefined && field.value.trim() !== "")
      .map((field) => [field.id, field.value ?? ""]),
  );
  const graphConditions = new Map<string, ApplicationQuestionCondition>();

  for (const node of state.questionGraph?.nodes ?? []) {
    collectNodeConditions(node, graphConditions);
  }

  return state.fields.filter((field) => {
    const graphCondition = graphConditions.get(field.id);
    return isConditionSatisfied(field.condition, valueByFieldId)
      && isQuestionConditionSatisfied(graphCondition, valueByFieldId);
  });
}

export function getNextApplicationQuestions(
  state: Pick<ApplicationState, "fields" | "questionGraph" | "batches" | "currentBatchIndex">,
  limit = 8,
): ApplicationField[] {
  const activeUnfilled = getActiveApplicationFields(state).filter((field) => !field.value);
  if (activeUnfilled.length === 0) return [];

  const currentBatchIds = state.batches?.[state.currentBatchIndex] ?? [];
  const currentBatchFields = activeUnfilled.filter((field) => currentBatchIds.includes(field.id));
  return (currentBatchFields.length > 0 ? currentBatchFields : activeUnfilled).slice(0, limit);
}

function normalizeNode(
  node: ApplicationQuestionNode,
  parentId: string | undefined,
  index: number,
): ApplicationQuestionNode {
  const children = node.children?.map((child, childIndex) => normalizeNode(child, node.id, childIndex));
  return {
    ...node,
    parentId: node.parentId ?? parentId,
    order: node.order ?? index,
    fieldPath: node.fieldPath ?? (node.fieldId ? [node.section, node.fieldId].filter(Boolean).join(".") : undefined),
    children,
  };
}

function collectFields(node: ApplicationQuestionNode, fields: ApplicationField[]): void {
  if ((node.nodeType === "question" || node.nodeType === "table") && node.fieldId) {
    fields.push({
      id: node.fieldId,
      label: node.label,
      section: node.section ?? "General",
      fieldType: node.fieldType ?? (node.nodeType === "table" ? "table" : "text"),
      required: node.required ?? false,
      options: node.options,
      columns: node.columns,
      condition: node.condition
        ? {
            dependsOn: node.condition.dependsOn,
            whenValue: node.condition.value ?? node.condition.whenValue ?? "",
          }
        : undefined,
      fieldAnchorId: node.id,
    });
  }

  for (const child of node.children ?? []) {
    collectFields(child, fields);
  }
}

function collectNodeConditions(node: ApplicationQuestionNode, conditions: Map<string, ApplicationQuestionCondition>): void {
  if (node.fieldId && node.condition) {
    conditions.set(node.fieldId, node.condition);
  }
  for (const child of node.children ?? []) {
    collectNodeConditions(child, conditions);
  }
}

function isConditionSatisfied(
  condition: ApplicationField["condition"] | undefined,
  valueByFieldId: Map<string, string>,
): boolean {
  if (!condition) return true;
  const current = valueByFieldId.get(condition.dependsOn);
  return normalizeValue(current) === normalizeValue(condition.whenValue);
}

function isQuestionConditionSatisfied(
  condition: ApplicationQuestionCondition | undefined,
  valueByFieldId: Map<string, string>,
): boolean {
  if (!condition) return true;
  const current = valueByFieldId.get(condition.dependsOn);
  const expected = condition.value ?? condition.whenValue;
  const values = condition.values ?? (expected !== undefined ? [expected] : []);

  switch (condition.operator) {
    case "exists":
      return current !== undefined && current.trim() !== "";
    case "not_equals":
      return normalizeValue(current) !== normalizeValue(expected);
    case "in":
      return values.map(normalizeValue).includes(normalizeValue(current));
    case "not_in":
      return !values.map(normalizeValue).includes(normalizeValue(current));
    case "equals":
    default:
      return normalizeValue(current) === normalizeValue(expected);
  }
}

function compareNodes(a: ApplicationQuestionNode, b: ApplicationQuestionNode): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

function normalizeValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function stableNodeId(parts: string[]): string {
  return parts
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "node";
}
