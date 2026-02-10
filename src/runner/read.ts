import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRINTER_URL } from "../config/env.js";
import { openBrowser, newPage } from "../mcp/browser.js";
import { readMap } from "../schema/io.js";
import { type FieldEntry, type UiMap } from "../schema/types.js";
import { isLoginPage, login } from "../crawler/login.js";
import { executePageNavigation, resolveLocatorByPriority } from "./engine.js";
import { readSettings, type SettingsFile } from "./settings.js";

type TemplateSetting = {
  id?: string;
  label?: string;
  value: unknown;
};

function buildDeviceUrl(ipOrHost: string): string {
  const protocol = PRINTER_URL.startsWith("https") ? "https" : "http";
  return `${protocol}://${ipOrHost}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function deriveOutputPath(templatePath: string): string {
  const normalized = templatePath.replace(/\\/g, "/");
  if (normalized.endsWith(".json.lock")) {
    return normalized.replace(/\.json\.lock$/, ".read.json");
  }
  if (normalized.endsWith(".json")) {
    return normalized.replace(/\.json$/, ".read.json");
  }
  return `${normalized}.read.json`;
}

function resolveMapPath(template: SettingsFile): string {
  const sourceMap = template.meta && "sourceMap" in template.meta
    ? String((template.meta as Record<string, unknown>).sourceMap ?? "")
    : "";
  if (sourceMap.trim()) {
    return sourceMap.trim();
  }
  return process.env.MAP_PATH ?? "state/printer-ui-map.json";
}

async function findField(
  map: UiMap,
  setting: TemplateSetting
): Promise<FieldEntry | undefined> {
  if (setting.id) {
    const exact = map.fields.find((field) => field.id === setting.id);
    if (exact) return exact;
  }
  if (setting.label) {
    const normalized = setting.label.toLowerCase();
    return map.fields.find((field) => (field.label ?? "").toLowerCase() === normalized);
  }
  return undefined;
}

async function readCheckboxOrRadio(locator: import("playwright").Locator): Promise<string> {
  const checked = await locator.isChecked().catch(() => null);
  if (typeof checked === "boolean") {
    return checked ? "On" : "Off";
  }
  const aria = await locator.getAttribute("aria-checked").catch(() => null);
  if (aria === "true") return "On";
  if (aria === "false") return "Off";
  return "";
}

async function readSelect(locator: import("playwright").Locator): Promise<string> {
  const selectedValue = await locator
    .evaluate((element) => {
      if (element instanceof HTMLSelectElement) {
        const option = element.selectedOptions.item(0);
        if (!option) return "";
        return option.value || option.textContent?.trim() || "";
      }
      return "";
    })
    .catch(() => "");
  if (selectedValue) return selectedValue;

  const valueFromInput = await locator.inputValue().catch(() => "");
  if (valueFromInput) return valueFromInput;

  return "";
}

async function readTextLike(locator: import("playwright").Locator): Promise<string> {
  const valueFromInput = await locator.inputValue().catch(() => "");
  if (valueFromInput) return valueFromInput;

  const valueAttr = await locator.getAttribute("value").catch(() => "");
  if (valueAttr) return valueAttr;

  const innerText = await locator.innerText().catch(() => "");
  return innerText.trim();
}

async function readFieldValue(
  page: import("playwright").Page,
  field: FieldEntry
): Promise<string> {
  const resolved = await resolveLocatorByPriority(
    page,
    field.selectors,
    `read setting "${field.id}" on page "${field.pageId}"`
  );

  switch (field.type) {
    case "checkbox":
    case "radio":
      return readCheckboxOrRadio(resolved.locator);
    case "select":
      return readSelect(resolved.locator);
    case "text":
    case "textarea":
    case "number":
      return readTextLike(resolved.locator);
    default:
      return readTextLike(resolved.locator);
  }
}

async function run(): Promise<void> {
  const templatePath = process.argv[2] ?? process.env.SETTINGS_PATH ?? "examples/settings.manual-clicks.blank.json";
  const outputPath = process.argv[3] ?? process.env.READ_OUTPUT_PATH ?? deriveOutputPath(templatePath);
  const deviceHost = process.env.PRINTER_IP ?? new URL(PRINTER_URL).hostname;

  const template = await readSettings(templatePath);
  const mapPath = resolveMapPath(template);
  const map = await readMap(mapPath);
  const settings = template.settings ?? [];
  await mkdir(path.dirname(outputPath), { recursive: true });

  const readResult: SettingsFile & { meta: Record<string, unknown> } = {
    ...template,
    meta: {
      ...(template.meta ?? {}),
      readAt: new Date().toISOString(),
      sourceTemplate: templatePath,
      sourceMap: mapPath,
      sourceDevice: deviceHost
    },
    settings: settings.map((setting) => ({
      id: setting.id,
      label: setting.label,
      value: ""
    }))
  };

  const unmatchedSettings: Array<{ id?: string; label?: string }> = [];
  const readErrors: Array<{ id?: string; label?: string; error: string }> = [];

  const byPage = new Map<
    string,
    Array<{ index: number; setting: TemplateSetting; field: FieldEntry }>
  >();

  for (let index = 0; index < settings.length; index += 1) {
    const setting = settings[index];
    const field = await findField(map, setting);
    if (!field) {
      unmatchedSettings.push({ id: setting.id, label: setting.label });
      continue;
    }
    const list = byPage.get(field.pageId) ?? [];
    list.push({ index, setting, field });
    byPage.set(field.pageId, list);
  }

  const baseUrl = buildDeviceUrl(deviceHost);
  const browser = await openBrowser({ headless: template.options?.headless });
  const page = await newPage(browser);
  const pageEntries = Array.from(byPage.entries());
  console.log(`[read] Settings: ${settings.length} across ${pageEntries.length} pages`);
  let pagesCompleted = 0;

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (await isLoginPage(page)) {
      await login(page);
    }

    for (const [pageId, items] of pageEntries) {
      console.log(`[read] Page ${pagesCompleted + 1}/${pageEntries.length}: ${pageId} (${items.length} fields)`);
      const pageEntry = map.pages.find((entry) => entry.id === pageId);
      if (!pageEntry) {
        for (const item of items) {
          readErrors.push({
            id: item.setting.id,
            label: item.setting.label,
            error: `Missing page entry for ${pageId}`
          });
        }
        pagesCompleted += 1;
        continue;
      }

      try {
        await executePageNavigation(page, pageEntry, baseUrl);
      } catch (error) {
        const message = toErrorMessage(error);
        for (const item of items) {
          readErrors.push({
            id: item.setting.id,
            label: item.setting.label,
            error: `Navigation failed for page "${pageId}": ${message}`
          });
        }
        pagesCompleted += 1;
        continue;
      }

      for (const item of items) {
        try {
          const value = await readFieldValue(page, item.field);
          readResult.settings[item.index].value = value;
        } catch (error) {
          readErrors.push({
            id: item.setting.id,
            label: item.setting.label,
            error: toErrorMessage(error)
          });
        }
      }
      pagesCompleted += 1;
      readResult.meta.pagesCompleted = pagesCompleted;
      if (pagesCompleted % 10 === 0 || pagesCompleted === pageEntries.length) {
        await writeFile(outputPath, JSON.stringify(readResult, null, 2), "utf8");
      }
    }
  } finally {
    await browser.close();
  }

  readResult.meta.unmatchedCount = unmatchedSettings.length;
  readResult.meta.readErrorCount = readErrors.length;
  readResult.meta.totalSettings = settings.length;
  readResult.meta.pagesCompleted = pagesCompleted;
  readResult.meta.totalPages = pageEntries.length;
  if (unmatchedSettings.length > 0) {
    readResult.meta.unmatchedSettings = unmatchedSettings;
  }
  if (readErrors.length > 0) {
    readResult.meta.readErrors = readErrors;
  }

  await writeFile(outputPath, JSON.stringify(readResult, null, 2), "utf8");

  console.log(`Read complete. Output: ${outputPath}`);
  console.log(
    `Total: ${settings.length} | Unmatched: ${unmatchedSettings.length} | ReadErrors: ${readErrors.length}`
  );
}

run().catch((error) => {
  console.error(`Read failed: ${toErrorMessage(error)}`);
  process.exit(1);
});
