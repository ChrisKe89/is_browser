import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { openBrowser, newPage } from "@is-browser/browser";
import { writeMap } from "@is-browser/contract";
import { type FieldEntry, type NavStep, type PageEntry, type Selector, type UiMap } from "@is-browser/contract";
import { NAV_TIMEOUT_MS, PRINTER_URL, requireCreds } from "@is-browser/env";
import { type MapperCliOptions } from "./cli.js";
import {
  ClickCaptureQueue,
  installClickCapture,
  type CapturedClick,
  type CapturedClickKind,
  type ClickLogEntry,
  type ClickLogFile
} from "./clickCapture.js";
import { isLoginPage, login } from "./login.js";
import { discoverFieldCandidates, mergeEnums } from "./mapping/fieldDiscovery.js";
import { fieldFingerprint } from "./mapping/fingerprint.js";
import { attachCanonicalGraph } from "./graph.js";
import { ensureManualRunPaths, resolveManualRunPaths } from "./runPaths.js";
import { slugify, uniqueId } from "./utils.js";
import { buildYamlViews, validateMapForYaml } from "./yamlViews.js";

const MODAL_ROOT_SELECTOR = "#deviceDetailsModalRoot, .ui-dialog-content, .xux-modalWindow-content, [role='dialog']";
const MODAL_OPEN_LABEL_RE = /details|advanced|settings|summary|network|administrator|edit/i;
const MODAL_CLOSE_LABEL_RE = /^(cancel|close|done|ok)$/i;
const SYSTEM_ALERT_TOKEN_RE = /securityalert|security alert|certificate|unsafe|warning/i;
const WRAPPER_BLOB_RE = /[|/]/;

type TransitionType = "navigate" | "open_modal" | "close_modal" | "tab_switch" | "dismiss_alert" | "expand_section";

type ManualFieldRegistry = {
  usedFieldIds: Set<string>;
  pageIds: Set<string>;
  pageContextIds: Map<string, string>;
  fingerprints: Set<string>;
  fieldsByFingerprint: Map<string, FieldEntry>;
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>;
};

type ScopeContext = {
  kind: "page" | "modal";
  key: string;
  root?: import("playwright").Locator;
};

