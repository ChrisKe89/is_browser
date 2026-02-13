import { openBrowser, newPage } from "@is-browser/browser";
import {
  CRAWL_INCLUDE_HASH,
  CRAWL_MAX_PAGES,
  CRAWL_EXPAND_CHOICES,
  CRAWL_FLOWS_PATH,
  CRAWL_MENU_TRAVERSE,
  CRAWL_SEED_PATHS,
  PRINTER_URL,
  NAV_TIMEOUT_MS,
  requireCreds,
} from "@is-browser/env";
import { writeMap } from "@is-browser/contract";
import {
  type NavStep,
  type FieldEntry,
  type PageEntry,
  type Selector,
  type UiMap,
} from "@is-browser/contract";
import { slugify, uniqueId } from "./utils.js";
import { isLoginPage, login } from "./login.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { discoverFieldCandidates } from "./mapping/fieldDiscovery.js";
import { parseMapperCliArgs, type MapperCliOptions } from "./cli.js";
import { runManualMapper } from "./manual.js";
import { fieldFingerprint } from "./mapping/fingerprint.js";
import { attachCanonicalGraph } from "./graph.js";
import { buildYamlViews, validateMapForYaml } from "./yamlViews.js";
import { writeCaptureArtifacts } from "./writeCaptureArtifacts.js";

const OUTPUT_PATH = process.env.MAP_PATH ?? "state/printer-ui-map.json";
const TAB_SKIP_RE = /logout|log out|delete|reset|save|apply|submit|cancel|ok/i;
const MODAL_TRIGGER_RE =
  /details|device details|system administrator|device location|network summary/i;
const MODAL_TRIGGER_LABELS = [
  "Details",
  "Device Details",
  "System Administrator",
  "Device Location",
  "Network Summary",
];
const MENU_SKIP_RE = /logout|log out|delete|reset|save|apply|submit/i;
const FLOW_STEP_SKIP_RE =
  /log in|login|logout|log out|save|apply|restart|delete|reset/i;
const MODAL_CLOSE_RE = /cancel|close|done|ok/i;
const MAX_MODAL_DEPTH = 2;

type QueueItem = {
  url: string;
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
  }>;
};

type SnapshotRecorder = (
  page: import("playwright").Page,
  pageId: string,
) => Promise<void>;

type CrawlFlow = {
  id: string;
  title?: string;
  startUrl: string;
  steps: Array<{
    action: "click";
    role: "button" | "link" | "menuitem";
    name: string;
  }>;
  modalTriggers?: string[];
};

type CrawlFlowsConfig = {
  flows: CrawlFlow[];
};

