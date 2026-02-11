import { createHash } from "node:crypto";
import {
  type ActionEntry,
  type EdgeEntry,
  type FieldEntry,
  type NavStep,
  type NodeEntry,
  type PageEntry,
  type Selector,
  type UiMap
} from "@is-browser/contract";

type ClickLogLike = {
  clicks: Array<{
    target: string;
    selectors: Array<{ kind: "role" | "label" | "css"; role?: string; name?: string; value?: string }>;
    urlBefore: string;
    urlAfter: string;
    frameUrl?: string;
    timestamp?: string;
    kind?: NavStep["kind"];
    newFieldIds: string[];
  }>;
};

type CanonicalGraphOptions = {
  runId: string;
  capturedAt?: string;
  mapperVersion?: string;
  clickLog?: ClickLogLike;
  snapshotsByPageId?: Map<string, string>;
};

function hashValue(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function normalizeSpace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function selectorSignature(selector: Selector): string {
  if (selector.kind === "role") {
    return `role:${selector.role ?? ""}:${selector.name ?? ""}`;
  }
  if (selector.kind === "label") {
    return `label:${selector.value ?? ""}`;
  }
  if (selector.kind === "css") {
    return `css:${selector.value ?? ""}`;
  }
  return `text:${selector.value ?? ""}`;
}

function actionKindFromLabel(label: string | undefined): ActionEntry["kind"] {
  const normalized = normalizeSpace(label).toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("save")) return "save";
  if (normalized.includes("cancel")) return "cancel";
  if (normalized.includes("apply")) return "apply";
  if (normalized.includes("close") || normalized === "ok" || normalized === "done") return "close";
  if (normalized.includes("reset")) return "reset";
  return "unknown";
}

function controlTypeFromField(field: FieldEntry): NonNullable<FieldEntry["controlType"]> {
  if (field.controlType) return field.controlType;
  if (field.type === "checkbox") return "checkbox";
  if (field.type === "number") return "number";
  if (field.type === "select") return "dropdown";
  if (field.type === "radio") return "radio_group";
  if (field.type === "button") return "button";
  if (field.type === "text" || field.type === "textarea") return "textbox";
  return "unknown";
}

function valueTypeFromField(field: FieldEntry): NonNullable<FieldEntry["valueType"]> {
  if (field.valueType) return field.valueType;
  const controlType = controlTypeFromField(field);
  if (controlType === "checkbox" || controlType === "switch") return "boolean";
  if (controlType === "number") return "number";
  if (controlType === "dropdown" || controlType === "radio_group") return "enum";
  if (controlType === "textbox") return "string";
  return "unknown";
}