function normalizeSpace(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toMillis(value: string | undefined): number {
  if (!value) return Number.NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function isOptionBlobLabel(label: string): boolean {
  if (label.length > 60) return true;
  if (WRAPPER_BLOB_RE.test(label)) return true;
  if ((label.match(/[,;]/g) ?? []).length >= 3) return true;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 10) return true;
  if (words.length >= 6) {
    const uniqueWordCount = new Set(words.map((word) => word.toLowerCase())).size;
    if (uniqueWordCount / words.length < 0.6) return true;
  }
  return false;
}

function findSelectorValue(click: CapturedClick, kind: "role" | "label" | "css"): string | undefined {
  const selector = click.selectors.find((item) => item.kind === kind);
  if (!selector) return undefined;
  if (kind === "role") return normalizeSpace(selector.role);
  return normalizeSpace(selector.value);
}

function normalizedTarget(click: CapturedClick): string {
  return normalizeSpace(click.target).toLowerCase();
}

function isSystemAlertClick(click: CapturedClick): boolean {
  if (click.kind === "system_alert") return true;
  const label = normalizedTarget(click);
  const idProbe = normalizeSpace(click.elementId).toLowerCase();
  const selectorProbe = click.selectors
    .map((selector) => normalizeSpace(selector.value ?? selector.name ?? selector.role).toLowerCase())
    .join(" ");
  if (SYSTEM_ALERT_TOKEN_RE.test(idProbe)) return true;
  if (SYSTEM_ALERT_TOKEN_RE.test(selectorProbe)) return true;
  if (label && SYSTEM_ALERT_TOKEN_RE.test(label) && /(ok|close|dismiss|continue|back)/i.test(label)) return true;
  return false;
}

function classifyClickKind(click: CapturedClick): CapturedClickKind {
  if (isSystemAlertClick(click)) return "system_alert";

  const role = findSelectorValue(click, "role")?.toLowerCase();
  const css = findSelectorValue(click, "css")?.toLowerCase() ?? "";
  const label = normalizedTarget(click);

  if (click.kind && click.kind !== "unknown") {
    if (click.kind === "button" && MODAL_CLOSE_LABEL_RE.test(label)) return "modal_close";
    return click.kind;
  }
  if (role === "tab") return "tab";
  if (role === "menuitem") return "menu";
  if (role === "link") return "link";
  if (role === "radio" || css.includes("input[type='radio']") || css.includes("input[type=\"radio\"]")) {
    return "radio_select";
  }
  if (role === "combobox") return "combobox";
  if (css.startsWith("select") || css.includes(" select")) return "dropdown_trigger";
  if (MODAL_CLOSE_LABEL_RE.test(label)) return "modal_close";
  if (MODAL_OPEN_LABEL_RE.test(label) && (role === "button" || role === "link" || css.includes("button"))) {
    return "modal_open";
  }
  if (role === "button" || css.startsWith("button")) return "button";
  return "unknown";
}

function isSemanticKind(kind: CapturedClickKind | undefined): boolean {
  return Boolean(
    kind &&
      [
        "tab",
        "menu",
        "link",
        "button",
        "radio_select",
        "dropdown_trigger",
        "combobox",
        "modal_open",
        "modal_close",
        "dismiss_alert"
      ].includes(kind)
  );
}

function sameArea(first: CapturedClick, second: CapturedClick): boolean {
  if (first.frameUrl && second.frameUrl && first.frameUrl !== second.frameUrl) return false;
  const firstCss = findSelectorValue(first, "css")?.toLowerCase() ?? "";
  const secondCss = findSelectorValue(second, "css")?.toLowerCase() ?? "";
  if (!firstCss || !secondCss) return true;
  const firstRoot = firstCss.split(">").slice(0, 2).join(">").trim();
  const secondRoot = secondCss.split(">").slice(0, 2).join(">").trim();
  return firstRoot === secondRoot;
}

function shouldCollapseWrapper(first: CapturedClick, second: CapturedClick): boolean {
  const firstKind = classifyClickKind(first);
  const secondKind = classifyClickKind(second);
  if (firstKind !== "unknown" && firstKind !== "button") return false;
  if (!["combobox", "dropdown_trigger"].includes(secondKind)) return false;
  if (!isOptionBlobLabel(normalizeSpace(first.target))) return false;
  if (!sameArea(first, second)) return false;
  const firstMs = toMillis(first.timestamp);
  const secondMs = toMillis(second.timestamp);
  if (Number.isFinite(firstMs) && Number.isFinite(secondMs) && secondMs - firstMs > 800) return false;
  return true;
}

function shouldCollapseRadioSequence(first: CapturedClick, second: CapturedClick): boolean {
  const secondKind = classifyClickKind(second);
  if (secondKind !== "radio_select") return false;
  const firstKind = classifyClickKind(first);
  if (firstKind !== "unknown" && firstKind !== "button" && firstKind !== "radio_select") return false;
  if (!sameArea(first, second)) return false;
  const firstLabel = normalizedTarget(first);
  const secondLabel = normalizedTarget(second);
  if (!firstLabel || !secondLabel) return false;
  if (!secondLabel.includes(firstLabel) && !firstLabel.includes(secondLabel)) return false;
  const firstMs = toMillis(first.timestamp);
  const secondMs = toMillis(second.timestamp);
  if (Number.isFinite(firstMs) && Number.isFinite(secondMs) && secondMs - firstMs > 1200) return false;
  return true;
}

function mergedRadioClick(first: CapturedClick, second: CapturedClick): CapturedClick {
  const mergedTarget = normalizeSpace(first.target) || second.target;
  return {
    ...second,
    target: mergedTarget,
    kind: "radio_select"
  };
}

function inferTransitionType(
  kind: CapturedClickKind,
  beforeScope: ScopeContext,
  afterScope: ScopeContext,
  click: CapturedClick,
  urlAfter: string
): TransitionType {
  if (kind === "system_alert" || kind === "dismiss_alert") return "dismiss_alert";
  if (beforeScope.kind !== "modal" && afterScope.kind === "modal") return "open_modal";
  if (beforeScope.kind === "modal" && afterScope.kind !== "modal") return "close_modal";
  if (kind === "modal_open") return "open_modal";
  if (kind === "modal_close") return "close_modal";
  if (kind === "tab") return "tab_switch";

  const urlBefore = normalizeSpace(click.urlBefore);
  const normalizedAfter = normalizeSpace(urlAfter);
  if (urlBefore && normalizedAfter && urlBefore !== normalizedAfter) return "navigate";
  if (kind === "link") return "navigate";
  return "expand_section";
}

function shouldRevealFromTransition(transitionType: TransitionType, kind: CapturedClickKind): boolean {
  if (kind === "system_alert") return false;
  if (transitionType === "close_modal") return false;
  if (transitionType === "dismiss_alert") return false;
  return ["open_modal", "navigate", "tab_switch", "expand_section"].includes(transitionType);
}

function mergeOptions(
  existing: FieldEntry["options"] = [],
  incoming: FieldEntry["options"] = []
): FieldEntry["options"] {
  const merged = new Map<string, { value: string; label?: string }>();
  for (const option of [...existing, ...incoming]) {
    const value = option.value.trim();
    if (!value) continue;
    const prior = merged.get(value);
    if (!prior) {
      merged.set(value, { value, label: option.label });
      continue;
    }
    if (!prior.label && option.label) {
      prior.label = option.label;
    }
  }
  return Array.from(merged.values()).sort((a, b) => a.value.localeCompare(b.value));
}

function mergeFieldIntoExisting(existing: FieldEntry, incoming: FieldEntry): void {
  if (incoming.constraints) {
    existing.constraints = {
      ...(existing.constraints ?? {}),
      ...incoming.constraints
    };
  }
  const existingEnum = existing.constraints?.enum ?? [];
  const incomingEnum = incoming.constraints?.enum ?? [];
  const mergedEnum = mergeEnums(existingEnum, incomingEnum);
  if (mergedEnum.length > 0) {
    existing.constraints = { ...(existing.constraints ?? {}), enum: mergedEnum };
  }

  if (!existing.actions && incoming.actions) {
    existing.actions = incoming.actions;
  }

  if (incoming.options?.length) {
    existing.options = mergeOptions(existing.options, incoming.options);
  }
  if (incoming.currentValue !== undefined) {
    existing.currentValue = incoming.currentValue;
  }
  if (incoming.labelQuality && (existing.labelQuality === undefined || existing.labelQuality === "missing")) {
    existing.labelQuality = incoming.labelQuality;
  }
  if (incoming.rangeHint && !existing.rangeHint) {
    existing.rangeHint = incoming.rangeHint;
  }
  if (incoming.hints?.length) {
    const mergedHints = new Set([...(existing.hints ?? []), ...incoming.hints]);
    existing.hints = Array.from(mergedHints.values());
  }
  if (incoming.valueType && !existing.valueType) {
    existing.valueType = incoming.valueType;
  }
  if (incoming.controlType && !existing.controlType) {
    existing.controlType = incoming.controlType;
  }
  if (incoming.groupTitle && !existing.groupTitle) {
    existing.groupTitle = incoming.groupTitle;
  }
  if (incoming.groupOrder && !existing.groupOrder) {
    existing.groupOrder = incoming.groupOrder;
  }
  if (incoming.visibility && !existing.visibility) {
    existing.visibility = incoming.visibility;
  }
  if (incoming.readonly !== undefined && existing.readonly === undefined) {
    existing.readonly = incoming.readonly;
  }
}

async function readBreadcrumbTrail(
  page: import("playwright").Page,
  scope?: import("playwright").Locator
): Promise<string[] | undefined> {
  const root = scope ?? page.locator("body");
  const crumbItems = root.locator(
    "nav[aria-label*='breadcrumb' i] li, nav[aria-label*='breadcrumb' i] a, [role='navigation'][aria-label*='breadcrumb' i] li, .breadcrumb li, .breadcrumbs li"
  );
  const count = await crumbItems.count();
  const labels: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const text = (await crumbItems.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(text);
  }
  if (labels.length > 0) {
    return labels;
  }

  const container = root.locator(
    "nav[aria-label*='breadcrumb' i], [role='navigation'][aria-label*='breadcrumb' i], .breadcrumb, .breadcrumbs"
  ).first();
  if (!(await container.count())) {
    return undefined;
  }
  const text = (await container.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const split = text
    .split(/(?:\s[>»/]\s|[>»/])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 80);
  return split.length > 0 ? split : undefined;
}

async function findVisibleModalRoot(
  page: import("playwright").Page
): Promise<import("playwright").Locator | undefined> {
  const roots = page.locator(MODAL_ROOT_SELECTOR);
  const count = await roots.count();
  for (let i = 0; i < count; i += 1) {
    const root = roots.nth(i);
    if (await root.isVisible().catch(() => false)) {
      return root;
    }
  }
  return undefined;
}

async function resolveScopeContext(page: import("playwright").Page): Promise<ScopeContext> {
  const modalRoot = await findVisibleModalRoot(page);
  if (!modalRoot) {
    return { kind: "page", key: "page:main" };
  }

  const modalTitle = normalizeSpace(
    await modalRoot.locator("h1,h2,h3,.xux-modalWindow-title-text").first().innerText().catch(() => "")
  );
  const modalId = normalizeSpace((await modalRoot.getAttribute("id").catch(() => null)) ?? undefined);
  const modalClass = normalizeSpace((await modalRoot.getAttribute("class").catch(() => null)) ?? undefined)
    .split(/\s+/)
    .slice(0, 3)
    .join(".");
  const key = `modal:${modalId || modalClass || modalTitle || "active"}`;
  return { kind: "modal", key, root: modalRoot };
}

async function derivePageContext(
  page: import("playwright").Page,
  pageIds: Set<string>,
  pageContextIds: Map<string, string>,
  navPath: Array<{
    action: "goto" | "click";
    selector?: Selector;
    url?: string;
    label?: string;
    kind?: NavStep["kind"];
    urlBefore?: string;
    urlAfter?: string;
    frameUrl?: string;
    timestamp?: string;
  }>,
  scopeContext?: ScopeContext
): Promise<PageEntry> {
  const activeScope = scopeContext ?? (await resolveScopeContext(page));
  const scope = activeScope.root;
  let title = (await page.title()) || undefined;
  if (activeScope.kind === "modal" && scope) {
    const modalTitle =
      (await scope.locator("h1,h2,h3,.xux-modalWindow-title-text").first().innerText().catch(() => "")) ||
      "dialog";
    title = modalTitle;
  }
  const breadcrumbs = await readBreadcrumbTrail(page, scope);

  const url = page.url();
  const pathname = new URL(url).pathname || "root";
  const contextKey = `${activeScope.kind}|${activeScope.key}|${pathname}|${title ?? ""}|${(breadcrumbs ?? []).join(">")}`;
  const existingPageId = pageContextIds.get(contextKey);
  const pageId =
    existingPageId ??
    uniqueId(slugify(`${title ?? "page"}-${activeScope.kind === "modal" ? "modal" : pathname}`) || "page", pageIds);
  if (!existingPageId) {
    pageContextIds.set(contextKey, pageId);
  }

  return {
    id: pageId,
    title,
    url,
    breadcrumbs,
    navPath
  };
}

async function collectNewFields(
  page: import("playwright").Page,
  pageEntry: PageEntry,
  registry: ManualFieldRegistry,
  runId: string,
  discoveredFrom: "scan" | "click" | "variant",
  scopeContext?: ScopeContext
): Promise<{
  newFields: FieldEntry[];
  newFieldIds: string[];
  visibleFieldIds: string[];
  scopeKey: string;
  actions?: FieldEntry["actions"];
}> {
  const scope = scopeContext?.root;
  const { candidates, actions } = await discoverFieldCandidates(page, scope);

  const newFields: FieldEntry[] = [];
  const newFieldIds: string[] = [];
  const visibleFieldIds: string[] = [];

  for (const candidate of candidates) {
    const fingerprint = candidate.selectorKey ?? fieldFingerprint(candidate.type, candidate.selectors, candidate.label);
    const defaultValue =
      registry.defaultsBySelectorKey.get(fingerprint) ??
      candidate.currentValue ??
      null;
    if (!registry.defaultsBySelectorKey.has(fingerprint)) {
      registry.defaultsBySelectorKey.set(fingerprint, defaultValue);
    }
    const current: FieldEntry = {
      id: uniqueId(
        `${pageEntry.id}.${slugify(candidate.label ?? candidate.type ?? "field")}`,
        registry.usedFieldIds
      ),
      label: candidate.label,
      labelQuality: candidate.labelQuality,
      type: candidate.type,
      selectors: candidate.selectors,
      pageId: pageEntry.id,
      selectorKey: fingerprint,
      groupKey: candidate.groupKey,
      groupTitle: candidate.groupTitle,
      groupOrder: candidate.groupOrder,
      constraints: candidate.constraints,
      options: candidate.options,
      hints: candidate.hints,
      rangeHint: candidate.rangeHint,
      valueType: candidate.valueType,
      defaultValue,
      currentValue: candidate.currentValue,
      controlType: candidate.controlType,
      readonly: candidate.readonly,
      visibility: candidate.visibility,
      source: { discoveredFrom, runId },
      actions
    };

    if (registry.fingerprints.has(fingerprint)) {
      const existing = registry.fieldsByFingerprint.get(fingerprint);
      if (existing) {
        mergeFieldIntoExisting(existing, current);
        visibleFieldIds.push(existing.id);
      }
      continue;
    }

    registry.fingerprints.add(fingerprint);
    registry.fieldsByFingerprint.set(fingerprint, current);
    newFields.push(current);
    newFieldIds.push(current.id);
    visibleFieldIds.push(current.id);
  }

  return {
    newFields,
    newFieldIds,
    visibleFieldIds,
    scopeKey: scopeContext?.key ?? "page:main",
    actions
  };
}

function diffFieldSets(before: Set<string>, after: Set<string>): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const id of after) {
    if (!before.has(id)) added.push(id);
  }
  for (const id of before) {
    if (!after.has(id)) removed.push(id);
  }
  return { added, removed };
}

