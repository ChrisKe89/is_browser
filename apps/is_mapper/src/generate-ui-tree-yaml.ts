import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { canonicalizeUrlForIdentity } from "./utils.js";

interface ClickEvent {
  seq: number;
  at: string;
  reason: string;
  page_url: string;
  page_title?: string;
}

interface TriggerLike {
  selector?: string;
  label?: string;
  kind?: string;
  edgeType?: string;
  click?: string;
  via?: string;
}

interface EdgeLike {
  from: string;
  to: string;
  triggers?: TriggerLike[];
  trigger?: TriggerLike;
  edgeType?: string;
}

interface NodeLike {
  canonicalRoute?: string;
  title?: string;
  breadcrumb?: string;
}

interface ClickGraph {
  events?: ClickEvent[];
  nodes?: Record<string, NodeLike>;
  edges?: EdgeLike[];
}

interface SettingDescriptor {
  key?: string;
  id?: string;
  label?: string | null;
  type?: string;
  kind?: string;
  section?: string | null;
  selector?: string;
  dom_selector?: string;
  value_source?: string;
  default_value?: unknown;
  current_value?: unknown;
  options?: unknown[];
}

interface SettingsPage {
  url: string;
  title?: string;
  settings?: SettingDescriptor[];
}

interface SettingsRoot {
  pages?: SettingsPage[];
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function canonicalRoute(raw: string): string {
  return canonicalizeUrlForIdentity(raw);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => typeof v === "string" && v.trim().length > 0)?.trim();
}

function inferTrigger(fromRoute: string, toRoute: string): TriggerLike {
  const toHash = toRoute.split("#")[1] ?? "";
  const labels: Record<string, string> = {
    hashHome: "Home",
    hashPermissions: "Permissions",
    "hashLogInOutSettings/hashPermissions": "Authentication and Accounting",
    hashConnectivity: "Network",
    "hashNetwork/hashConnectivity": "Ethernet",
    "hashProtocols/hashConnectivity": "Protocols",
    hashApps: "Apps"
  };

  const label = labels[toHash] ?? (toHash || toRoute);
  return {
    label,
    selector: `role=button[name='${label}']`,
    kind: "button",
    edgeType: fromRoute.split("#")[0] === toRoute.split("#")[0] ? "in_page" : "cross_page"
  };
}

