import { chromium, type BrowserContext, type Page } from "playwright";
import * as dotenv from "dotenv";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { autoLoginToPrinter, dismissSecurityWarnings } from "./login.js";
import { isValuelessControl } from "./utils.js";

dotenv.config();

type SettingKind =
  | "text"
  | "password"
  | "number"
  | "checkbox"
  | "radio"
  | "select"
  | "textarea"
  | "staticTextButton"
  | "action";

interface SelectOption {
  value: string;
  text: string;
  selected: boolean;
}

interface CapturedSetting {
  order: number;
  kind: SettingKind;
  id: string | null;
  name: string | null;
  label: string | null;
  section: string | null;
  context: string;
  dependency: string | null;
  selector: string;
  cssPath: string;
  value: string | boolean | null;
  checked: boolean | null;
  options?: SelectOption[];
  disabled: boolean;
  visible: boolean;
}

interface CapturedPage {
  source: "manual-live";
  title: string;
  url: string;
  settings: CapturedSetting[];
}

interface EventEntry {
  seq: number;
  at: string;
  reason: string;
  page_url: string;
  page_title: string;
  new_settings: number;
  changed_settings: number;
  total_discovered_on_page: number;
}

interface StoredSetting extends CapturedSetting {
  first_seen_event: number;
  last_seen_event: number;
  ever_visible: boolean;
}

interface PageState {
  url: string;
  title: string;
  byKey: Map<string, StoredSetting>;
}

interface ManualCaptureOutput {
  generatedAt: string;
  mode: "manual-live";
  startUrl: string;
  pages: CapturedPage[];
  events: EventEntry[];
}

const userDataDir = resolve(".pw-manual-profile");

function formatRunDirectoryName(date: Date): string {
  const yyyy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  const hh = date.getHours().toString().padStart(2, "0");
  const mi = date.getMinutes().toString().padStart(2, "0");
  const ss = date.getSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function normalizeStartUrl(): string {
  const host = process.env.PRINTER_HOST ?? "192.168.0.107";
  const raw = `https://${host.replace(/^https?:\/\//, "")}`;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
}

function settingKey(setting: CapturedSetting): string {
  return [
    setting.context,
    setting.id ?? "",
    setting.name ?? "",
    setting.label ?? "",
    setting.selector
  ].join("|");
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapType(setting: CapturedSetting): string {
  if (setting.kind === "select") return "combobox";
  if (setting.kind === "checkbox") return "checkbox";
  if (setting.kind === "radio") return "radio";
  if (setting.kind === "number") return "spinbutton";
  if (setting.kind === "staticTextButton") return "staticTextButton";
  if (setting.kind === "action") return "button_dialog";
  return "textbox";
}

function roleSelector(setting: CapturedSetting): string {
  const label = cleanText(setting.label);
  if (!label) return setting.selector;

  if (setting.kind === "select") return `role=combobox[name='${label}']`;
  if (setting.kind === "checkbox") return `role=checkbox[name='${label}']`;
  if (setting.kind === "radio") return `role=radio[name='${label}']`;
  if (setting.kind === "number") return `role=spinbutton[name='${label}']`;
  if (setting.kind === "action") return `role=button[name='${label}']`;
  return `role=textbox[name='${label}']`;
}

function currentValue(setting: CapturedSetting): string | number | boolean | null {
  if (setting.kind === "checkbox" || setting.kind === "radio") {
    return Boolean(setting.checked);
  }
  if (setting.kind === "number") {
    const numeric = Number(setting.value);
    return Number.isFinite(numeric) ? numeric : (setting.value as string | null);
  }
  if (setting.kind === "select") {
    const selected = setting.options?.find((opt) => opt.selected)?.text;
    if (selected) return selected;
  }
  return setting.value as string | null;
}

function valueSource(setting: CapturedSetting): "none" | "text" | "inputValue" | "checked" | "select" | "aria" {
  const controlType = mapType(setting);
  if (isValuelessControl(controlType)) return "none";
  if (setting.kind === "select") return "select";
  if (setting.kind === "checkbox" || setting.kind === "radio") return "checked";
  if (setting.kind === "staticTextButton") return "text";
  return "inputValue";
}

function buildDeterministic(raw: ManualCaptureOutput): Record<string, unknown> {
  const host = (process.env.PRINTER_HOST ?? "192.168.0.107").replace(/^https?:\/\//, "");

  return {
    printer: {
      model: null,
      base_url: `http://${host}`,
      https_url: `https://${host}`,
      ssl_bypass_required: true
    },
    crawl: {
      mode: "manual",
      start_url: raw.startUrl,
      event_count: raw.events.length
    },
    pages: raw.pages.map((page) => ({
      url: page.url,
      title: page.title,
      settings: page.settings.map((setting) => ({
        ...(() => {
          const type = mapType(setting);
          const projectedValue = currentValue(setting);
          const source = valueSource(setting);
          const base: Record<string, unknown> = {
            order: setting.order,
            key: setting.id ?? slugify(setting.label ?? setting.selector),
            type,
            label: setting.label,
            section: setting.section,
            context: setting.context,
            dependency: setting.dependency,
            selector: roleSelector(setting),
            dom_selector: setting.selector,
            visible: setting.visible,
            disabled: setting.disabled,
            value_source: source
          };
          if (!isValuelessControl(type) && projectedValue !== null && projectedValue !== "") {
            base.current_value = projectedValue;
          }
          if (setting.options?.length) {
            base.options = setting.options.map((o) => o.text);
          }
          return base;
        })()
      }))
    })),
    _metadata: {
      generated_at: raw.generatedAt,
      deterministic_rules: [
        "Event sequence is monotonic.",
        "Discovery key is context+id+name+label+selector.",
        "Within page, output order is first discovery order.",
        "Role selectors are derived from type + label when available."
      ]
    }
  };
}

async function capturePage(page: Page): Promise<CapturedPage> {
  const extractorCode = readFileSync(resolve("src/extract-settings.js"), "utf-8");
  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const extracted = await page.evaluate((code) => {
        const fn = new Function(code);
        return fn();
      }, extractorCode);

      return {
        source: "manual-live",
        title: extracted.title,
        url: page.url(),
        settings: extracted.settings as CapturedSetting[]
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient =
        message.includes("Execution context was destroyed") ||
        message.includes("Cannot find context with specified id") ||
        message.includes("Frame was detached") ||
        message.includes("Target page, context or browser has been closed");

      if (!transient || page.isClosed() || attempt === 4) {
        throw error;
      }

      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("capture failed");
}

async function launchContext(): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      ignoreHTTPSErrors: true
    });
  } catch {
    return chromium.launchPersistentContext(userDataDir, {
      headless: false,
      ignoreHTTPSErrors: true
    });
  }
}

