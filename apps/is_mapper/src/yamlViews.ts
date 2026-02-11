import { type FieldEntry, type NodeEntry, type UiMap } from "@is-browser/contract";

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "string") return JSON.stringify(value);
  if (value.length === 0) return "\"\"";
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function keyName(key: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) return key;
  return JSON.stringify(key);
}

function renderYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (
          item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return `${pad}- ${scalar(item)}`;
        }
        return `${pad}-\n${renderYaml(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entry]) => entry !== undefined
    );
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, entry]) => {
        if (
          entry === null ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return `${pad}${keyName(key)}: ${scalar(entry)}`;
        }
        return `${pad}${keyName(key)}:\n${renderYaml(entry, indent + 2)}`;
      })
      .join("\n");
  }

  return `${pad}${scalar(value)}`;
}

function formatField(field: FieldEntry): Record<string, unknown> {
  const range =
    typeof field.constraints?.min === "number" || typeof field.constraints?.max === "number"
      ? [field.constraints?.min ?? null, field.constraints?.max ?? null]
      : undefined;

  return {
    ref: field.fieldId ?? field.id,
    label: field.label ?? field.id,
    labelQuality: field.labelQuality,
    control: field.controlType ?? field.type,
    valueType: field.valueType,
    default: field.defaultValue,
    current: field.currentValue,
    range,
    constraints: field.constraints,
    rangeHint: field.rangeHint,
    hints: field.hints,
    options: field.options?.map((option) => ({ value: option.value, label: option.label }))
  };
}

function groupsForNode(node: NodeEntry): Array<Record<string, unknown>> {
  return node.groups.map((group) => ({
    ref: group.groupId,
    title: group.title,
    order: group.order,
    fields: group.fields.map((field) => formatField(field))
  }));
}

function navPathForNode(node: NodeEntry): string[] {
  const breadcrumbs = node.breadcrumbs?.map((label) => (label ?? "").trim()).filter(Boolean);
  if (breadcrumbs && breadcrumbs.length > 0) {
    return breadcrumbs;
  }

  const labels = node.navPath
    ?.map((step) => step.label ?? step.selector?.name ?? step.selector?.value)
    .map((label) => (label ?? "").trim())
    .filter((label) => label.length <= 60)
    .filter((label) => !label.includes("|"))
    .filter(Boolean);
  if (labels && labels.length > 0) return labels;
  return [node.title];
}

export function buildNavigationView(map: UiMap): Array<Record<string, unknown>> {
  const nodes = map.nodes ?? [];
  return nodes
    .map((node) => ({
      ref: node.nodeId,
      path: navPathForNode(node),
      breadcrumb: node.breadcrumbs ?? [],
      container: { type: node.kind, title: node.title },
      groups: groupsForNode(node),
      actions: node.actions.map((action) => ({
        label: action.label,
        kind: action.kind
      }))
    }))
    .sort((a, b) => String(a.path).localeCompare(String(b.path)));
}

export function buildLayoutView(map: UiMap): Array<Record<string, unknown>> {
  const nodes = map.nodes ?? [];
  return nodes
    .map((node) => ({
      ref: node.nodeId,
      title: node.title,
      breadcrumb: node.breadcrumbs ?? [],
      container: { type: node.kind, title: node.title },
      groups: groupsForNode(node),
      actions: node.actions.map((action) => ({
        label: action.label,
        kind: action.kind
      })),
      snapshot: node.snapshots?.screenshotPath
    }))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

export function buildYamlViews(map: UiMap): { navigationYaml: string; layoutYaml: string } {
  const navigation = buildNavigationView(map);
  const layout = buildLayoutView(map);
  return {
    navigationYaml: `${renderYaml(navigation)}\n`,
    layoutYaml: `${renderYaml(layout)}\n`
  };
}

export function validateMapForYaml(
  map: UiMap,
  warn: (message: string) => void = (message) => console.warn(message)
): void {
  const missingLabelFields = map.fields.filter((field) => !((field.label ?? "").trim()));
  if (missingLabelFields.length > 0) {
    const sample = missingLabelFields.slice(0, 5).map((field) => field.id).join(", ");
    throw new Error(
      `Cannot export YAML: ${missingLabelFields.length} fields have empty labels. Sample field ids: ${sample}`
    );
  }

  const nullishCurrentValueCount = map.fields.filter(
    (field) => field.currentValue === null || field.currentValue === undefined
  ).length;
  const totalFields = map.fields.length;
  if (totalFields > 0 && nullishCurrentValueCount / totalFields > 0.5) {
    warn(
      `High null currentValue ratio: ${nullishCurrentValueCount}/${totalFields} fields have null/unknown current values.`
    );
  }

  const breadcrumbs = map.nodes
    ? map.nodes.flatMap((node) => node.breadcrumbs ?? [])
    : map.pages.flatMap((page) => page.breadcrumbs ?? []);
  const longBreadcrumbs = breadcrumbs.filter((breadcrumb) => breadcrumb.length > 80);
  if (longBreadcrumbs.length > 0) {
    warn(
      `Detected ${longBreadcrumbs.length} breadcrumb entries longer than 80 characters.`
    );
  }
}