function buildFallbackGraph(clicks: ClickGraph, settings: SettingsRoot): { nodes: Record<string, NodeLike>; edges: EdgeLike[] } {
  const events = (clicks.events ?? []).slice().sort((a, b) => a.seq - b.seq);
  const routeToNodeId = new Map<string, string>();
  const nodes: Record<string, NodeLike> = {};

  const allRoutes = new Set<string>();
  for (const ev of events) allRoutes.add(canonicalRoute(ev.page_url));
  for (const p of settings.pages ?? []) allRoutes.add(canonicalRoute(p.url));

  for (const route of Array.from(allRoutes).sort()) {
    const ev = events.find((e) => canonicalRoute(e.page_url) === route);
    const page = (settings.pages ?? []).find((p) => canonicalRoute(p.url) === route);
    const title = firstNonEmpty(page?.title, ev?.page_title, route) ?? route;
    const nodeId = slugify(title) || slugify(route);

    routeToNodeId.set(route, nodeId);
    nodes[nodeId] = {
      canonicalRoute: route,
      title,
      breadcrumb: title
    };
  }

  const edgeMap = new Map<string, EdgeLike>();
  let prevRoute: string | undefined;
  for (const ev of events) {
    const curRoute = canonicalRoute(ev.page_url);
    if (!prevRoute) {
      prevRoute = curRoute;
      continue;
    }
    if (curRoute !== prevRoute) {
      const from = routeToNodeId.get(prevRoute);
      const to = routeToNodeId.get(curRoute);
      if (from && to) {
        const key = `${from}=>${to}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, {
            from,
            to,
            triggers: [inferTrigger(prevRoute, curRoute)]
          });
        }
      }
    }
    prevRoute = curRoute;
  }

  return { nodes, edges: Array.from(edgeMap.values()) };
}

function normalizeGraph(clicks: ClickGraph, settings: SettingsRoot): { nodes: Record<string, NodeLike>; edges: EdgeLike[] } {
  if (clicks.nodes && clicks.edges) {
    return { nodes: clicks.nodes, edges: clicks.edges };
  }
  return buildFallbackGraph(clicks, settings);
}

function chooseRootNodeId(nodes: Record<string, NodeLike>): string {
  const entries = Object.entries(nodes);
  const home = entries.find(([, node]) => (node.canonicalRoute ?? "").includes("home"));
  if (home) return home[0];
  return entries[0]?.[0] ?? "home";
}

function buildNavigationYaml(graph: { nodes: Record<string, NodeLike>; edges: EdgeLike[] }) {
  const { nodes, edges } = graph;
  const rootId = chooseRootNodeId(nodes);

  const adjacency = new Map<string, EdgeLike[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e);
    adjacency.set(e.from, list);
  }

  function pathTo(target: string): EdgeLike[] {
    if (target === rootId) return [];

    const queue = [rootId];
    const seen = new Set<string>([rootId]);
    const parent = new Map<string, { from: string; edge: EdgeLike }>();

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const edge of adjacency.get(cur) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        parent.set(edge.to, { from: cur, edge });
        if (edge.to === target) {
          const out: EdgeLike[] = [];
          let t = target;
          while (t !== rootId) {
            const p = parent.get(t);
            if (!p) break;
            out.unshift(p.edge);
            t = p.from;
          }
          return out;
        }
        queue.push(edge.to);
      }
    }
    return [];
  }

  const navigation = Object.entries(nodes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nodeId, node]) => {
      const canon = node.canonicalRoute ? canonicalizeUrlForIdentity(`https://dummy.local${node.canonicalRoute}`) : "/";
      const navPath = pathTo(nodeId).map((edge) => {
        const trigger = edge.triggers?.[0] ?? edge.trigger ?? {};
        return {
          click: firstNonEmpty(trigger.label, trigger.click, "unknown") ?? "unknown",
          via: firstNonEmpty(trigger.selector, trigger.via, "unknown") ?? "unknown",
          kind: firstNonEmpty(trigger.kind, "unknown") ?? "unknown",
          edgeType: firstNonEmpty(edge.edgeType, trigger.edgeType, "inferred") ?? "inferred"
        };
      });

      return {
        containerId: nodeId,
        id: canon,
        title: firstNonEmpty(node.title, node.breadcrumb, nodeId) ?? nodeId,
        breadcrumb: node.breadcrumb ?? node.title ?? null,
        navPath
      };
    });

  return { navigation };
}

function buildLayoutYaml(settings: SettingsRoot, graph: { nodes: Record<string, NodeLike> }) {
  const routeToNodeId = new Map<string, string>();
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!node.canonicalRoute) continue;
    const canon = canonicalizeUrlForIdentity(`https://dummy.local${node.canonicalRoute}`);
    routeToNodeId.set(canon, nodeId);
  }

  const layout = (settings.pages ?? [])
    .map((page) => {
      const route = canonicalRoute(page.url);
      const containerId = routeToNodeId.get(route) ?? slugify(page.title || route);
      const grouped = new Map<string, SettingDescriptor[]>();

      for (const field of page.settings ?? []) {
        const section = field.section ?? "_unsectioned";
        const arr = grouped.get(section) ?? [];
        arr.push(field);
        grouped.set(section, arr);
      }

      const sections = Array.from(grouped.entries()).map(([sectionName, fields]) => ({
        section: sectionName,
        fields: fields.map((f) => {
          const out: Record<string, unknown> = {
            fieldKey: f.key ?? f.id ?? slugify(f.label || f.selector || "field"),
            controlType: f.type ?? f.kind ?? "unknown"
          };
          if (f.label !== undefined && f.label !== null && `${f.label}`.trim() !== "") {
            out.label = f.label;
          }
          if (f.current_value !== undefined && f.current_value !== null && f.current_value !== "") {
            out.currentValue = f.current_value;
          }
          if (Array.isArray(f.options) && f.options.length > 0) {
            out.options = f.options;
          }
          const withSource = f as SettingDescriptor & { value_source?: string };
          if (withSource.value_source) {
            out.valueSource = withSource.value_source;
          }
          return out;
        })
      }));

      return {
        containerId,
        id: route,
        title: page.title ?? null,
        sections
      };
    })
    .sort((a, b) => a.containerId.localeCompare(b.containerId));

  return { layout };
}

function main(): void {
  const dir = arg("--dir") ?? "output/20260214";
  const clicksPath = arg("--clicks") ?? path.resolve(dir, "printer-ui-map.clicks.json");
  const settingsPath = arg("--settings") ?? path.resolve(dir, "settings-deterministic-manual-live.json");

  const fallbackClicks = path.resolve(dir, "settings-capture-manual-live.json");
  const effectiveClicksPath = fs.existsSync(clicksPath) ? clicksPath : fallbackClicks;

  if (!fs.existsSync(effectiveClicksPath)) {
    throw new Error(`Missing click graph JSON: ${clicksPath} (and fallback ${fallbackClicks})`);
  }
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Missing settings JSON: ${settingsPath}`);
  }

  const clicks = readJson<ClickGraph>(effectiveClicksPath);
  const settings = readJson<SettingsRoot>(settingsPath);
  const graph = normalizeGraph(clicks, settings);

  const navDoc = buildNavigationYaml(graph);
  const layoutDoc = buildLayoutYaml(settings, graph);

  const outDir = path.dirname(path.resolve(settingsPath));
  const navOut = path.resolve(outDir, "ui-tree.navigation.yaml");
  const layoutOut = path.resolve(outDir, "ui-tree.layout.yaml");

  fs.writeFileSync(navOut, yaml.dump(navDoc, { noRefs: true, lineWidth: 120, sortKeys: false }), "utf-8");
  fs.writeFileSync(layoutOut, yaml.dump(layoutDoc, { noRefs: true, lineWidth: 120, sortKeys: false }), "utf-8");

  console.log(`Wrote ${navOut}`);
  console.log(`Wrote ${layoutOut}`);
  console.log(`Clicks source: ${effectiveClicksPath}`);
}

main();