async function waitForSettledPage(page: import("playwright").Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => null);
  await page.waitForTimeout(Math.min(timeoutMs, 250));
}

function clickSelectorToNavSelector(click: CapturedClick): Selector | undefined {
  const role = click.selectors.find((selector) => selector.kind === "role");
  if (role) {
    return { kind: "role", role: role.role, name: role.name };
  }
  const label = click.selectors.find((selector) => selector.kind === "label");
  if (label) {
    return { kind: "label", value: label.value };
  }
  const css = click.selectors.find((selector) => selector.kind === "css");
  if (css) {
    return { kind: "css", value: css.value };
  }
  return undefined;
}

async function writeClickLog(pathname: string, log: ClickLogFile): Promise<void> {
  await writeFile(pathname, `${JSON.stringify(log, null, 2)}\n`, "utf8");
}

function shouldStopByInput(line: string): boolean {
  return line.trim().toLowerCase() === "q";
}

async function waitForClick(clickQueue: ClickCaptureQueue, isStopRequested: () => boolean): Promise<CapturedClick | undefined> {
  let click = clickQueue.poll();
  while (!click && !isStopRequested()) {
    await sleep(100);
    click = clickQueue.poll();
  }
  return click;
}

async function normalizeClickSequence(clickQueue: ClickCaptureQueue, first: CapturedClick): Promise<CapturedClick | undefined> {
  await sleep(120);
  const next = clickQueue.poll();
  if (!next) {
    return { ...first, kind: classifyClickKind(first) };
  }

  if (shouldCollapseWrapper(first, next)) {
    return { ...next, kind: classifyClickKind(next) };
  }

  if (shouldCollapseRadioSequence(first, next)) {
    return mergedRadioClick(first, next);
  }

  clickQueue.unshift(next);
  return { ...first, kind: classifyClickKind(first) };
}

