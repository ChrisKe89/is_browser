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

type ManualFieldRegistry = {
  usedFieldIds: Set<string>;
  pageIds: Set<string>;
  pageContextIds: Map<string, string>;
  fingerprints: Set<string>;
  fieldsByFingerprint: Map<string, FieldEntry>;
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>;
};

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
  }>
): Promise<PageEntry> {
  const modal = page.locator(MODAL_ROOT_SELECTOR).first();
  const modalVisible = await modal.isVisible().catch(() => false);
  const scope = modalVisible ? modal : undefined;
  let title = (await page.title()) || undefined;
  if (modalVisible) {
    const modalTitle =
      (await modal.locator("h1,h2,h3,.xux-modalWindow-title-text").first().innerText().catch(() => "")) ||
      "dialog";
    title = modalTitle;
  }
  const breadcrumbs = await readBreadcrumbTrail(page, scope);

  const url = page.url();
  const pathname = new URL(url).pathname || "root";
  const contextKey = `${modalVisible ? "modal" : "page"}|${pathname}|${title ?? ""}|${(breadcrumbs ?? []).join(">")}`;
  const existingPageId = pageContextIds.get(contextKey);
  const pageId =
    existingPageId ??
    uniqueId(slugify(`${title ?? "page"}-${modalVisible ? "modal" : pathname}`) || "page", pageIds);
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
  discoveredFrom: "scan" | "click" | "variant"
): Promise<{ newFields: FieldEntry[]; newFieldIds: string[] }> {
  const modal = page.locator(MODAL_ROOT_SELECTOR).first();
  const scope = (await modal.isVisible().catch(() => false)) ? modal : undefined;
  const { candidates, actions } = await discoverFieldCandidates(page, scope);

  const newFields: FieldEntry[] = [];
  const newFieldIds: string[] = [];

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
      }
      continue;
    }

    registry.fingerprints.add(fingerprint);
    registry.fieldsByFingerprint.set(fingerprint, current);
    newFields.push(current);
    newFieldIds.push(current.id);
  }

  return { newFields, newFieldIds };
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

  const initialPage = await derivePageContext(page, registry.pageIds, registry.pageContextIds, navPath);
  pagesById.set(initialPage.id, initialPage);
  const initial = await collectNewFields(page, initialPage, registry, runId, "scan");
  fields.push(...initial.newFields);

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

    let click = clickQueue.poll();
    while (!click && !stopRequested) {
      await sleep(100);
      click = clickQueue.poll();
    }

    if (!click || stopRequested) {
      break;
    }

    await waitForSettledPage(page, timeoutMs);

    const navSelector = clickSelectorToNavSelector(click);
    navPath.push({
      action: "click",
      selector: navSelector,
      label: click.target,
      kind: click.kind,
      urlBefore: click.urlBefore,
      urlAfter: page.url(),
      frameUrl: click.frameUrl,
      timestamp: click.timestamp
    });

    const pageEntry = await derivePageContext(page, registry.pageIds, registry.pageContextIds, navPath);
    if (!pagesById.has(pageEntry.id)) {
      pagesById.set(pageEntry.id, pageEntry);
    }

    const { newFields, newFieldIds } = await collectNewFields(page, pageEntry, registry, runId, "click");
    fields.push(...newFields);

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

    clickLogEntries.push({
      index: clickLogEntries.length + 1,
      timestamp: click.timestamp,
      target: click.target,
      kind: click.kind,
      selectors: click.selectors,
      urlBefore: click.urlBefore,
      urlAfter: page.url(),
      frameUrl: click.frameUrl,
      frameName: click.frameName,
      inFrame: click.inFrame,
      newFieldIds,
      screenshotPath
    });

    console.log(`Captured click #${clickLogEntries.length} (${newFieldIds.length} new fields)`);
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
