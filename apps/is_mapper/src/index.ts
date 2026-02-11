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
  requireCreds
} from "@is-browser/env";
import { writeMap } from "@is-browser/contract";
import {
  type FieldEntry,
  type PageEntry,
  type Selector,
  type UiMap
} from "@is-browser/contract";
import { buildSelectorCandidates, roleForType, slugify, uniqueId } from "./utils.js";
import { isLoginPage, login } from "./login.js";
import { mkdir, readFile } from "node:fs/promises";
import { URL } from "node:url";

const OUTPUT_PATH = process.env.MAP_PATH ?? "state/printer-ui-map.json";
const TAB_SKIP_RE = /logout|log out|delete|reset|save|apply|submit|cancel|ok/i;
const MODAL_TRIGGER_RE =
  /details|device details|system administrator|device location|network summary/i;
const MODAL_TRIGGER_LABELS = [
  "Details",
  "Device Details",
  "System Administrator",
  "Device Location",
  "Network Summary"
];
const MENU_SKIP_RE = /logout|log out|delete|reset|save|apply|submit/i;
const FLOW_STEP_SKIP_RE = /log in|login|logout|log out|save|apply|restart|delete|reset/i;
const MODAL_CLOSE_RE = /cancel|close|done|ok/i;

type QueueItem = {
  url: string;
  navPath: { action: "goto" | "click"; selector?: Selector; url?: string }[];
};

type CrawlFlow = {
  id: string;
  title?: string;
  startUrl: string;
  steps: Array<{ action: "click"; role: "button" | "link" | "menuitem"; name: string }>;
  modalTriggers?: string[];
};

type CrawlFlowsConfig = {
  flows: CrawlFlow[];
};

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
          onclick.match(/(?:location\.href|window\.location(?:\.href)?|location)\s*=\s*["']([^"']+)["']/i) ||
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
    if (trimmed.startsWith("mailto:") || trimmed.startsWith("javascript:")) continue;
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
  expandChoices: boolean,
  scope?: import("playwright").Locator
): Promise<{ fields: FieldEntry[]; actions: FieldEntry["actions"] }> {
  const fieldEntries: FieldEntry[] = [];

  const root = scope ?? page.locator("body");
  const inputs = root.locator(
    "input, textarea, select, [role='textbox'], [role='combobox'], [role='checkbox'], [role='radio'], [role='spinbutton']"
  );
  const count = await inputs.count();

  for (let i = 0; i < count; i += 1) {
    const element = inputs.nth(i);
    if (!(await element.isVisible().catch(() => false))) {
      continue;
    }

    const tag = (await element.evaluate((el) => el.tagName)).toLowerCase();
    const roleAttr = (await element.getAttribute("role"))?.toLowerCase();
    const typeAttr = (await element.getAttribute("type"))?.toLowerCase();

    if (tag === "input" && (typeAttr === "hidden" || typeAttr === "submit")) {
      continue;
    }

    let fieldType: FieldEntry["type"] = "text";
    if (tag === "textarea") fieldType = "textarea";
    else if (tag === "select") fieldType = "select";
    else if (typeAttr === "checkbox") fieldType = "checkbox";
    else if (typeAttr === "radio") fieldType = "radio";
    else if (typeAttr === "number") fieldType = "number";
    else if (typeAttr === "button") fieldType = "button";
    else if (roleAttr === "checkbox") fieldType = "checkbox";
    else if (roleAttr === "radio") fieldType = "radio";
    else if (roleAttr === "combobox") fieldType = "select";
    else if (roleAttr === "spinbutton") fieldType = "number";
    else if (roleAttr === "button") fieldType = "button";

    const { label, selectors } = await buildSelectorCandidates(page, element);

    const role = roleForType(fieldType);
    if (role && label) {
      selectors.unshift({ kind: "role", role, name: label });
    }

    if (selectors.length === 0) continue;

    const labelSlug = slugify(label ?? (await element.getAttribute("name")) ?? "field");
    const fieldId = uniqueId(`${pageId}.${labelSlug}`, usedFieldIds);

    const constraints: FieldEntry["constraints"] = {};
    const min = await element.getAttribute("min");
    const max = await element.getAttribute("max");
    const pattern = await element.getAttribute("pattern");
    const readOnly = (await element.getAttribute("readonly")) !== null || (await element.getAttribute("disabled")) !== null;

    if (min) constraints.min = Number(min);
    if (max) constraints.max = Number(max);
    if (pattern) constraints.pattern = pattern;
    if (readOnly) constraints.readOnly = true;

    if (fieldType === "select") {
      const options = element.locator("option");
      const optionCount = await options.count();
      const values: string[] = [];
      for (let j = 0; j < optionCount; j += 1) {
        const option = options.nth(j);
        const value = (await option.getAttribute("value")) ?? (await option.innerText());
        if (value) values.push(value.trim());
      }
      if (values.length > 0) constraints.enum = values;
    }

    const key = `${pageId}|${fieldType}|${(label ?? "").toLowerCase()}`;
    if (!knownFieldKeys.has(key)) {
      knownFieldKeys.add(key);
      fieldEntries.push({
        id: fieldId,
        label: label,
        type: fieldType,
        selectors,
        pageId,
        constraints: Object.keys(constraints).length ? constraints : undefined
      });
    }
  }

  const actionButtons = root.getByRole("button", { name: /save|apply|ok|submit/i });
  const actionCount = await actionButtons.count();
  const actions: FieldEntry["actions"] = [];

  for (let i = 0; i < actionCount; i += 1) {
    const button = actionButtons.nth(i);
    const label = (await button.innerText()).trim();
    if (!label) continue;
    actions.push({ selector: { kind: "role", role: "button", name: label }, label });
  }

  return { fields: fieldEntries, actions: actions.length ? actions : undefined };
}