function normalizeLabel(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function mergeOptions(
  existing: FieldEntry["options"] = [],
  incoming: FieldEntry["options"] = [],
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
  return Array.from(merged.values()).sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}

function mergeFieldMetadata(
  existing: FieldEntry,
  incoming: Omit<FieldEntry, "id" | "pageId">,
): void {
  if (incoming.constraints) {
    existing.constraints = {
      ...(existing.constraints ?? {}),
      ...incoming.constraints,
    };
  }
  const existingEnum = existing.constraints?.enum ?? [];
  const incomingEnum = incoming.constraints?.enum ?? [];
  const mergedEnum = Array.from(
    new Set([...existingEnum, ...incomingEnum]),
  ).sort((a, b) => a.localeCompare(b));

  if (mergedEnum.length > 0) {
    existing.constraints = {
      ...(existing.constraints ?? {}),
      enum: mergedEnum,
    };
  }
  if (incoming.options?.length) {
    existing.options = mergeOptions(existing.options, incoming.options);
  }
  if (incoming.currentValue !== undefined) {
    existing.currentValue = incoming.currentValue;
  }
  if (incoming.currentLabel && !existing.currentLabel) {
    existing.currentLabel = incoming.currentLabel;
  }
  if (incoming.valueQuality) {
    existing.valueQuality = incoming.valueQuality;
  }
  if (incoming.valueQualityReason) {
    existing.valueQualityReason = incoming.valueQualityReason;
  }
  if (
    incoming.labelQuality &&
    (existing.labelQuality === undefined || existing.labelQuality === "missing")
  ) {
    existing.labelQuality = incoming.labelQuality;
  }
  if (incoming.fieldId && !existing.fieldId) {
    existing.fieldId = incoming.fieldId;
  }
  if (incoming.rangeHint && !existing.rangeHint) {
    existing.rangeHint = incoming.rangeHint;
  }
  if (incoming.hints?.length) {
    const mergedHints = new Set([...(existing.hints ?? []), ...incoming.hints]);
    existing.hints = Array.from(mergedHints.values());
  }
  if (incoming.valueType) {
    existing.valueType = incoming.valueType;
  }
  if (incoming.controlType) {
    existing.controlType = incoming.controlType;
  }
  if (incoming.visibility) {
    existing.visibility = incoming.visibility;
  }
  if (incoming.readonly !== undefined) {
    existing.readonly = incoming.readonly;
  }
  if (incoming.groupTitle && !existing.groupTitle) {
    existing.groupTitle = incoming.groupTitle;
  }
  if (incoming.groupOrder && !existing.groupOrder) {
    existing.groupOrder = incoming.groupOrder;
  }
  if (incoming.actions && !existing.actions) {
    existing.actions = incoming.actions;
  }
  if (incoming.opensModal !== undefined) {
    existing.opensModal = incoming.opensModal;
  }
  if (incoming.modalRef) {
    existing.modalRef = incoming.modalRef;
  }
  if (incoming.modalTitle) {
    existing.modalTitle = incoming.modalTitle;
  }
  if (incoming.interaction) {
    existing.interaction = incoming.interaction;
  }
}

async function readBreadcrumbTrail(
  page: import("playwright").Page,
  scope?: import("playwright").Locator,
): Promise<string[] | undefined> {
  const root = scope ?? page.locator("body");
  const crumbItems = root.locator(
    "nav[aria-label*='breadcrumb' i] li, nav[aria-label*='breadcrumb' i] a, [role='navigation'][aria-label*='breadcrumb' i] li, .breadcrumb li, .breadcrumbs li",
  );
  const count = await crumbItems.count();
  const labels: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const text = (
      await crumbItems
        .nth(i)
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.length > 80) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(text);
  }
  if (labels.length > 0) {
    return labels;
  }

  const container = root
    .locator(
      "nav[aria-label*='breadcrumb' i], [role='navigation'][aria-label*='breadcrumb' i], .breadcrumb, .breadcrumbs",
    )
    .first();
  if (!(await container.count())) {
    return undefined;
  }
  const text = (await container.innerText().catch(() => ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  const split = text
    .split(/(?:\s[>»/]\s|[>»/])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 80);
  return split.length > 0 ? split : undefined;
}

async function discoverLinks(page: import("playwright").Page, pageUrl: string) {
  const selector =
    "a[href], area[href], iframe[src], frame[src], [role='link'][href], [data-href], [data-url], [data-link], [data-path], [data-target], [onclick]";
  const links = page.locator(selector);
  const count = await links.count();
  const results: { href: string; text?: string }[] = [];
  const seen = new Set<string>();
  const baseOrigin = new URL(pageUrl).origin;

  for (let i = 0; i < count; i += 1) {
    const link = links.nth(i);
    let href =
      (await link.getAttribute("href")) ||
      (await link.getAttribute("src")) ||
      (await link.getAttribute("data-href")) ||
      (await link.getAttribute("data-url")) ||
      (await link.getAttribute("data-link")) ||
      (await link.getAttribute("data-path")) ||
      (await link.getAttribute("data-target"));
    if (!href) {
      const onclick = await link.getAttribute("onclick");
      if (onclick) {
        const match =
          onclick.match(
            /(?:location\.href|window\.location(?:\.href)?|location)\s*=\s*["']([^"']+)["']/i,
          ) ||
          onclick.match(/["']([^"']+\.html[^"']*)["']/i) ||
          onclick.match(/["'](#[^"']+)["']/i);
        if (match?.[1]) {
          href = match[1];
        }
      }
    }
    if (!href) continue;
    const trimmed = href.trim();
    if (!trimmed || trimmed === "#") continue;
    if (trimmed.startsWith("mailto:") || trimmed.startsWith("javascript:"))
      continue;
    const resolved = new URL(trimmed, pageUrl).toString();
    if (new URL(resolved).origin !== baseOrigin) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const text = (await link.innerText()).trim();
    results.push({ href: resolved, text: text || undefined });
  }

  return results;
}

async function mapPage(
  page: import("playwright").Page,
  pageId: string,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  _expandChoices: boolean,
  discoveredFrom: "scan" | "variant" | "click",
  runId: string,
  scope?: import("playwright").Locator,
): Promise<{ fields: FieldEntry[]; actions: FieldEntry["actions"] }> {
  const { candidates, actions } = await discoverFieldCandidates(page, scope);
  const fieldEntries: FieldEntry[] = [];

  for (const candidate of candidates) {
    const key =
      candidate.selectorKey ??
      fieldFingerprint(candidate.type, candidate.selectors, candidate.label);
    const defaultValue =
      defaultsBySelectorKey.get(key) ?? candidate.currentValue ?? null;
    if (!defaultsBySelectorKey.has(key)) {
      defaultsBySelectorKey.set(key, defaultValue);
    }

    const existing = fieldsBySelectorKey.get(key);
    if (knownFieldKeys.has(key)) {
      if (existing) {
        mergeFieldMetadata(existing, {
          label: candidate.label,
          fieldId: candidate.fieldId,
          labelQuality: candidate.labelQuality,
          type: candidate.type,
          selectors: candidate.selectors,
          selectorKey: key,
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
          currentLabel: candidate.currentLabel,
          valueQuality: candidate.valueQuality,
          valueQualityReason: candidate.valueQualityReason,
          controlType: candidate.controlType,
          readonly: candidate.readonly,
          visibility: candidate.visibility,
          source: existing.source ?? { discoveredFrom, runId },
          opensModal: candidate.opensModal,
          interaction: candidate.interaction,
        });
      }
      continue;
    }
    knownFieldKeys.add(key);
    const fieldId = uniqueId(
      `${pageId}.${slugify(candidate.label ?? "field")}`,
      usedFieldIds,
    );
    const entry: FieldEntry = {
      id: fieldId,
      label: candidate.label,
      fieldId: candidate.fieldId,
      labelQuality: candidate.labelQuality,
      type: candidate.type,
      selectors: candidate.selectors,
      pageId,
      selectorKey: key,
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
      currentLabel: candidate.currentLabel,
      valueQuality: candidate.valueQuality,
      valueQualityReason: candidate.valueQualityReason,
      controlType: candidate.controlType,
      readonly: candidate.readonly,
      visibility: candidate.visibility,
      source: { discoveredFrom, runId },
      opensModal: candidate.opensModal,
      interaction: candidate.interaction,
    };
    fieldsBySelectorKey.set(key, entry);
    fieldEntries.push(entry);
  }

  return { fields: fieldEntries, actions };
}

async function expandWithChoiceVariants(
  page: import("playwright").Page,
  pageId: string,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  timeoutMs: number,
  runId: string,
  scope?: import("playwright").Locator,
): Promise<FieldEntry[]> {
  const visibleKeys = async (): Promise<Set<string>> => {
    const { candidates } = await discoverFieldCandidates(
      page,
      scope ?? page.locator("body"),
    );
    return new Set(
      candidates.map(
        (candidate) =>
          candidate.selectorKey ??
          fieldFingerprint(
            candidate.type,
            candidate.selectors,
            candidate.label,
          ),
      ),
    );
  };

  const attachDependency = (
    controllerKey: string,
    whenValue: string,
    beforeKeys: Set<string>,
    afterKeys: Set<string>,
  ): void => {
    const controller = fieldsBySelectorKey.get(controllerKey);
    if (!controller) return;

    const reveals = Array.from(afterKeys)
      .filter((key) => !beforeKeys.has(key) && key !== controllerKey)
      .map(
        (key) =>
          fieldsBySelectorKey.get(key)?.fieldId ??
          fieldsBySelectorKey.get(key)?.id,
      )
      .filter((id): id is string => Boolean(id));
    const hides = Array.from(beforeKeys)
      .filter((key) => !afterKeys.has(key) && key !== controllerKey)
      .map(
        (key) =>
          fieldsBySelectorKey.get(key)?.fieldId ??
          fieldsBySelectorKey.get(key)?.id,
      )
      .filter((id): id is string => Boolean(id));

    if (reveals.length === 0 && hides.length === 0) return;

    const dependency = {
      when: whenValue,
      reveals: reveals.length ? reveals : undefined,
      hides: hides.length ? hides : undefined,
    };
    const existing = controller.dependencies ?? [];
    const duplicate = existing.some(
      (entry) =>
        entry.when === dependency.when &&
        JSON.stringify(entry.reveals ?? []) ===
          JSON.stringify(dependency.reveals ?? []) &&
        JSON.stringify(entry.hides ?? []) ===
          JSON.stringify(dependency.hides ?? []),
    );
    if (!duplicate) {
      controller.dependencies = [...existing, dependency];
    }
  };

  const extraFields: FieldEntry[] = [];

  const root = scope ?? page.locator("body");
  const selects = root.locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i);
    const { candidates: selectCandidates } = await discoverFieldCandidates(
      page,
      root,
    );
    const matchingSelect = selectCandidates.find(
      (candidate) =>
        candidate.type === "select" &&
        candidate.selectors.some(
          (selector) =>
            selector.kind === "css" && selector.value?.startsWith("#"),
        ),
    );
    const controllerKey =
      matchingSelect?.selectorKey ??
      fieldFingerprint(
        "select",
        [{ kind: "css", value: `select:nth-of-type(${i + 1})` }],
        matchingSelect?.label,
      );
    const originalValue = await select.inputValue().catch(() => "");
    const options = select.locator("option");
    const optionCount = await options.count();
    for (let j = 0; j < optionCount; j += 1) {
      const option = options.nth(j);
      const value =
        (await option.getAttribute("value")) ?? (await option.innerText());
      if (!value) continue;
      const before = await visibleKeys();
      await select.selectOption(value).catch(() => null);
      await page
        .waitForLoadState("networkidle", { timeout: timeoutMs })
        .catch(() => null);
      await page.waitForTimeout(150);
      const { fields } = await mapPage(
        page,
        pageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        false,
        "variant",
        runId,
        root,
      );
      extraFields.push(...fields);
      const after = await visibleKeys();
      attachDependency(controllerKey, value, before, after);
    }
    if (originalValue) {
      await select.selectOption(originalValue).catch(() => null);
      await page.waitForTimeout(100);
    }
  }

  const radios = root.locator("input[type='radio']");
  const radioCount = await radios.count();
  const groups = new Map<
    string,
    { radios: ReturnType<typeof radios.nth>[]; originalValue: string | null }
  >();
  for (let i = 0; i < radioCount; i += 1) {
    const radio = radios.nth(i);
    if (!(await radio.isVisible().catch(() => false))) continue;
    const name = (await radio.getAttribute("name")) ?? `__radio_group_${i}`;
    const value = (await radio.getAttribute("value")) ?? `option-${i + 1}`;
    const checked = await radio.isChecked().catch(() => false);
    const existing = groups.get(name);
    if (!existing) {
      groups.set(name, {
        radios: [radio],
        originalValue: checked ? value : null,
      });
      continue;
    }
    existing.radios.push(radio);
    if (checked) {
      existing.originalValue = value;
    }
  }

  for (const [groupName, group] of groups) {
    const controllerKey = fieldFingerprint(
      "radio",
      [{ kind: "css", value: `input[type='radio'][name="${groupName}"]` }],
      groupName,
    );
    for (const radio of group.radios) {
      const before = await visibleKeys();
      await radio.check().catch(() => null);
      await page
        .waitForLoadState("networkidle", { timeout: timeoutMs })
        .catch(() => null);
      await page.waitForTimeout(150);
      const { fields } = await mapPage(
        page,
        pageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        false,
        "variant",
        runId,
        root,
      );
      extraFields.push(...fields);
      const radioValue = (await radio.getAttribute("value")) ?? groupName;
      const after = await visibleKeys();
      attachDependency(controllerKey, radioValue, before, after);
    }

    if (group.originalValue !== null) {
      const originalRadio = root
        .locator(
          `input[type='radio'][name=\"${groupName}\"][value=\"${group.originalValue}\"]`,
        )
        .first();
      await originalRadio.check().catch(() => null);
      await page.waitForTimeout(100);
    }
  }

  return extraFields;
}

async function mapTabs(
  page: import("playwright").Page,
  basePageId: string,
  title: string | undefined,
  usedPageIds: Set<string>,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  timeoutMs: number,
  navPath: QueueItem["navPath"],
  runId: string,
  recordSnapshot: SnapshotRecorder,
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const tabLocator = page.locator("[role='tab']");
  const tabCount = await tabLocator.count();
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tabCount; i += 1) {
    const tab = tabLocator.nth(i);
    if (!(await tab.isVisible().catch(() => false))) continue;

    const label =
      (await tab.getAttribute("aria-label"))?.trim() ||
      (await tab.innerText()).trim() ||
      (await tab.textContent())?.trim();
    if (!label) continue;
    if (TAB_SKIP_RE.test(label)) continue;
    if (seen.has(label)) continue;
    seen.add(label);

    await tab.click({ timeout: timeoutMs }).catch(() => null);
    await page.waitForTimeout(200);

    const tabPageId = uniqueId(`${basePageId}.${slugify(label)}`, usedPageIds);
    const tabTitle = title ? `${title} - ${label}` : label;
    const { fields: tabFields, actions } = await mapPage(
      page,
      tabPageId,
      usedFieldIds,
      knownFieldKeys,
      defaultsBySelectorKey,
      fieldsBySelectorKey,
      CRAWL_EXPAND_CHOICES,
      "scan",
      runId,
    );
    tabFields.forEach((field) => {
      if (actions && actions.length) {
        field.actions = actions;
      }
      fields.push(field);
    });

    if (CRAWL_EXPAND_CHOICES) {
      const extra = await expandWithChoiceVariants(
        page,
        tabPageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        runId,
      );
      extra.forEach((field) => fields.push(field));
    }

    const breadcrumbs = await readBreadcrumbTrail(page);
    pages.push({
      id: tabPageId,
      title: tabTitle,
      url: page.url(),
      breadcrumbs,
      actions,
      navPath: [
        ...navPath,
        {
          action: "click",
          selector: { kind: "role", role: "tab", name: label },
          label,
          kind: "tab",
          urlAfter: page.url(),
        },
      ],
    });
    await recordSnapshot(page, tabPageId);

    const tabModalResults = await mapModalTriggers(
      page,
      tabPageId,
      usedPageIds,
      usedFieldIds,
      knownFieldKeys,
      defaultsBySelectorKey,
      fieldsBySelectorKey,
      timeoutMs,
      [
        ...navPath,
        {
          action: "click",
          selector: { kind: "role", role: "tab", name: label },
          label,
          kind: "tab",
          urlAfter: page.url(),
        },
      ],
      undefined,
      runId,
      recordSnapshot,
      tabFields,
    );
    tabModalResults.pages.forEach((modalPage) => pages.push(modalPage));
    tabModalResults.fields.forEach((modalField) => fields.push(modalField));
  }

  return { pages, fields };
}