export async function runManualMapper(options: MapperCliOptions): Promise<void> {
  requireCreds();
  if (!options.location && process.env.npm_command === "run") {
    console.warn(
      "Location not set. npm may swallow --location; use IS_MAPPER_LOCATION=permissions or run make is-mapper-manual LOCATION=permissions."
    );
  }
  const url = options.url || PRINTER_URL;
  const timeoutMs = options.timeoutMs || NAV_TIMEOUT_MS;
  const resolvedRunPaths = resolveManualRunPaths({ location: options.location });
  const runPaths = await ensureManualRunPaths(resolvedRunPaths, options.screenshot);
  const runId = path.basename(runPaths.rootDir);

  const browser = await openBrowser({ headless: false });
  const page = await newPage(browser);
  const clickQueue = new ClickCaptureQueue();
  await installClickCapture(page, (payload) => clickQueue.push(payload));

  await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  if (await isLoginPage(page)) {
    await login(page);
    await waitForSettledPage(page, timeoutMs);
  }

  const pagesById = new Map<string, PageEntry>();
  const fields: FieldEntry[] = [];
  const registry: ManualFieldRegistry = {
    usedFieldIds: new Set<string>(),
    pageIds: new Set<string>(),
    pageContextIds: new Map<string, string>(),
    fingerprints: new Set<string>(),
    fieldsByFingerprint: new Map<string, FieldEntry>(),
    defaultsBySelectorKey: new Map<string, FieldEntry["defaultValue"]>()
  };

  const navPath: Array<{
    action: "goto" | "click";
    selector?: Selector;
    url?: string;
    label?: string;
    kind?: NavStep["kind"];
    urlBefore?: string;
    urlAfter?: string;
    frameUrl?: string;
    timestamp?: string;
  }> = [
    { action: "goto", url: page.url() }
  ];
  const snapshotsByPageId = new Map<string, string>();

  const visibleBaselineByScope = new Map<string, Set<string>>();
  const initialScope = await resolveScopeContext(page);
  const initialPage = await derivePageContext(page, registry.pageIds, registry.pageContextIds, navPath, initialScope);
  pagesById.set(initialPage.id, initialPage);
  const initial = await collectNewFields(page, initialPage, registry, runId, "scan", initialScope);
  fields.push(...initial.newFields);
  if (initial.actions?.length) {
    initialPage.actions = initial.actions;
    pagesById.set(initialPage.id, initialPage);
  }
  visibleBaselineByScope.set(initial.scopeKey, new Set(initial.visibleFieldIds));
  let lastScope = initialScope;
  let lastPageId = initialPage.id;
  let lastVisibleFieldIds = new Set(initial.visibleFieldIds);

  const clickLogEntries: ClickLogEntry[] = [];

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let stopRequested = false;
  const requestStop = (reason: string): void => {
    if (!stopRequested) {
      stopRequested = true;
      console.log(`Stopping manual mapper (${reason})...`);
    }
  };

  rl.on("line", (line) => {
    if (shouldStopByInput(line)) {
      requestStop("terminal input");
    }
  });

  const onSigInt = () => requestStop("SIGINT");
  process.on("SIGINT", onSigInt);

  // Fallback for shells where readline "line" events are inconsistent under npm/make.
  process.stdin.setEncoding("utf8");
  const onStdinData = (chunk: string) => {
    const lines = chunk.split(/\r?\n/).map((line) => line.trim().toLowerCase());
    if (lines.includes("q")) {
      requestStop("stdin fallback");
    }
  };
  process.stdin.on("data", onStdinData);
  process.stdin.resume();

  console.log("Manual mapper is running. Click through the UI. Enter 'q' then Enter to finish.");

  while (!stopRequested) {
    if (typeof options.maxClicks === "number" && clickLogEntries.length >= options.maxClicks) {
      console.log(`Reached max clicks (${options.maxClicks}). Stopping.`);
      break;
    }

    const rawClick = await waitForClick(clickQueue, () => stopRequested);
    if (!rawClick || stopRequested) {
      break;
    }
    const click = await normalizeClickSequence(clickQueue, rawClick);

    if (!click || stopRequested) {
      break;
    }

    await waitForSettledPage(page, timeoutMs);
    const clickKind = classifyClickKind(click);
    const normalizedClick: CapturedClick = { ...click, kind: clickKind };
    const afterScope = await resolveScopeContext(page);
    const currentUrl = page.url();
    const transitionType = inferTransitionType(
      clickKind,
      lastScope,
      afterScope,
      normalizedClick,
      currentUrl
    );

    if (clickKind !== "system_alert") {
      const navSelector = clickSelectorToNavSelector(normalizedClick);
      navPath.push({
        action: "click",
        selector: navSelector,
        label: normalizedClick.target,
        kind: normalizedClick.kind,
        urlBefore: normalizedClick.urlBefore,
        urlAfter: currentUrl,
        frameUrl: normalizedClick.frameUrl,
        timestamp: normalizedClick.timestamp
      });
    }

    const pageEntry = await derivePageContext(page, registry.pageIds, registry.pageContextIds, navPath, afterScope);
    const pageEntryExisting = pagesById.get(pageEntry.id);
    if (!pageEntryExisting) {
      pagesById.set(pageEntry.id, pageEntry);
    }

    const { newFields, newFieldIds: newlyDiscoveredFieldIds, visibleFieldIds, scopeKey, actions } =
      await collectNewFields(page, pageEntry, registry, runId, "click", afterScope);
    fields.push(...newFields);
    const visibleAfter = new Set(visibleFieldIds);
    if (actions?.length) {
      if (pageEntryExisting) {
        if (!pageEntryExisting.actions || pageEntryExisting.actions.length === 0) {
          pageEntryExisting.actions = actions;
        }
      } else {
        pageEntry.actions = actions;
        pagesById.set(pageEntry.id, pageEntry);
      }
    }

    const baselineForAfterScope = visibleBaselineByScope.get(scopeKey) ?? new Set<string>();
    const sameScope = lastScope.key === scopeKey;
    const visibilityDiff = sameScope ? diffFieldSets(lastVisibleFieldIds, visibleAfter) : diffFieldSets(baselineForAfterScope, visibleAfter);
    const newlyVisibleFieldIds = visibilityDiff.added;
    const noLongerVisibleFieldIds = sameScope ? visibilityDiff.removed : [];
    const revealEnabled = shouldRevealFromTransition(transitionType, clickKind);
    const newFieldIds =
      clickKind === "system_alert"
        ? []
        : revealEnabled
          ? newlyVisibleFieldIds
          : [];

    let screenshotPath: string | undefined;
    if (options.screenshot) {
      screenshotPath = path.join(
        runPaths.screenshotsDir,
        `click-${String(clickLogEntries.length + 1).padStart(4, "0")}.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
      if (!snapshotsByPageId.has(pageEntry.id)) {
        snapshotsByPageId.set(pageEntry.id, screenshotPath);
      }
    }

    if (visibleBaselineByScope.has(scopeKey)) {
      const merged = new Set<string>([...visibleBaselineByScope.get(scopeKey)!, ...visibleAfter]);
      visibleBaselineByScope.set(scopeKey, merged);
    } else {
      visibleBaselineByScope.set(scopeKey, new Set(visibleAfter));
    }

    clickLogEntries.push({
      index: clickLogEntries.length + 1,
      timestamp: normalizedClick.timestamp,
      target: normalizedClick.target,
      kind: clickKind,
      selectors: normalizedClick.selectors,
      urlBefore: normalizedClick.urlBefore,
      urlAfter: currentUrl,
      frameUrl: normalizedClick.frameUrl,
      frameName: normalizedClick.frameName,
      inFrame: normalizedClick.inFrame,
      elementId: normalizedClick.elementId,
      transitionType,
      nodeIdBefore: lastPageId,
      nodeIdAfter: pageEntry.id,
      newFieldIds,
      newlyVisibleFieldIds,
      newlyDiscoveredFieldIds: clickKind === "system_alert" ? [] : newlyDiscoveredFieldIds,
      noLongerVisibleFieldIds,
      screenshotPath
    });

    lastScope = afterScope;
    lastPageId = pageEntry.id;
    lastVisibleFieldIds = visibleAfter;

    console.log(
      `Captured click #${clickLogEntries.length} (${newFieldIds.length} newly visible, ${newlyDiscoveredFieldIds.length} newly discovered)`
    );
  }

  process.stdin.off("data", onStdinData);
  process.off("SIGINT", onSigInt);
  rl.close();

  const map: UiMap = {
    meta: {
      generatedAt: new Date().toISOString(),
      printerUrl: url,
      schemaVersion: "1.1"
    },
    pages: Array.from(pagesById.values()),
    fields
  };

  const clickLog: ClickLogFile = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl: url,
      runPath: runPaths.rootDir,
      clickCount: clickLogEntries.length
    },
    clicks: clickLogEntries
  };

  attachCanonicalGraph(map, {
    runId,
    capturedAt: new Date().toISOString(),
    mapperVersion: process.env.npm_package_version,
    clickLog,
    snapshotsByPageId
  });

  await writeMap(runPaths.mapPath, map);
  await writeClickLog(runPaths.clickLogPath, clickLog);
  validateMapForYaml(map, (warning) => console.warn(`[yaml-validation] ${warning}`));
  const { navigationYaml, layoutYaml } = buildYamlViews(map);
  await writeFile(runPaths.navigationYamlPath, navigationYaml, "utf8");
  await writeFile(runPaths.layoutYamlPath, layoutYaml, "utf8");
  await browser.close();

  console.log(`Manual map written to ${runPaths.mapPath}`);
  console.log(`Click log written to ${runPaths.clickLogPath}`);
  console.log(`Navigation YAML written to ${runPaths.navigationYamlPath}`);
  console.log(`Layout YAML written to ${runPaths.layoutYamlPath}`);
}
