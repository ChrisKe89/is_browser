import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type Page } from "playwright";

type SelectorCandidate = {
  kind: "role" | "label" | "css" | "text";
  role?: string;
  name?: string;
  value?: string;
};

type CaptureControl = {
  label?: string;
  type: "text" | "number" | "checkbox" | "radio" | "select" | "button" | "textarea";
  selectors: SelectorCandidate[];
  value?: string;
  checked?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  pattern?: string;
  readOnly?: boolean;
  disabled?: boolean;
  required?: boolean;
  section?: string;
  modalTitle?: string;
};

type CaptureClick = {
  timestamp: string;
  text?: string;
  role?: string;
  css?: string;
  label?: string;
};

type CaptureRecord = {
  id: string;
  note?: string;
  capturedAt: string;
  url: string;
  title: string;
  modalTitles: string[];
  clicksSinceLastCapture: CaptureClick[];
  controls: CaptureControl[];
};

type PageEntry = {
  id: string;
  title?: string;
  url: string;
  navPath: Array<
    | { action: "goto"; url: string }
    | { action: "click"; selector: SelectorCandidate }
  >;
};

type FieldEntry = {
  id: string;
  label?: string;
  type: "text" | "number" | "checkbox" | "radio" | "select" | "button" | "textarea";
  selectors: SelectorCandidate[];
  pageId: string;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
    readOnly?: boolean;
  };
};

type UiMap = {
  meta: {
    generatedAt: string;
    printerUrl: string;
    schemaVersion: string;
  };
  pages: PageEntry[];
  fields: FieldEntry[];
};

const baseUrl = (process.env.PRINTER_URL ?? "http://192.168.0.107").replace(/\/$/, "");
const username = process.env.PRINTER_USER ?? "";
const password = process.env.PRINTER_PASS ?? "";
const rawCapturePath = process.env.MANUAL_CLICK_CAPTURE_PATH ?? "state/manual-click-captures.json";
const manualMapPath = process.env.MANUAL_CLICK_MAP_PATH ?? "state/printer-ui-map.clicks.json";

function isContextDestroyedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("execution context was destroyed") ||
    lower.includes("most likely because of a navigation") ||
    lower.includes("cannot find context with specified id")
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function nowStamp(): string {
  return new Date().toISOString();
}

function selectorKey(selector: SelectorCandidate): string {
  return JSON.stringify(selector);
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function closeDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const closeButton = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .getByRole("button", { name: "Close" })
      .first();
    if (!(await closeButton.isVisible().catch(() => false))) break;
    await closeButton.click({ timeout: 1500 }).catch(() => null);
    await page.waitForTimeout(250);
  }
}

async function loginIfNeeded(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/home/index.html#hashHome`, { waitUntil: "domcontentloaded" });
  await closeDialogs(page);

  const logInButton = page.getByRole("button", { name: "Log In" }).first();
  if (!(await logInButton.isVisible().catch(() => false))) return;

  if (!username || !password) {
    throw new Error("Missing PRINTER_USER / PRINTER_PASS in environment.");
  }

  await logInButton.click();
  await page.getByRole("textbox", { name: "User ID" }).fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByLabel("Log In").getByRole("button", { name: "Log In" }).click();
  await closeDialogs(page);
}

async function installClickLogger(page: Page): Promise<void> {
  await page.evaluate(`
(() => {
  const g = window;
  if (g.__manualMapInstalled) return;

  const text = (el) => {
    const t = (el && el.textContent ? el.textContent : "").replace(/\\s+/g, " ").trim();
    return t ? t.slice(0, 120) : undefined;
  };

  const roleFor = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = el.type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    return undefined;
  };

  const cssPath = (el) => {
    const escaped = (v) =>
      (window.CSS && typeof window.CSS.escape === "function"
        ? window.CSS.escape(v)
        : v.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"));
    if (el.id) return "#" + escaped(el.id);
    const name = el.getAttribute("name");
    if (name) return '[name="' + escaped(name) + '"]';
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
    const index = siblings.indexOf(el) + 1;
    return el.tagName.toLowerCase() + ":nth-of-type(" + index + ")";
  };

  g.__manualMapState = { clicks: [] };
  document.addEventListener("click", (ev) => {
    const raw = ev.target;
    const target = raw && raw.closest ? raw.closest("button,a,input,select,textarea,[role],label") : null;
    if (!target) return;
    const labelId = target.getAttribute("aria-labelledby");
    const label = labelId ? text(document.getElementById(labelId)) : undefined;
    g.__manualMapState.clicks.push({
      timestamp: new Date().toISOString(),
      text: text(target),
      role: roleFor(target),
      css: cssPath(target),
      label
    });
    if (g.__manualMapState.clicks.length > 500) {
      g.__manualMapState.clicks.shift();
    }
  }, true);

  g.__manualMapInstalled = true;
})();
`);
}