async function expandWithChoiceVariants(
  page: import("playwright").Page,
  pageId: string,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  scope?: import("playwright").Locator
): Promise<FieldEntry[]> {
  const extraFields: FieldEntry[] = [];

  const root = scope ?? page.locator("body");
  const selects = root.locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i);
    const options = select.locator("option");
    const optionCount = await options.count();
    for (let j = 0; j < optionCount; j += 1) {
      const option = options.nth(j);
      const value = (await option.getAttribute("value")) ?? (await option.innerText());
      if (!value) continue;
      await select.selectOption(value).catch(() => null);
      await page.waitForTimeout(150);
      const { fields } = await mapPage(page, pageId, usedFieldIds, knownFieldKeys, false, root);
      extraFields.push(...fields);
    }
  }

  const radios = root.locator("input[type='radio']");
  const radioCount = await radios.count();
  for (let i = 0; i < radioCount; i += 1) {
    const radio = radios.nth(i);
    await radio.check().catch(() => null);
    await page.waitForTimeout(150);
    const { fields } = await mapPage(page, pageId, usedFieldIds, knownFieldKeys, false, root);
    extraFields.push(...fields);
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
  navPath: QueueItem["navPath"]
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

    await tab.click({ timeout: NAV_TIMEOUT_MS }).catch(() => null);
    await page.waitForTimeout(200);

    const tabPageId = uniqueId(`${basePageId}.${slugify(label)}`, usedPageIds);
    const tabTitle = title ? `${title} - ${label}` : label;
    const { fields: tabFields, actions } = await mapPage(
      page,
      tabPageId,
      usedFieldIds,
      knownFieldKeys,
      CRAWL_EXPAND_CHOICES
    );
    tabFields.forEach((field) => {
      if (actions && actions.length) {
        field.actions = actions;
      }
      fields.push(field);
    });

    if (CRAWL_EXPAND_CHOICES) {
      const extra = await expandWithChoiceVariants(page, tabPageId, usedFieldIds, knownFieldKeys);
      extra.forEach((field) => fields.push(field));
    }

    pages.push({
      id: tabPageId,
      title: tabTitle,
      url: page.url(),
      navPath: [
        ...navPath,
        { action: "click", selector: { kind: "role", role: "tab", name: label } }
      ]
    });
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
  knownFieldKeys: Set<string>
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];
  const flows = await loadCrawlFlows();
  let activePage = page;
  for (const flow of flows) {
    try {
      if (activePage.isClosed()) {
        activePage = await activePage.context().newPage();
        activePage.context().setDefaultTimeout(NAV_TIMEOUT_MS);
        activePage.context().setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
      }
      await activePage.goto(flow.startUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
      if (await isLoginPage(activePage)) {
        await login(activePage);
      }

      const navPath: QueueItem["navPath"] = [{ action: "goto", url: flow.startUrl }];
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
            selector: { kind: "role", role: step.role, name: step.name }
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
        CRAWL_EXPAND_CHOICES
      );
      pageFields.forEach((field) => {
        if (actions && actions.length) {
          field.actions = actions;
        }
        fields.push(field);
      });

      if (CRAWL_EXPAND_CHOICES) {
        const extra = await expandWithChoiceVariants(activePage, pageId, usedFieldIds, knownFieldKeys);
        extra.forEach((field) => fields.push(field));
      }

      pages.push({
        id: pageId,
        title: title || undefined,
        url: activePage.url(),
        navPath
      });

      const modalResults = await mapModalTriggers(
        activePage,
        pageId,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        navPath,
        inferModalTriggerLabels(flow)
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
  page: import("playwright").Page
): Promise<Array<{ label: string; role: "link" | "button" }>> {
  const menuRoots = page.locator("nav, [role='navigation'], .menu, .nav, .sidebar, .xux-leftmenu, .xux-menu");
  const candidates = menuRoots.locator(
    "a, button, [role='link'], [role='button']"
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
  knownFieldKeys: Set<string>
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  if (await isLoginPage(page)) {
    await login(page);
  }

  const menuLabels = await collectMenuLabels(page);
  for (const item of menuLabels) {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
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
      { action: "click", selector: { kind: "role", role: item.role, name: item.label } }
    ];

    const { fields: pageFields, actions } = await mapPage(
      page,
      pageId,
      usedFieldIds,
      knownFieldKeys,
      CRAWL_EXPAND_CHOICES
    );
    pageFields.forEach((field) => {
      if (actions && actions.length) {
        field.actions = actions;
      }
      fields.push(field);
    });

    if (CRAWL_EXPAND_CHOICES) {
      const extra = await expandWithChoiceVariants(page, pageId, usedFieldIds, knownFieldKeys);
      extra.forEach((field) => fields.push(field));
    }

    pages.push({
      id: pageId,
      title: title || undefined,
      url: page.url(),
      navPath
    });

    const modalResults = await mapModalTriggers(
      page,
      pageId,
      usedPageIds,
      usedFieldIds,
      knownFieldKeys,
      navPath
    );
    modalResults.pages.forEach((modalPage) => pages.push(modalPage));
    modalResults.fields.forEach((modalField) => fields.push(modalField));
  }

  return { pages, fields };
}

async function mapModalTriggers(
  page: import("playwright").Page,
  basePageId: string,
  usedPageIds: Set<string>,
  usedFieldIds: Set<string>,
  knownFieldKeys: Set<string>,
  navPath: QueueItem["navPath"],
  triggerLabels?: string[]
): Promise<{ pages: PageEntry[]; fields: FieldEntry[] }> {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];

  const buttons = page.getByRole("button", { name: MODAL_TRIGGER_RE });
  const links = page.getByRole("link", { name: MODAL_TRIGGER_RE });
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

  if (triggerCount === 0 && !triggerLabels?.length) return { pages, fields };
  if (labels.size === 0) return { pages, fields };

  for (const label of labels) {
    let trigger = page.getByRole("button", { name: label }).first();
    if (!(await trigger.count())) {
      trigger = page.getByRole("link", { name: label }).first();
      if (!(await trigger.count())) {
        continue;
      }
    }
    await trigger.click().catch(() => null);
    const modalRoot = page
      .locator("#deviceDetailsModalRoot, .ui-dialog-content, .xux-modalWindow-content")
      .first();
    await modalRoot.waitFor({ state: "visible", timeout: 4000 }).catch(() => null);
    if (!(await modalRoot.isVisible().catch(() => false))) {
      continue;
    }

    const modalTitle =
      (await modalRoot.locator("h1,h2,h3,.xux-modalWindow-title-text").first().innerText().catch(() => "")) ||
      label;
    const modalPageId = uniqueId(`${basePageId}.${slugify(modalTitle || "modal")}`, usedPageIds);

    const { fields: modalFields, actions } = await mapPage(
      page,
      modalPageId,
      usedFieldIds,
      knownFieldKeys,
      CRAWL_EXPAND_CHOICES,
      modalRoot
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
        modalRoot
      );
      extra.forEach((field) => fields.push(field));
    }

    pages.push({
      id: modalPageId,
      title: modalTitle || undefined,
      url: page.url(),
      navPath: [
        ...navPath,
        { action: "click", selector: { kind: "role", role: "button", name: label } }
      ]
    });

    const closeButton = modalRoot.getByRole("button", { name: MODAL_CLOSE_RE }).first();
    if (await closeButton.count()) {
      await closeButton.click().catch(() => null);
    } else {
      await page.keyboard.press("Escape").catch(() => null);
    }
    await page.waitForTimeout(200);
  }

  return { pages, fields };
}