async function main(): Promise<void> {
  if (!existsSync("output")) mkdirSync("output", { recursive: true });
  const runDir = resolve("output", formatRunDirectoryName(new Date()));
  mkdirSync(runDir, { recursive: true });
  const outputRawPath = resolve(runDir, "settings-capture-manual-live.json");
  const outputDeterministicPath = resolve(runDir, "settings-deterministic-manual-live.json");

  const startUrl = normalizeStartUrl();
  const context = await launchContext();

  const pageStates = new Map<string, PageState>();
  const events: EventEntry[] = [];
  let seq = 0;

  const pendingByPage = new Map<Page, NodeJS.Timeout>();
  const processingByPage = new Map<Page, Promise<void>>();
  const hookInstalledByPage = new WeakSet<Page>();
  const lastQueuedAtByPageReason = new Map<string, number>();
  const postClickTimersByPage = new Map<Page, NodeJS.Timeout[]>();

  const writeOutputs = () => {
    const pages: CapturedPage[] = Array.from(pageStates.values())
      .sort((a, b) => a.url.localeCompare(b.url))
      .map((state) => {
        const settings = Array.from(state.byKey.values())
          .sort((a, b) => a.first_seen_event - b.first_seen_event)
          .map(({ first_seen_event: _first, last_seen_event: _last, ever_visible: _ev, ...rest }) => rest);

        const withOrder = settings.map((setting, idx) => ({ ...setting, order: idx + 1 }));
        return {
          source: "manual-live",
          title: state.title,
          url: state.url,
          settings: withOrder
        } satisfies CapturedPage;
      });

    const raw: ManualCaptureOutput = {
      generatedAt: new Date().toISOString(),
      mode: "manual-live",
      startUrl,
      pages,
      events
    };

    writeFileSync(outputRawPath, JSON.stringify(raw, null, 2), "utf-8");
    writeFileSync(outputDeterministicPath, JSON.stringify(buildDeterministic(raw), null, 2), "utf-8");
  };

  const captureAndMerge = async (page: Page, reason: string): Promise<void> => {
    if (page.isClosed()) return;
    const result = await capturePage(page);

    const existing = pageStates.get(result.url) ?? {
      url: result.url,
      title: result.title,
      byKey: new Map<string, StoredSetting>()
    };

    existing.title = result.title;
    let newCount = 0;
    let changedCount = 0;

    for (const setting of result.settings) {
      const key = settingKey(setting);
      const found = existing.byKey.get(key);
      if (!found) {
        newCount += 1;
        existing.byKey.set(key, {
          ...setting,
          first_seen_event: seq + 1,
          last_seen_event: seq + 1,
          ever_visible: setting.visible
        });
        continue;
      }

      const previousComparable = JSON.stringify({
        kind: found.kind,
        id: found.id,
        name: found.name,
        label: found.label,
        section: found.section,
        context: found.context,
        dependency: found.dependency,
        selector: found.selector,
        cssPath: found.cssPath,
        value: found.value,
        checked: found.checked,
        options: found.options,
        disabled: found.disabled,
        visible: found.visible
      });
      const nextComparable = JSON.stringify({
        kind: setting.kind,
        id: setting.id,
        name: setting.name,
        label: setting.label,
        section: setting.section,
        context: setting.context,
        dependency: setting.dependency,
        selector: setting.selector,
        cssPath: setting.cssPath,
        value: setting.value,
        checked: setting.checked,
        options: setting.options,
        disabled: setting.disabled,
        visible: setting.visible
      });
      if (previousComparable !== nextComparable) changedCount += 1;

      existing.byKey.set(key, {
        ...setting,
        first_seen_event: found.first_seen_event,
        last_seen_event: seq + 1,
        ever_visible: found.ever_visible || setting.visible
      });
    }

    pageStates.set(existing.url, existing);

    seq += 1;
    events.push({
      seq,
      at: new Date().toISOString(),
      reason,
      page_url: existing.url,
      page_title: existing.title,
      new_settings: newCount,
      changed_settings: changedCount,
      total_discovered_on_page: existing.byKey.size
    });

    writeOutputs();
    console.log(
      `[${seq}] ${reason} | ${existing.url} | +${newCount} new | ~${changedCount} changed | total=${existing.byKey.size}`
    );
  };

  const queueCapture = (page: Page, reason: string) => {
    if (page.isClosed()) return;
    const priorTask = processingByPage.get(page) ?? Promise.resolve();
    const nextTask = priorTask
      .catch(() => undefined)
      .then(() => captureAndMerge(page, reason))
      .catch((err) => console.error(`capture failed (${reason}):`, err));
    processingByPage.set(page, nextTask);
  };

  const scheduleCaptureDebounced = (page: Page, reason: string, debounceMs = 350) => {
    if (page.isClosed()) return;
    const key = `${page.url()}|${reason}`;
    const now = Date.now();
    const last = lastQueuedAtByPageReason.get(key) ?? 0;
    if (now - last < debounceMs) return;
    lastQueuedAtByPageReason.set(key, now);

    const prior = pendingByPage.get(page);
    if (prior) clearTimeout(prior);
    pendingByPage.set(
      page,
      setTimeout(() => {
        pendingByPage.delete(page);
        queueCapture(page, reason);
      }, debounceMs)
    );
  };

  const installHooksNow = async (page: Page): Promise<void> => {
    if (page.isClosed()) return;
    await page
      .evaluate(() => {
        const w = window as unknown as {
          __codexCaptureEvent?: (reason: string) => void;
          __codexCaptureInit?: boolean;
        };
        if (w.__codexCaptureInit) return;
        w.__codexCaptureInit = true;

        let timer: number | undefined;
        const emit = (reason: string) => {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            try {
              w.__codexCaptureEvent?.(reason);
            } catch {
              // no-op
            }
          }, 220);
        };

        document.addEventListener("click", () => {
          try {
            w.__codexCaptureEvent?.("click");
          } catch {
            // no-op
          }
          emit("click-followup");
        }, true);
        document.addEventListener("change", () => {
          try {
            w.__codexCaptureEvent?.("change");
          } catch {
            // no-op
          }
          emit("change-followup");
        }, true);
        document.addEventListener("input", () => {
          try {
            w.__codexCaptureEvent?.("input");
          } catch {
            // no-op
          }
        }, true);
        window.addEventListener("hashchange", () => emit("hashchange"));
        window.addEventListener("popstate", () => emit("popstate"));
        window.addEventListener("load", () => emit("load"));

        const observer = new MutationObserver(() => emit("mutation"));
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
      })
      .catch(() => undefined);
  };

  const attachPage = async (page: Page) => {
    try {
    await page.exposeBinding("__codexCaptureEvent", async (_source, reason: string) => {
        if (reason === "click" || reason === "change" || reason === "input") {
          queueCapture(page, `ui:${reason}`);
          const existingTimers = postClickTimersByPage.get(page) ?? [];
          for (const timer of existingTimers) clearTimeout(timer);
          const t1 = setTimeout(() => queueCapture(page, `ui:${reason}:post400ms`), 400);
          const t2 = setTimeout(() => queueCapture(page, `ui:${reason}:post1200ms`), 1200);
          postClickTimersByPage.set(page, [t1, t2]);
          return;
        }
        scheduleCaptureDebounced(page, `ui:${reason}`);
      });
    } catch {
      // Binding may already exist on this page.
    }

    await page.addInitScript(() => {
      const w = window as unknown as { __codexCaptureEvent?: (reason: string) => void; __codexCaptureInit?: boolean };
      if (w.__codexCaptureInit) return;
      w.__codexCaptureInit = true;

      let timer: number | undefined;
      const emit = (reason: string) => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          try {
            w.__codexCaptureEvent?.(reason);
          } catch {
            // no-op
          }
        }, 220);
      };

      document.addEventListener("click", () => emit("click"), true);
      document.addEventListener("change", () => emit("change"), true);
      window.addEventListener("hashchange", () => emit("hashchange"));
      window.addEventListener("popstate", () => emit("popstate"));
      window.addEventListener("load", () => emit("load"));

      const observer = new MutationObserver(() => emit("mutation"));
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
      });
    });

    if (!hookInstalledByPage.has(page)) {
      hookInstalledByPage.add(page);
      await installHooksNow(page);
    }

    page.on("domcontentloaded", () => scheduleCaptureDebounced(page, "domcontentloaded"));
    page.on("load", () => scheduleCaptureDebounced(page, "load"));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) scheduleCaptureDebounced(page, "navigate");
    });
    page.on("popup", (popup) => {
      void attachPage(popup);
    });
    page.on("close", () => {
      pendingByPage.delete(page);
      processingByPage.delete(page);
      const timers = postClickTimersByPage.get(page) ?? [];
      for (const timer of timers) clearTimeout(timer);
      postClickTimersByPage.delete(page);
    });

    queueCapture(page, "attached");
  };

  context.on("page", (p) => {
    void attachPage(p);
  });

  const initialPage = context.pages()[0] ?? (await context.newPage());
  await attachPage(initialPage);

  await initialPage.goto(startUrl, { waitUntil: "domcontentloaded" });
  queueCapture(initialPage, "initial-load");

  const username = process.env.PRINTER_USERNAME ?? "";
  const password = process.env.PRINTER_PASSWORD ?? "";
  const host = process.env.PRINTER_HOST ?? "";
  if (username && password) {
    const login = await autoLoginToPrinter(initialPage, { username, password, host });
    console.log(`Auto-login: ${login.reason}`);
    queueCapture(initialPage, "auto-login");

    // Sweep warnings that may appear a little after login/redirect.
    let sweepCount = 0;
    const warningSweep = setInterval(() => {
      if (initialPage.isClosed() || sweepCount >= 10) {
        clearInterval(warningSweep);
        return;
      }
      sweepCount += 1;
      void dismissSecurityWarnings(initialPage, 1200).catch(() => undefined);
    }, 1200);
  } else {
    console.log("Auto-login skipped: PRINTER_USERNAME/PRINTER_PASSWORD not set.");
  }

  const pollHandle = setInterval(() => {
    for (const p of context.pages()) {
      if (!p.isClosed()) scheduleCaptureDebounced(p, "poll", 900);
    }
  }, 900);

  console.log("Manual crawl running.");
  console.log(`Start URL: ${startUrl}`);
  console.log("Use the opened browser window to click through screens.");
  console.log("Each interaction auto-captures and updates output JSON files.");
  console.log("Press ENTER here when finished.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolvePrompt) => {
    rl.question("", () => resolvePrompt());
  });
  rl.close();

  for (const p of context.pages()) {
    await captureAndMerge(p, "final").catch((err) => {
      console.error("final capture failed:", err);
    });
  }
  clearInterval(pollHandle);

  await context.close();

  console.log(`Wrote ${outputRawPath}`);
  console.log(`Wrote ${outputDeterministicPath}`);

  const tsxCliPath = resolve("node_modules", "tsx", "dist", "cli.mjs");
  const useDirectTsx = existsSync(tsxCliPath);
  const yamlResult = useDirectTsx
    ? spawnSync(
        process.execPath,
        [tsxCliPath, "src/generate-ui-tree-yaml.ts", "--dir", runDir],
        {
          stdio: "inherit",
          shell: false
        }
      )
    : spawnSync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["tsx", "src/generate-ui-tree-yaml.ts", "--dir", runDir],
        {
          stdio: "inherit",
          shell: false
        }
      );

  if (yamlResult.status !== 0 || yamlResult.error) {
    const details = [
      `status=${yamlResult.status ?? "null"}`,
      `signal=${yamlResult.signal ?? "null"}`,
      `error=${yamlResult.error ? String(yamlResult.error) : "null"}`
    ].join(", ");
    console.error(`YAML generation failed for ${runDir} (${details})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