async function pullClicks(page: Page): Promise<CaptureClick[]> {
  const clicks = await page.evaluate(`
(() => {
  const g = window;
  const clicks = (g.__manualMapState && g.__manualMapState.clicks) ? g.__manualMapState.clicks : [];
  g.__manualMapState = { clicks: [] };
  return clicks;
})()
`);
  return clicks as CaptureClick[];
}

async function collectControls(page: Page): Promise<{ modalTitles: string[]; controls: CaptureControl[] }> {
  const result = await page.evaluate(`
(() => {
  const text = (value) => {
    const t = (value || "").replace(/\\s+/g, " ").trim();
    return t || undefined;
  };

  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const escaped = (v) =>
    (window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(v)
      : v.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"));

  const cssFallback = (el) => {
    if (el.id) return "#" + escaped(el.id);
    const name = el.getAttribute("name");
    if (name) return '[name="' + escaped(name) + '"]';
    const parent = el.parentElement;
    if (!parent) return el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter((s) => s.tagName === el.tagName);
    const idx = siblings.indexOf(el) + 1;
    return el.tagName.toLowerCase() + ":nth-of-type(" + idx + ")";
  };

  const roleFor = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = el.type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "number") return "spinbutton";
      return "textbox";
    }
    return undefined;
  };

  const inferType = (tag, typeAttr, role) => {
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (typeAttr === "checkbox" || role === "checkbox") return "checkbox";
    if (typeAttr === "radio" || role === "radio") return "radio";
    if (typeAttr === "number" || role === "spinbutton") return "number";
    if (typeAttr === "button" || typeAttr === "submit" || tag === "button" || role === "button") return "button";
    if (role === "combobox") return "select";
    return "text";
  };

  const labelFor = (el) => {
    const ariaLabel = text(el.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = text(
        labelledBy
          .split(/\\s+/)
          .map((id) => (document.getElementById(id) ? document.getElementById(id).textContent : ""))
          .join(" ")
      );
      if (label) return label;
    }

    if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) && el.labels && el.labels[0]) {
      const nativeLabel = text(el.labels[0].textContent);
      if (nativeLabel) return nativeLabel;
    }

    const nearestLabel = text(el.closest("label") ? el.closest("label").textContent : "");
    if (nearestLabel) return nearestLabel;

    const legend = text(el.closest("fieldset") && el.closest("fieldset").querySelector("legend")
      ? el.closest("fieldset").querySelector("legend").textContent
      : "");
    if (legend) return legend;

    const container = el.closest("section,article,div");
    const heading = text(container && container.querySelector("h1,h2,h3,h4")
      ? container.querySelector("h1,h2,h3,h4").textContent
      : "");
    if (heading) return heading;

    return text(el.textContent);
  };

  const getSection = (el) => {
    const section = el.closest("section,article,fieldset,form,div");
    if (!section) return undefined;
    const titleEl = section.querySelector("h1,h2,h3,h4,legend,.xux-panel-title");
    return text(titleEl ? titleEl.textContent : "");
  };

  const roots = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .ui-dialog')).filter(isVisible);
  const scopeRoots = roots.length ? roots : [document.body];
  const modalTitles = roots
    .map((root) => {
      const titleEl = root.querySelector("h1,h2,h3,.xux-modalWindow-title-text,.ui-dialog-title");
      return text(titleEl ? titleEl.textContent : "");
    })
    .filter(Boolean);

  const controls = [];
  const seen = new Set();

  for (const root of scopeRoots) {
    const items = root.querySelectorAll('input:not([type="hidden"]),textarea,select,button,[role="button"],[role="checkbox"],[role="radio"],[role="combobox"],[role="spinbutton"],[contenteditable="true"]');
    for (const el of items) {
      if (!isVisible(el)) continue;
      const key = cssFallback(el);
      if (seen.has(key)) continue;
      seen.add(key);

      const tag = el.tagName.toLowerCase();
      const typeAttr = el.getAttribute("type");
      const role = roleFor(el);
      const inferredType = inferType(tag, typeAttr, role);
      const label = labelFor(el);

      const selectors = [];
      if (label) selectors.push({ kind: "label", value: label });
      if (role && label) selectors.push({ kind: "role", role, name: label });
      if (el.id) selectors.push({ kind: "css", value: "#" + escaped(el.id) });
      if (el.getAttribute("name")) selectors.push({ kind: "css", value: '[name="' + escaped(el.getAttribute("name")) + '"]' });
      if ((tag === "button" || role === "button") && label) selectors.push({ kind: "text", value: label });
      selectors.push({ kind: "css", value: cssFallback(el) });

      const control = {
        label,
        type: inferredType,
        selectors,
        section: getSection(el),
        modalTitle: modalTitles[0]
      };

      if (el instanceof HTMLInputElement) {
        if (inferredType === "checkbox" || inferredType === "radio") control.checked = el.checked;
        else control.value = el.value;
        control.min = el.min ? Number(el.min) : undefined;
        control.max = el.max ? Number(el.max) : undefined;
        control.pattern = text(el.pattern);
        control.required = el.required;
        control.readOnly = el.readOnly;
        control.disabled = el.disabled;
      } else if (el instanceof HTMLTextAreaElement) {
        control.value = el.value;
        control.required = el.required;
        control.readOnly = el.readOnly;
        control.disabled = el.disabled;
      } else if (el instanceof HTMLSelectElement) {
        control.value = el.value;
        control.options = Array.from(el.options).map((opt) => text(opt.textContent) || opt.value);
        control.required = el.required;
        control.disabled = el.disabled;
      } else {
        const isChecked = el.getAttribute("aria-checked");
        if (isChecked === "true" || isChecked === "false") control.checked = isChecked === "true";
        control.value = text(el.textContent);
        control.disabled = el.getAttribute("aria-disabled") === "true";
        if (role === "combobox") {
          const listId = el.getAttribute("aria-controls");
          const optionsRoot = listId ? document.getElementById(listId) : null;
          const optionNodes = (optionsRoot || document).querySelectorAll('[role="option"], option');
          const options = Array.from(optionNodes).map((opt) => text(opt.textContent)).filter(Boolean);
          if (options.length) control.options = options;
        }
      }

      controls.push(control);
    }
  }

  return { modalTitles, controls };
})()
`);
  return result as { modalTitles: string[]; controls: CaptureControl[] };
}