async function loadCrawlFlows(): Promise<CrawlFlow[]> {
  try {
    const raw = await readFile(CRAWL_FLOWS_PATH, "utf8");
    const parsed = JSON.parse(raw) as CrawlFlowsConfig;
    if (!parsed.flows || !Array.isArray(parsed.flows)) return [];
    return parsed.flows;
  } catch {
    return [];
  }
}

async function runCrawlFlows(
  page: import("playwright").Page,
  usedPageIds: Set<string>,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  timeoutMs: number,
  runId: string,
  recordSnapshot: SnapshotRecorder,
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];
  const flows = await loadCrawlFlows();
  let activePage = page;
  for (const flow of flows) {
    try {
      if (activePage.isClosed()) {
        activePage = await activePage.context().newPage();
        activePage.context().setDefaultTimeout(timeoutMs);
        activePage.context().setDefaultNavigationTimeout(timeoutMs);
      }
      await activePage.goto(flow.startUrl, {
        waitUntil: "networkidle",
        timeout: timeoutMs,
      });
      if (await isLoginPage(activePage)) {
        await login(activePage);
      }

      const navPath: QueueItem["navPath"] = [
        { action: "goto", url: flow.startUrl },
      ];
      for (const step of flow.steps) {
        if (FLOW_STEP_SKIP_RE.test(step.name)) continue;
        const locator =
          step.role === "link"
            ? activePage.getByRole("link", { name: step.name }).first()
            : step.role === "menuitem"
              ? activePage.getByRole("menuitem", { name: step.name }).first()
              : activePage.getByRole("button", { name: step.name }).first();
        if (await locator.count()) {
          await locator.click();
          await activePage.waitForLoadState("networkidle").catch(() => null);
          navPath.push({
            action: "click",
            selector: { kind: "role", role: step.role, name: step.name },
            label: step.name,
            kind: step.role === "menuitem" ? "menu" : step.role,
          });
        }
      }

      const title = flow.title ?? (await activePage.title());
      const pageId = uniqueId(slugify(title || flow.id), usedPageIds);
      const { fields: pageFields, actions } = await mapPage(
        activePage,
        pageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        CRAWL_EXPAND_CHOICES,
        "scan",
        runId,
      );
      pageFields.forEach((field) => {
        if (actions && actions.length) {
          field.actions = actions;
        }
        fields.push(field);
      });

      if (CRAWL_EXPAND_CHOICES) {
        const extra = await expandWithChoiceVariants(
          activePage,
          pageId,
          usedFieldIds,
          knownFieldKeys,
          defaultsBySelectorKey,
          fieldsBySelectorKey,
          timeoutMs,
          runId,
        );
        extra.forEach((field) => fields.push(field));
      }

      const breadcrumbs = await readBreadcrumbTrail(activePage);
      pages.push({
        id: pageId,
        title: title || undefined,
        url: activePage.url(),
        breadcrumbs,
        actions,
        navPath,
      });
      await recordSnapshot(activePage, pageId);

      const modalResults = await mapModalTriggers(
        activePage,
        pageId,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        navPath,
        inferModalTriggerLabels(flow),
        runId,
        recordSnapshot,
        pageFields,
      );
      modalResults.pages.forEach((modalPage) => pages.push(modalPage));
      modalResults.fields.forEach((modalField) => fields.push(modalField));
    } catch (err) {
      console.warn(`Flow ${flow.id} failed`, err);
    }
  }
  return { pages, fields };
}