function inferModalTriggerLabels(flow: CrawlFlow): string[] {
  const inferred = new Set<string>(flow.modalTriggers ?? []);
  for (const step of flow.steps) {
    if (step.role !== "button" && step.role !== "link") continue;
    if (MENU_SKIP_RE.test(step.name) || FLOW_STEP_SKIP_RE.test(step.name)) continue;
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

async function run(): Promise<void> {
  requireCreds();
  await mkdir("tools/recordings", { recursive: true });
  const browser = await openBrowser();
  const page = await newPage(browser);

  const visited = new Set<string>();
  const usedFieldIds = new Set<string>();
  const knownFieldKeys = new Set<string>();
  const usedPageIds = new Set<string>();
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];

  const queue: QueueItem[] = [{ url: PRINTER_URL, navPath: [{ action: "goto", url: PRINTER_URL }] }];
  for (const seed of CRAWL_SEED_PATHS) {
    try {
      const seedUrl = new URL(seed, PRINTER_URL).toString();
      queue.push({
        url: seedUrl,
        navPath: [{ action: "goto", url: seedUrl }]
      });
    } catch {
      console.warn(`Skipping invalid seed: ${seed}`);
    }
  }

  while (queue.length > 0) {
    if (pages.length >= CRAWL_MAX_PAGES) {
      console.warn(`Reached CRAWL_MAX_PAGES=${CRAWL_MAX_PAGES}. Stopping crawl.`);
      break;
    }
    const item = queue.shift();
    if (!item) break;
    const normalized = normalizeUrl(item.url);
    if (visited.has(normalized)) continue;

    try {
      await page.goto(item.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });

      if (await isLoginPage(page)) {
        await login(page);
      }

      const title = (await page.title()) || undefined;
      const pageId = uniqueId(
        slugify((title ?? new URL(item.url).pathname) || "page"),
        usedPageIds
      );

      const { fields: pageFields, actions } = await mapPage(
        page,
        pageId,
        usedFieldIds,
        knownFieldKeys,
        CRAWL_EXPAND_CHOICES
      );
      pageFields.forEach((field) => {
        if (actions && actions.length) {
          field.actions = actions;
        }
        fields.push(field);
      });

      if (CRAWL_EXPAND_CHOICES) {
        const extra = await expandWithChoiceVariants(page, pageId, usedFieldIds, knownFieldKeys);
        extra.forEach((field) => fields.push(field));
      }

      pages.push({
        id: pageId,
        title,
        url: page.url(),
        navPath: item.navPath
      });

      const tabResults = await mapTabs(
        page,
        pageId,
        title,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        item.navPath
      );
      tabResults.pages.forEach((tabPage) => pages.push(tabPage));
      tabResults.fields.forEach((tabField) => fields.push(tabField));

      const modalResults = await mapModalTriggers(
        page,
        pageId,
        usedPageIds,
        usedFieldIds,
        knownFieldKeys,
        item.navPath
      );
      modalResults.pages.forEach((modalPage) => pages.push(modalPage));
      modalResults.fields.forEach((modalField) => fields.push(modalField));

      const links = await discoverLinks(page, page.url());
      for (const link of links) {
        const navPath = [...item.navPath];
        if (link.text) {
          navPath.push({
            action: "click",
            selector: { kind: "role", role: "link", name: link.text }
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
      await page.screenshot({ path: `tools/recordings/map-error-${ts}.png`, fullPage: true });
      console.error(`Failed mapping ${item.url}`, err);
      visited.add(normalized);
    }
  }

  const flowResults = await runCrawlFlows(
    page,
    usedPageIds,
    usedFieldIds,
    knownFieldKeys
  );
  flowResults.pages.forEach((flowPage) => pages.push(flowPage));
  flowResults.fields.forEach((flowField) => fields.push(flowField));

  const map: UiMap = {
    meta: {
      generatedAt: new Date().toISOString(),
      printerUrl: PRINTER_URL,
      schemaVersion: "1.1"
    },
    pages,
    fields
  };

  await writeMap(OUTPUT_PATH, map);
  await browser.close();
  console.log(`Wrote ${OUTPUT_PATH} (${pages.length} pages, ${fields.length} fields)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