function buildMap(captures: CaptureRecord[]): UiMap {
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];
  const pageKeyToId = new Map<string, string>();
  const pageById = new Map<string, PageEntry>();
  const fieldByKey = new Map<string, FieldEntry>();
  const fieldIdSet = new Set<string>();

  const uniqueId = (base: string): string => {
    let id = slugify(base);
    let i = 2;
    while (fieldIdSet.has(id)) {
      id = `${slugify(base)}-${i}`;
      i += 1;
    }
    fieldIdSet.add(id);
    return id;
  };

  for (const capture of captures) {
    const modalSuffix = capture.modalTitles[0] ? ` :: ${capture.modalTitles[0]}` : "";
    const pageKey = `${capture.url}${modalSuffix}`;
    let pageId = pageKeyToId.get(pageKey);
    if (!pageId) {
      pageId = slugify(
        `${new URL(capture.url).pathname}-${new URL(capture.url).hash}-${capture.modalTitles[0] ?? "page"}`
      );
      let suffix = 2;
      while (pageById.has(pageId)) {
        pageId = `${pageId}-${suffix}`;
        suffix += 1;
      }
      pageKeyToId.set(pageKey, pageId);
      const navPath: PageEntry["navPath"] = [{ action: "goto", url: capture.url }];
      for (const click of capture.clicksSinceLastCapture) {
        if (click.css) {
          navPath.push({ action: "click", selector: { kind: "css", value: click.css } });
        } else if (click.role && click.text) {
          navPath.push({ action: "click", selector: { kind: "role", role: click.role, name: click.text } });
        } else if (click.text) {
          navPath.push({ action: "click", selector: { kind: "text", value: click.text } });
        }
      }
      const pageTitle = capture.modalTitles[0]
        ? `${capture.title} / ${capture.modalTitles[0]}`
        : capture.title;
      const page: PageEntry = { id: pageId, title: pageTitle, url: capture.url, navPath };
      pages.push(page);
      pageById.set(pageId, page);
    }

    for (const control of capture.controls) {
      const normalizedSelectors = uniqueBy(control.selectors, selectorKey).slice(0, 8);
      if (normalizedSelectors.length === 0) continue;

      const key = [
        pageId,
        control.type,
        (control.label ?? "").toLowerCase(),
        selectorKey(normalizedSelectors[0])
      ].join("|");

      let field = fieldByKey.get(key);
      if (!field) {
        const base = `${pageId}.${slugify(control.label ?? control.type)}`;
        field = {
          id: uniqueId(base),
          label: control.label,
          type: control.type,
          selectors: normalizedSelectors,
          pageId
        };
        fieldByKey.set(key, field);
        fields.push(field);
      } else {
        field.selectors = uniqueBy([...field.selectors, ...normalizedSelectors], selectorKey).slice(0, 10);
      }

      const constraints = field.constraints ?? {};
      if (typeof control.min === "number" && Number.isFinite(control.min)) {
        constraints.min = typeof constraints.min === "number" ? Math.min(constraints.min, control.min) : control.min;
      }
      if (typeof control.max === "number" && Number.isFinite(control.max)) {
        constraints.max = typeof constraints.max === "number" ? Math.max(constraints.max, control.max) : control.max;
      }
      if (control.pattern && !constraints.pattern) constraints.pattern = control.pattern;
      if (typeof control.readOnly === "boolean") {
        constraints.readOnly = constraints.readOnly === undefined ? control.readOnly : constraints.readOnly && control.readOnly;
      }
      if (control.options?.length) {
        const next = new Set<string>(constraints.enum ?? []);
        for (const option of control.options) {
          if (option) next.add(option);
        }
        constraints.enum = Array.from(next);
      }
      if (Object.keys(constraints).length > 0) {
        field.constraints = constraints;
      }
    }
  }

  return {
    meta: {
      generatedAt: nowStamp(),
      printerUrl: baseUrl,
      schemaVersion: "manual-1.0"
    },
    pages,
    fields
  };
}