async function collectMenuLabels(
  page: import("playwright").Page,
): Promise<Array<{ label: string; role: "link" | "button" }>> {
  const menuRoots = page.locator(
    "nav, [role='navigation'], .menu, .nav, .sidebar, .xux-leftmenu, .xux-menu",
  );
  const candidates = menuRoots.locator(
    "a, button, [role='link'], [role='button']",
  );
  const labels: Array<{ label: string; role: "link" | "button" }> = [];
  const seen = new Set<string>();
  const count = await candidates.count();

  for (let i = 0; i < count; i += 1) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const tag = (await el.evaluate((node) => node.tagName)).toLowerCase();
    const roleAttr = (await el.getAttribute("role"))?.toLowerCase();
    const label =
      (await el.getAttribute("aria-label"))?.trim() ||
      (await el.innerText()).trim();
    if (!label) continue;
    if (MENU_SKIP_RE.test(label)) continue;
    const role: "link" | "button" =
      roleAttr === "button" || tag === "button" ? "button" : "link";
    const key = `${role}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push({ label, role });
  }

  return labels;
}

async function runMenuTraversal(
  page: import("playwright").Page,
  baseUrl: string,
  usedPageIds: Set<string>,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  timeoutMs: number,
  runId: string,
  recordSnapshot: SnapshotRecorder,
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: timeoutMs });
  if (await isLoginPage(page)) {
    await login(page);
  }

  const menuLabels = await collectMenuLabels(page);
  for (const item of menuLabels) {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    if (await isLoginPage(page)) {
      await login(page);
    }

    const trigger = page.getByRole(item.role, { name: item.label }).first();
    if (!(await trigger.count())) continue;
    await trigger.click().catch(() => null);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForTimeout(200);

    const title = (await page.title()) || item.label;
    const pageId = uniqueId(slugify(title), usedPageIds);
    const navPath: QueueItem["navPath"] = [
      { action: "goto", url: baseUrl },
      {
        action: "click",
        selector: { kind: "role", role: item.role, name: item.label },
        label: item.label,
        kind: item.role,
      },
    ];

    const { fields: pageFields, actions } = await mapPage(
      page,
      pageId,
      usedFieldIds,
      knownFieldKeys,
      defaultsBySelectorKey,
      fieldsBySelectorKey,
      CRAWL_EXPAND_CHOICES,
      "scan",
      runId,
    );
    pageFields.forEach((field) => {
      if (actions && actions.length) {
        field.actions = actions;
      }
      fields.push(field);
    });

    if (CRAWL_EXPAND_CHOICES) {
      const extra = await expandWithChoiceVariants(
        page,
        pageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        runId,
      );
      extra.forEach((field) => fields.push(field));
    }

    const breadcrumbs = await readBreadcrumbTrail(page);
    pages.push({
      id: pageId,
      title: title || undefined,
      url: page.url(),
      breadcrumbs,
      actions,
      navPath,
    });
    await recordSnapshot(page, pageId);

    const modalResults = await mapModalTriggers(
      page,
      pageId,
      usedPageIds,
      usedFieldIds,
      knownFieldKeys,
      defaultsBySelectorKey,
      fieldsBySelectorKey,
      timeoutMs,
      navPath,
      undefined,
      runId,
      recordSnapshot,
      pageFields,
    );
    modalResults.pages.forEach((modalPage) => pages.push(modalPage));
    modalResults.fields.forEach((modalField) => fields.push(modalField));
  }

  return { pages, fields };
}

async function mapModalTriggersInternal(
  page: import("playwright").Page,
  basePageId: string,
  usedPageIds: Set<string>,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  timeoutMs: number,
  navPath: QueueItem["navPath"],
  triggerLabels: string[] | undefined,
  runId: string,
  recordSnapshot: SnapshotRecorder,
  parentFields: FieldEntry[] = [],
  scopeRoot?: import("playwright").Locator,
  modalDepth = 0,
  modalStack: string[] = [],
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];

  if (modalDepth >= MAX_MODAL_DEPTH) {
    return { pages, fields };
  }

  const activeRoot = scopeRoot ?? page.locator("body");

  const waitForModalOpen = async (): Promise<
    { root: import("playwright").Locator; method: string } | undefined
  > => {
    const deadline = Date.now() + Math.min(timeoutMs, 5000);
    while (Date.now() < deadline) {
      const detailRoot = page.locator("#detailSettingsModalRoot").first();
      if ((await detailRoot.count().catch(() => 0)) > 0) {
        const visible = await detailRoot.isVisible().catch(() => false);
        const attached =
          (await detailRoot.getAttribute("id").catch(() => null)) !== null;
        if (visible || attached) {
          await detailRoot
            .locator(".xux-modalWindow-title-text")
            .first()
            .waitFor({ state: "visible", timeout: 800 })
            .catch(() => null);
          return { root: detailRoot, method: "#detailSettingsModalRoot" };
        }
      }

      const dialogContent = page
        .locator(".ui-dialog-content.ui-widget-content")
        .first();
      if ((await dialogContent.count().catch(() => 0)) > 0) {
        const ariaHidden =
          (await dialogContent.getAttribute("aria-hidden").catch(() => "")) ??
          "";
        const visible = await dialogContent.isVisible().catch(() => false);
        if (ariaHidden !== "true" && visible) {
          return {
            root: dialogContent,
            method: ".ui-dialog-content.ui-widget-content",
          };
        }
      }

      const dialog = page.locator(".ui-dialog:visible").first();
      if ((await dialog.count().catch(() => 0)) > 0) {
        const content = dialog
          .locator(
            "#detailSettingsModalRoot, .ui-dialog-content, .xux-modalWindow-content",
          )
          .first();
        if ((await content.count().catch(() => 0)) > 0) {
          return { root: content, method: ".ui-dialog:visible" };
        }
        return { root: dialog, method: ".ui-dialog:visible" };
      }

      await page.waitForTimeout(100);
    }
    return undefined;
  };

  const closeModal = async (
    modalRoot: import("playwright").Locator,
  ): Promise<{ closed: boolean; method: string; closeControls: string[] }> => {
    const closeControls: string[] = [];
    let method = "escape";
    const cancelButton = modalRoot
      .locator("button#detailSettingsModalCancel")
      .first();
    if ((await cancelButton.count().catch(() => 0)) > 0) {
      closeControls.push("#detailSettingsModalCancel");
      method = "cancel-button";
      await cancelButton.click().catch(() => null);
    } else {
      const closeX = page.locator(".ui-dialog-titlebar-close").first();
      if ((await closeX.count().catch(() => 0)) > 0) {
        closeControls.push(".ui-dialog-titlebar-close");
        method = "titlebar-close";
        await closeX.click().catch(() => null);
      } else {
        method = "escape";
        await page.keyboard.press("Escape").catch(() => null);
      }
    }

    const deadline = Date.now() + Math.min(timeoutMs, 4000);
    while (Date.now() < deadline) {
      const detailRoot = page.locator("#detailSettingsModalRoot").first();
      const detailVisible =
        (await detailRoot.count().catch(() => 0)) > 0 &&
        (await detailRoot.isVisible().catch(() => false));
      const anyDialogVisible =
        (await page
          .locator(".ui-dialog:visible")
          .count()
          .catch(() => 0)) > 0;
      const modalVisible = await modalRoot.isVisible().catch(() => false);
      if (!detailVisible && !anyDialogVisible && !modalVisible) {
        return { closed: true, method, closeControls };
      }
      await page.waitForTimeout(100);
    }

    return { closed: false, method, closeControls };
  };

  const modalSnippet = async (
    modalRoot: import("playwright").Locator,
  ): Promise<string> =>
    (await modalRoot
      .evaluate((el) =>
        (el.outerHTML || "").replace(/\s+/g, " ").trim().slice(0, 500),
      )
      .catch(() => "")) || "";

  const staticTriggerLocator = (
    field: FieldEntry,
  ): import("playwright").Locator | undefined => {
    const cssIdSelector = field.selectors.find(
      (selector) =>
        selector.kind === "css" && (selector.value ?? "").startsWith("#"),
    )?.value;
    if (cssIdSelector) {
      return activeRoot.locator(cssIdSelector).first();
    }

    const label = (field.label ?? "").trim();
    if (!label) return undefined;
    return activeRoot
      .locator(".xux-staticTextBox[role='button']")
      .filter({
        has: activeRoot.locator("label.xux-labelableBox-label", {
          hasText: label,
        }),
      })
      .first();
  };

  const staticFields = parentFields.filter(
    (field) => field.controlType === "staticTextButton",
  );
  for (const parentField of staticFields) {
    parentField.opensModal = true;
    parentField.interaction = "opensModal";
    const trigger = staticTriggerLocator(parentField);
    if (!trigger) continue;
    if ((await trigger.count().catch(() => 0)) === 0) continue;

    const parentLabel = (parentField.label ?? parentField.id).trim();
    const parentSelector =
      parentField.selectors.find((selector) => selector.kind === "css")
        ?.value ??
      parentField.selectors.find((selector) => selector.kind === "role")
        ?.name ??
      parentField.selectors.find((selector) => selector.kind === "label")
        ?.value ??
      "(unknown)";

    await trigger.scrollIntoViewIfNeeded().catch(() => null);
    await trigger.click({ trial: true }).catch(() => null);
    await trigger.click().catch(() => null);

    const opened = await waitForModalOpen();
    if (!opened) {
      console.warn(
        JSON.stringify({
          event: "static-text-modal-open-failed",
          parentLabel,
          parentSelector,
          modalOpenDetectionMethodTried:
            "#detailSettingsModalRoot|.ui-dialog:visible|.ui-dialog-content.ui-widget-content",
        }),
      );
      continue;
    }

    const modalRoot = opened.root;
    const modalTitle =
      normalizeLabel(
        await modalRoot
          .locator(".xux-modalWindow-title-text, h1, h2, h3")
          .first()
          .innerText()
          .catch(() => ""),
      ) ?? "modal";
    const modalStackKey = `${modalTitle.toLowerCase()}|${modalDepth}`;
    if (modalStack.includes(modalStackKey)) {
      await closeModal(modalRoot).catch(() => null);
      continue;
    }

    const modalPageId = uniqueId(
      `modal::${parentField.fieldId ?? parentField.id}::${slugify(modalTitle || "modal")}`,
      usedPageIds,
    );
    parentField.modalRef = modalPageId;
    parentField.modalTitle = modalTitle;

    try {
      const { fields: modalFields, actions } = await mapPage(
        page,
        modalPageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        CRAWL_EXPAND_CHOICES,
        "scan",
        runId,
        modalRoot,
      );
      modalFields.forEach((field) => {
        if (actions && actions.length) {
          field.actions = actions;
        }
        fields.push(field);
      });

      if (CRAWL_EXPAND_CHOICES) {
        const extra = await expandWithChoiceVariants(
          page,
          modalPageId,
          usedFieldIds,
          knownFieldKeys,
          defaultsBySelectorKey,
          fieldsBySelectorKey,
          timeoutMs,
          runId,
          modalRoot,
        );
        extra.forEach((field) => fields.push(field));
      }

      const modalNavPath: QueueItem["navPath"] = [
        ...navPath,
        {
          action: "click",
          selector: { kind: "label", value: parentLabel },
          label: parentLabel,
          kind: "modal_open",
          urlAfter: page.url(),
        },
      ];

      const breadcrumbs = await readBreadcrumbTrail(page, modalRoot);
      pages.push({
        id: modalPageId,
        title: modalTitle || undefined,
        url: page.url(),
        breadcrumbs,
        actions,
        navPath: modalNavPath,
      });
      await recordSnapshot(page, modalPageId);

      const nested = await mapModalTriggers(
        page,
        modalPageId,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        modalNavPath,
        undefined,
        runId,
        recordSnapshot,
        modalFields,
        modalRoot,
        modalDepth + 1,
        [...modalStack, modalStackKey],
      );
      nested.pages.forEach((nestedPage) => pages.push(nestedPage));
      nested.fields.forEach((nestedField) => fields.push(nestedField));
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "static-text-modal-map-failed",
          parentLabel,
          parentSelector,
          modalOpenDetectionMethod: opened.method,
          error: error instanceof Error ? error.message : String(error),
          modalSnippet: await modalSnippet(modalRoot),
        }),
      );
    } finally {
      const close = await closeModal(modalRoot);
      if (!close.closed) {
        console.warn(
          JSON.stringify({
            event: "static-text-modal-close-failed",
            parentLabel,
            parentSelector,
            modalOpenDetectionMethod: opened.method,
            closeMethod: close.method,
            closeControls: close.closeControls,
            modalSnippet: await modalSnippet(modalRoot),
          }),
        );
      }
    }
  }

  const buttons = activeRoot.getByRole("button", { name: MODAL_TRIGGER_RE });
  const links = activeRoot.getByRole("link", { name: MODAL_TRIGGER_RE });
  const triggerCount = (await buttons.count()) + (await links.count());
  const labels = new Set<string>();

  for (let i = 0; i < (await buttons.count()); i += 1) {
    const label = (await buttons.nth(i).innerText()).trim();
    if (label) labels.add(label);
  }
  for (let i = 0; i < (await links.count()); i += 1) {
    const label = (await links.nth(i).innerText()).trim();
    if (label) labels.add(label);
  }
  MODAL_TRIGGER_LABELS.forEach((label) => labels.add(label));
  if (triggerLabels) {
    triggerLabels.forEach((label) => labels.add(label));
  }

  for (const parentField of staticFields) {
    if (parentField.label) {
      labels.delete(parentField.label);
    }
  }

  if (triggerCount === 0 && !triggerLabels?.length) return { pages, fields };
  if (labels.size === 0) return { pages, fields };

  for (const label of labels) {
    let trigger = activeRoot.getByRole("button", { name: label }).first();
    if (!(await trigger.count())) {
      trigger = activeRoot.getByRole("link", { name: label }).first();
      if (!(await trigger.count())) {
        continue;
      }
    }
    await trigger.click().catch(() => null);
    const opened = await waitForModalOpen();
    if (!opened) {
      continue;
    }

    const modalRoot = opened.root;
    const modalTitle =
      (await modalRoot
        .locator("h1,h2,h3,.xux-modalWindow-title-text")
        .first()
        .innerText()
        .catch(() => "")) || label;
    const modalPageId = uniqueId(
      `${basePageId}.${slugify(modalTitle || "modal")}`,
      usedPageIds,
    );

    const { fields: modalFields, actions } = await mapPage(
      page,
      modalPageId,
      usedFieldIds,
      knownFieldKeys,
      defaultsBySelectorKey,
      fieldsBySelectorKey,
      CRAWL_EXPAND_CHOICES,
      "scan",
      runId,
      modalRoot,
    );
    modalFields.forEach((field) => {
      if (actions && actions.length) {
        field.actions = actions;
      }
      fields.push(field);
    });

    if (CRAWL_EXPAND_CHOICES) {
      const extra = await expandWithChoiceVariants(
        page,
        modalPageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        runId,
        modalRoot,
      );
      extra.forEach((field) => fields.push(field));
    }

    const breadcrumbs = await readBreadcrumbTrail(page, modalRoot);
    pages.push({
      id: modalPageId,
      title: modalTitle || undefined,
      url: page.url(),
      breadcrumbs,
      actions,
      navPath: [
        ...navPath,
        {
          action: "click",
          selector: { kind: "role", role: "button", name: label },
          label,
          kind: "modal_open",
          urlAfter: page.url(),
        },
      ],
    });
    await recordSnapshot(page, modalPageId);

    await closeModal(modalRoot).catch(() => null);
    await page.waitForTimeout(150);
  }

  return { pages, fields };
}

async function mapModalTriggers(
  page: import("playwright").Page,
  basePageId: string,
  usedPageIds: Set<string>,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  defaultsBySelectorKey: Map<string, FieldEntry["defaultValue"]>,
  fieldsBySelectorKey: Map<string, FieldEntry>,
  timeoutMs: number,
  navPath: QueueItem["navPath"],
  triggerLabels: string[] | undefined,
  runId: string,
  recordSnapshot: SnapshotRecorder,
  parentFields: FieldEntry[] = [],
  scopeRoot?: import("playwright").Locator,
  modalDepth = 0,
  modalStack: string[] = [],
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  return mapModalTriggersInternal(
    page,
    basePageId,
    usedPageIds,
    usedFieldIds,
    knownFieldKeys,
    defaultsBySelectorKey,
    fieldsBySelectorKey,
    timeoutMs,
    navPath,
    triggerLabels,
    runId,
    recordSnapshot,
    parentFields,
    scopeRoot,
    modalDepth,
    modalStack,
  );
}

function inferModalTriggerLabels(flow: CrawlFlow): string[] {
  const inferred = new Set<string>(flow.modalTriggers ?? []);
  for (const step of flow.steps) {
    if (step.role !== "button" && step.role !== "link") continue;
    if (MENU_SKIP_RE.test(step.name) || FLOW_STEP_SKIP_RE.test(step.name))
      continue;
    if (MODAL_TRIGGER_RE.test(step.name)) {
      inferred.add(step.name);
    }
  }
  return Array.from(inferred);
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  if (!CRAWL_INCLUDE_HASH) {
    parsed.hash = "";
  }
  return parsed.toString();
}

async function runCrawler(opts: MapperCliOptions): Promise<void> {
  requireCreds();
  const runId = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const snapshotRoot = path.join(
    "tools",
    "recordings",
    `crawler-${runId}`,
    "nodes",
  );
  await mkdir(snapshotRoot, { recursive: true });
  const browser = await openBrowser();
  const page = await newPage(browser);
  const crawlerUrl = opts.url || PRINTER_URL;
  const timeoutMs = opts.timeoutMs || NAV_TIMEOUT_MS;
  const crawlMaxPages =
    typeof opts.maxClicks === "number" ? opts.maxClicks : CRAWL_MAX_PAGES;

  const visited = new Set<string>();
  const usedFieldIds = new Set<string>();
  const knownFieldKeys = new Set<string>();
  const defaultsBySelectorKey = new Map<string, FieldEntry["defaultValue"]>();
  const fieldsBySelectorKey = new Map<string, FieldEntry>();
  const usedPageIds = new Set<string>();
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];
  const snapshotsByPageId = new Map<string, string>();

  const recordSnapshot: SnapshotRecorder = async (activePage, pageId) => {
    if (snapshotsByPageId.has(pageId)) return;
    const shotPath = path.join(snapshotRoot, `${slugify(pageId)}.png`);
    await activePage
      .screenshot({ path: shotPath, fullPage: true })
      .catch(() => null);
    snapshotsByPageId.set(pageId, shotPath);
  };

  const queue: QueueItem[] = [
    { url: crawlerUrl, navPath: [{ action: "goto", url: crawlerUrl }] },
  ];
  for (const seed of CRAWL_SEED_PATHS) {
    try {
      const seedUrl = new URL(seed, crawlerUrl).toString();
      queue.push({
        url: seedUrl,
        navPath: [{ action: "goto", url: seedUrl }],
      });
    } catch {
      console.warn(`Skipping invalid seed: ${seed}`);
    }
  }

  while (queue.length > 0) {
    if (pages.length >= crawlMaxPages) {
      console.warn(`Reached crawl cap=${crawlMaxPages}. Stopping crawl.`);
      break;
    }
    const item = queue.shift();
    if (!item) break;
    const normalized = normalizeUrl(item.url);
    if (visited.has(normalized)) continue;

    try {
      await page.goto(item.url, {
        waitUntil: "networkidle",
        timeout: timeoutMs,
      });

      if (await isLoginPage(page)) {
        await login(page);
      }

      const title = (await page.title()) || undefined;
      const pageId = uniqueId(
        slugify((title ?? new URL(item.url).pathname) || "page"),
        usedPageIds,
      );

      const { fields: pageFields, actions } = await mapPage(
        page,
        pageId,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        CRAWL_EXPAND_CHOICES,
        "scan",
        runId,
      );
      pageFields.forEach((field) => {
        if (actions && actions.length) {
          field.actions = actions;
        }
        fields.push(field);
      });

      if (CRAWL_EXPAND_CHOICES) {
        const extra = await expandWithChoiceVariants(
          page,
          pageId,
          usedFieldIds,
          knownFieldKeys,
          defaultsBySelectorKey,
          fieldsBySelectorKey,
          timeoutMs,
          runId,
        );
        extra.forEach((field) => fields.push(field));
      }

      const breadcrumbs = await readBreadcrumbTrail(page);
      pages.push({
        id: pageId,
        title,
        url: page.url(),
        breadcrumbs,
        actions,
        navPath: item.navPath,
      });
      await recordSnapshot(page, pageId);

      const tabResults = await mapTabs(
        page,
        pageId,
        title,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        item.navPath,
        runId,
        recordSnapshot,
      );
      tabResults.pages.forEach((tabPage) => pages.push(tabPage));
      tabResults.fields.forEach((tabField) => fields.push(tabField));

      const modalResults = await mapModalTriggers(
        page,
        pageId,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        defaultsBySelectorKey,
        fieldsBySelectorKey,
        timeoutMs,
        item.navPath,
        undefined,
        runId,
        recordSnapshot,
        pageFields,
      );
      modalResults.pages.forEach((modalPage) => pages.push(modalPage));
      modalResults.fields.forEach((modalField) => fields.push(modalField));

      const links = await discoverLinks(page, page.url());
      for (const link of links) {
        const navPath = [...item.navPath];
        if (link.text) {
          navPath.push({
            action: "click",
            selector: { kind: "role", role: "link", name: link.text },
            label: link.text,
            kind: "link",
            urlBefore: page.url(),
            urlAfter: link.href,
            timestamp: new Date().toISOString(),
          });
        } else {
          navPath.push({ action: "goto", url: link.href });
        }
        queue.push({ url: link.href, navPath });
      }

      visited.add(normalized);
      console.log(`Mapped: ${item.url} (fields: ${pageFields.length})`);
    } catch (err) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await page.screenshot({
        path: `tools/recordings/map-error-${ts}.png`,
        fullPage: true,
      });
      console.error(`Failed mapping ${item.url}`, err);
      visited.add(normalized);
    }
  }

  if (CRAWL_MENU_TRAVERSE) {
    const menuResults = await runMenuTraversal(
      page,
      crawlerUrl,
      usedPageIds,
      usedFieldIds,
      knownFieldKeys,
      defaultsBySelectorKey,
      fieldsBySelectorKey,
      timeoutMs,
      runId,
      recordSnapshot,
    );
    menuResults.pages.forEach((menuPage) => pages.push(menuPage));
    menuResults.fields.forEach((menuField) => fields.push(menuField));
  }

  const flowResults = await runCrawlFlows(
    page,
    usedPageIds,
    usedFieldIds,
    knownFieldKeys,
    defaultsBySelectorKey,
    fieldsBySelectorKey,
    timeoutMs,
    runId,
    recordSnapshot,
  );
  flowResults.pages.forEach((flowPage) => pages.push(flowPage));
  flowResults.fields.forEach((flowField) => fields.push(flowField));

  const map: UiMap = {
    meta: {
      generatedAt: new Date().toISOString(),
      printerUrl: crawlerUrl,
      schemaVersion: "1.1",
    },
    pages,
    fields,
  };

  attachCanonicalGraph(map, {
    runId,
    capturedAt: new Date().toISOString(),
    mapperVersion: process.env.npm_package_version,
    snapshotsByPageId,
  });

  const outputDir = path.dirname(OUTPUT_PATH);
  await mkdir(outputDir, { recursive: true });
  await writeMap(OUTPUT_PATH, map);
  validateMapForYaml(map, (warning) =>
    console.warn(`[yaml-validation] ${warning}`),
  );
  const { navigationYaml, layoutYaml } = buildYamlViews(map);
  const navigationYamlPath = path.join(outputDir, "ui-tree.navigation.yaml");
  const layoutYamlPath = path.join(outputDir, "ui-tree.layout.yaml");
  await writeFile(navigationYamlPath, navigationYaml, "utf8");
  await writeFile(layoutYamlPath, layoutYaml, "utf8");
  const contractArtifacts = await writeCaptureArtifacts(map, "dist");
  await browser.close();
  console.log(
    `Wrote ${OUTPUT_PATH} (${pages.length} pages, ${fields.length} fields)`,
  );
  console.log(`Wrote ${navigationYamlPath}`);
  console.log(`Wrote ${layoutYamlPath}`);
  console.log(`Wrote ${contractArtifacts.paths.schema}`);
  console.log(`Wrote ${contractArtifacts.paths.form}`);
  console.log(`Wrote ${contractArtifacts.paths.verify}`);
}

try {
  const cliOptions = parseMapperCliArgs(process.argv.slice(2));
  const runner = cliOptions.manual
    ? runManualMapper(cliOptions)
    : runCrawler(cliOptions);
  runner.catch((err) => {
    console.error(err);
    process.exit(1);
  });
} catch (err) {
  console.error(err);
  process.exit(1);
}