function groupTitleFromField(field: FieldEntry): string {
  const explicit = normalizeSpace(field.groupTitle);
  if (explicit) return explicit;
  const fromKey = normalizeSpace(field.groupKey);
  if (!fromKey || fromKey === "group:general") return "General";
  return fromKey
    .replace(/^group:/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function navStepLabel(step: NavStep): string | undefined {
  if (step.label) return normalizeSpace(step.label);
  if (step.selector?.name) return normalizeSpace(step.selector.name);
  if (step.selector?.value) return normalizeSpace(step.selector.value);
  if (step.url) return normalizeSpace(step.url);
  return undefined;
}

function isOptionBlobLabel(label: string): boolean {
  if (label.length > 60) return true;
  if (label.includes("|")) return true;
  if ((label.match(/[,;]/g) ?? []).length >= 3) return true;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 10) return true;
  if (words.length >= 6) {
    const uniqueWordCount = new Set(words.map((word) => word.toLowerCase())).size;
    if (uniqueWordCount / words.length < 0.6) return true;
  }
  return false;
}

export function shouldContributeToBreadcrumb(step: NavStep): boolean {
  if (step.action !== "click") return false;
  if (!step.kind || step.kind === "unknown") return false;
  if (!["tab", "menu", "link", "button"].includes(step.kind)) return false;

  const label = navStepLabel(step);
  if (!label) return false;
  if (isOptionBlobLabel(label)) return false;
  if (/^(save|apply|cancel|close|ok|submit|done|reset)$/i.test(label)) return false;
  return true;
}

function breadcrumbsFromPage(page: PageEntry): string[] | undefined {
  const explicit = page.breadcrumbs
    ?.map((label) => normalizeSpace(label))
    .filter(Boolean)
    .filter((label) => label.length <= 80);
  if (explicit && explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  const fromNav = page.navPath
    ?.filter((step) => shouldContributeToBreadcrumb(step))
    .map((step) => navStepLabel(step))
    .filter((label): label is string => Boolean(label))
    .filter((label) => !isOptionBlobLabel(label));
  if (fromNav && fromNav.length > 0) {
    return Array.from(new Set(fromNav));
  }

  const title = normalizeSpace(page.title);
  if (title.includes("/")) {
    const split = title
      .split("/")
      .map((part) => normalizeSpace(part))
      .filter(Boolean);
    if (split.length > 0) return split;
  }

  return undefined;
}

function inferNodeKind(page: PageEntry): NodeEntry["kind"] {
  const probe = `${page.id} ${page.title ?? ""}`.toLowerCase();
  if (probe.includes("modal") || probe.includes("dialog")) return "modal";
  if (probe.includes("drawer")) return "drawer";
  if (probe.includes("iframe") || probe.includes("frame")) return "iframe";
  return "page";
}

function inferTriggerKind(
  selector: Selector | undefined,
  fallback: NavStep["kind"] | undefined
): NavStep["kind"] {
  if (fallback) return fallback;
  if (!selector || selector.kind !== "role") return "unknown";
  if (selector.role === "tab") return "tab";
  if (selector.role === "link") return "link";
  if (selector.role === "button") return "button";
  if (selector.role === "menuitem") return "menu";
  return "unknown";
}

function classifyEdgeType(
  fromNode: NodeEntry | undefined,
  toNode: NodeEntry | undefined,
  trigger: NavStep,
  urlBefore?: string,
  urlAfter?: string
): EdgeEntry["edgeType"] {
  const fromUrl = normalizeUrl(urlBefore ?? fromNode?.url);
  const toUrl = normalizeUrl(urlAfter ?? toNode?.url);
  if (fromUrl && toUrl && fromUrl !== toUrl) return "navigate";
  if (fromNode?.kind !== "modal" && toNode?.kind === "modal") return "open_modal";
  if (fromNode?.kind === "modal" && toNode?.kind !== "modal") return "close_modal";
  if (trigger.kind === "tab" || trigger.selector?.role === "tab") return "tab_switch";
  return "expand_section";
}

function fieldSortKey(field: FieldEntry): string {
  return `${field.groupOrder ?? 9999}|${normalizeSpace(field.label)}|${field.id}`;
}

function dedupeActions(fields: FieldEntry[]): ActionEntry[] {
  const bySelector = new Map<string, ActionEntry>();
  for (const field of fields) {
    for (const action of field.actions ?? []) {
      const selectorKey = selectorSignature(action.selector);
      if (bySelector.has(selectorKey)) continue;
      const label = normalizeSpace(action.label ?? action.selector.name ?? action.selector.value) || "Action";
      bySelector.set(selectorKey, {
        label,
        kind: actionKindFromLabel(label),
        selector: action.selector
      });
    }
  }
  return Array.from(bySelector.values());
}

function addEdge(
  edges: EdgeEntry[],
  seen: Set<string>,
  edge: EdgeEntry
): void {
  const key = `${edge.fromNodeId}|${edge.toNodeId}|${edge.edgeType}|${navStepLabel(edge.trigger) ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(edge);
}

function pageIdForUrl(pages: PageEntry[], url: string | undefined): string | undefined {
  if (!url) return undefined;
  const normalized = normalizeUrl(url);
  const match = pages
    .slice()
    .reverse()
    .find((page) => normalizeUrl(page.url) === normalized);
  return match?.id;
}

export function attachCanonicalGraph(map: UiMap, options: CanonicalGraphOptions): UiMap {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  map.meta.capturedAt = map.meta.capturedAt ?? capturedAt;
  map.meta.runId = options.runId;
  map.meta.version = map.meta.version ?? "ui-graph-1";
  if (options.mapperVersion) {
    map.meta.mapperVersion = map.meta.mapperVersion ?? options.mapperVersion;
  }

  for (const field of map.fields) {
    field.fieldId = field.fieldId ?? field.selectorKey ?? field.id;
    field.controlType = controlTypeFromField(field);
    field.valueType = valueTypeFromField(field);
    field.readonly = field.readonly ?? field.constraints?.readOnly ?? false;
    field.visibility = field.visibility ?? { visible: true, enabled: !field.readonly };
    field.groupTitle = groupTitleFromField(field);
    field.groupKey = field.groupKey ?? `group:${field.groupTitle.toLowerCase().replace(/\s+/g, "-")}`;
    field.groupOrder = field.groupOrder ?? 1;
    field.source = field.source ?? { discoveredFrom: "scan", runId: options.runId };
  }

  const fieldsByPage = new Map<string, FieldEntry[]>();
  for (const field of map.fields.sort((a, b) => fieldSortKey(a).localeCompare(fieldSortKey(b)))) {
    const bucket = fieldsByPage.get(field.pageId) ?? [];
    bucket.push(field);
    fieldsByPage.set(field.pageId, bucket);
  }

  const nodes: NodeEntry[] = [];
  const pageToNode = new Map<string, string>();
  const nodeById = new Map<string, NodeEntry>();
  const usedNodeIds = new Set<string>();

  for (const page of map.pages) {
    const pageFields = fieldsByPage.get(page.id) ?? [];
    const groupsByKey = new Map<
      string,
      { groupId: string; title: string; order: number; fields: FieldEntry[] }
    >();

    let nextGroupOrder = 1;
    for (const field of pageFields) {
      const key = field.groupKey ?? "group:general";
      const title = field.groupTitle ?? "General";
      const order = field.groupOrder ?? nextGroupOrder;
      const existing = groupsByKey.get(key);
      if (existing) {
        existing.fields.push(field);
        continue;
      }
      groupsByKey.set(key, {
        groupId: key,
        title,
        order,
        fields: [field]
      });
      nextGroupOrder = Math.max(nextGroupOrder, order + 1);
    }

    const groups = Array.from(groupsByKey.values())
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .map((group) => ({
        groupId: group.groupId,
        title: group.title,
        order: group.order,
        fields: group.fields.sort((a, b) => fieldSortKey(a).localeCompare(fieldSortKey(b)))
      }));

    const breadcrumbs = breadcrumbsFromPage(page);
    const kind = inferNodeKind(page);
    const fingerprint = hashValue(
      [
        kind,
        normalizeUrl(page.url),
        normalizeSpace(page.title),
        (breadcrumbs ?? []).join(">"),
        groups.map((group) => group.title).join("|"),
        pageFields.map((field) => normalizeSpace(field.label)).slice(0, 10).join("|")
      ].join("|")
    );

    let nodeId = `node-${fingerprint.slice(0, 12)}`;
    let suffix = 2;
    while (usedNodeIds.has(nodeId)) {
      nodeId = `node-${fingerprint.slice(0, 12)}-${suffix}`;
      suffix += 1;
    }
    usedNodeIds.add(nodeId);

    const node: NodeEntry = {
      nodeId,
      kind,
      title: normalizeSpace(page.title) || page.id,
      url: page.url,
      frameUrl: undefined,
      breadcrumbs,
      navPath: page.navPath,
      groups,
      actions: dedupeActions(pageFields),
      fingerprint
    };

    const screenshotPath = options.snapshotsByPageId?.get(page.id);
    if (screenshotPath) {
      node.snapshots = { screenshotPath };
    }

    nodes.push(node);
    nodeById.set(nodeId, node);
    pageToNode.set(page.id, nodeId);
  }

  const edges: EdgeEntry[] = [];
  const seenEdges = new Set<string>();
  const pageIdByFieldId = new Map<string, string>();
  for (const field of map.fields) {
    pageIdByFieldId.set(field.id, field.pageId);
  }

  if (options.clickLog && options.clickLog.clicks.length > 0) {
    let currentPageId = map.pages[0]?.id;
    for (const click of options.clickLog.clicks) {
      const inferredFrom = currentPageId ?? pageIdForUrl(map.pages, click.urlBefore);
      let inferredTo = click.newFieldIds
        .map((fieldId) => pageIdByFieldId.get(fieldId))
        .find((pageId): pageId is string => Boolean(pageId));
      if (!inferredTo) {
        inferredTo = pageIdForUrl(map.pages, click.urlAfter) ?? inferredFrom;
      }

      if (!inferredFrom || !inferredTo) {
        currentPageId = inferredTo ?? inferredFrom;
        continue;
      }

      const selector = click.selectors[0];
      const triggerSelector: Selector | undefined = selector
        ? {
            kind: selector.kind,
            role: selector.role,
            name: selector.name,
            value: selector.value
          }
        : undefined;
      const trigger: NavStep = {
        action: "click",
        selector: triggerSelector,
        label: click.target,
        kind: inferTriggerKind(triggerSelector, click.kind),
        urlBefore: click.urlBefore,
        urlAfter: click.urlAfter,
        frameUrl: click.frameUrl,
        timestamp: click.timestamp
      };

      const fromNodeId = pageToNode.get(inferredFrom);
      const toNodeId = pageToNode.get(inferredTo);
      if (!fromNodeId || !toNodeId) {
        currentPageId = inferredTo;
        continue;
      }

      addEdge(edges, seenEdges, {
        fromNodeId,
        toNodeId,
        trigger,
        edgeType: classifyEdgeType(
          nodeById.get(fromNodeId),
          nodeById.get(toNodeId),
          trigger,
          click.urlBefore,
          click.urlAfter
        )
      });
      currentPageId = inferredTo;
    }
  } else {
    for (let i = 1; i < map.pages.length; i += 1) {
      const page = map.pages[i];
      const previous = map.pages[i - 1];
      const trigger = page.navPath?.at(-1);
      if (!trigger || trigger.action !== "click") continue;

      const fromNodeId = pageToNode.get(previous.id);
      const toNodeId = pageToNode.get(page.id);
      if (!fromNodeId || !toNodeId) continue;

      addEdge(edges, seenEdges, {
        fromNodeId,
        toNodeId,
        trigger: {
          ...trigger,
          label: navStepLabel(trigger),
          kind: inferTriggerKind(trigger.selector, trigger.kind)
        },
        edgeType: classifyEdgeType(
          nodeById.get(fromNodeId),
          nodeById.get(toNodeId),
          trigger,
          previous.url,
          page.url
        )
      });
    }
  }

  map.nodes = nodes;
  map.edges = edges;
  return map;
}