async function loadExistingCaptures(): Promise<CaptureRecord[]> {
  try {
    const raw = await readFile(rawCapturePath, "utf8");
    const parsed = JSON.parse(raw) as { captures?: CaptureRecord[] } | CaptureRecord[];
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed.captures) ? parsed.captures : [];
  } catch {
    return [];
  }
}

async function writeOutputs(captures: CaptureRecord[]): Promise<void> {
  const map = buildMap(captures);
  await writeFile(rawCapturePath, JSON.stringify({ captures }, null, 2), "utf8");
  await writeFile(manualMapPath, JSON.stringify(map, null, 2), "utf8");
}

async function main(): Promise<void> {
  await mkdir(path.dirname(rawCapturePath), { recursive: true });
  await mkdir(path.dirname(manualMapPath), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const rl = readline.createInterface({ input, output });

  const captures = await loadExistingCaptures();

  try {
    await loginIfNeeded(page);
    await installClickLogger(page).catch((error) => {
      if (!isContextDestroyedError(error)) throw error;
    });

    output.write("\nManual click capture is ready.\n");
    output.write("Drive the UI in the browser. Each click auto-captures current fields/selectors.\n");
    output.write("Press ENTER here when done to write files.\n");

    let stopRequested = false;
    const stopPromise = rl
      .question("\nRecording... press ENTER to stop and write files.\n")
      .then(() => {
        stopRequested = true;
      })
      .catch(() => {
        stopRequested = true;
      });

    let sequence = captures.length + 1;
    while (!stopRequested) {
      try {
        await installClickLogger(page);
      } catch (error) {
        if (!isContextDestroyedError(error)) throw error;
        await page.waitForTimeout(300);
        continue;
      }

      let clicks: CaptureClick[] = [];
      try {
        clicks = await pullClicks(page);
      } catch (error) {
        if (!isContextDestroyedError(error)) throw error;
        await page.waitForTimeout(300);
        continue;
      }
      if (!clicks.length) {
        await page.waitForTimeout(250);
        continue;
      }

      for (const click of clicks) {
        if (stopRequested) break;
        await page.waitForTimeout(200);

        let modalTitles: string[] = [];
        let controls: CaptureControl[] = [];
        try {
          const snapshot = await collectControls(page);
          modalTitles = snapshot.modalTitles;
          controls = snapshot.controls;
        } catch (error) {
          if (!isContextDestroyedError(error)) throw error;
          continue;
        }
        const triggerText = click.label ?? click.text ?? click.css ?? click.role ?? "click";
        const capture: CaptureRecord = {
          id: `capture-${String(sequence).padStart(3, "0")}`,
          note: `trigger: ${triggerText}`,
          capturedAt: nowStamp(),
          url: page.url(),
          title: await page.title(),
          modalTitles,
          clicksSinceLastCapture: [click],
          controls
        };
        captures.push(capture);
        sequence += 1;

        output.write(
          `Captured ${capture.id}: ${controls.length} controls after ${triggerText} (${capture.url})\n`
        );

        // Persist incrementally so progress is not lost if navigation crashes the session.
        await writeOutputs(captures);
      }
    }

    await stopPromise;
    await writeOutputs(captures);
    const finalMap = buildMap(captures);

    output.write(
      `\nWrote ${captures.length} captures to ${rawCapturePath}\n` +
        `Wrote ${finalMap.pages.length} pages / ${finalMap.fields.length} fields to ${manualMapPath}\n`
    );
  } finally {
    rl.close();
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
