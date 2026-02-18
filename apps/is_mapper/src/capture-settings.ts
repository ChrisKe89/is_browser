import { chromium } from "playwright";
import * as dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isValuelessControl } from "./utils.js";

dotenv.config();

type Mode = "local" | "live";

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

interface PageCapture {
  source: string;
  title: string;
  url: string;
  settings: CapturedSetting[];
}

interface CaptureOutput {
  generatedAt: string;
  mode: Mode;
  pages: PageCapture[];
}

const LOCAL_PATHS = [
  "UI/home/login.html",
  "UI/home/home.html",
  "UI/permissions/permissions.html",
  "UI/network/network.html",
  "UI/network/network_ethernet.html",
  "UI/network/network_nfc.html",
  "UI/network/network_usb.html",
  "UI/network/network_protocols.html"
];

function parseMode(): Mode {
  const index = process.argv.indexOf("--mode");
  if (index === -1) return "local";
  const next = process.argv[index + 1];
  return next === "live" ? "live" : "local";
}

function buildLiveUrls(host: string): string[] {
  const pageUrls = process.env.PAGE_URLS?.trim();
  if (pageUrls) {
    return pageUrls
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
  }

  const base = host.startsWith("http") ? host : `http://${host}`;
  return [
    `${base}/home/login.html`,
    `${base}/home/home.html`,
    `${base}/permissions/permissions.html`,
    `${base}/network/network.html`,
    `${base}/network/network_ethernet.html`,
    `${base}/network/network_nfc.html`,
    `${base}/network/network_usb.html`,
    `${base}/network/network_protocols.html`
  ];
}

function buildLocalUrls(): string[] {
  return LOCAL_PATHS.map((p) => pathToFileURL(resolve(p)).href);
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

function mapType(setting: CapturedSetting): string {
  if (setting.kind === "select") return "combobox";
  if (setting.kind === "checkbox") return "checkbox";
  if (setting.kind === "radio") return "radio";
  if (setting.kind === "number") return "spinbutton";
  if (setting.kind === "staticTextButton") return "staticTextButton";
  if (setting.kind === "action") return "button_dialog";
  return "textbox";
}

function currentValue(setting: CapturedSetting): string | number | boolean | null {
  if (setting.kind === "checkbox" || setting.kind === "radio") {
    return Boolean(setting.checked);
  }

  if (setting.kind === "number") {
    const numeric = Number(setting.value);
    return Number.isFinite(numeric) ? numeric : setting.value as string | null;
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

function pageByPath(pages: PageCapture[], pathEnd: string): PageCapture | undefined {
  return pages.find((p) => new URL(p.url).pathname.endsWith(pathEnd));
}

function groupedSectionFields(settings: CapturedSetting[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const setting of settings) {
    const label = cleanText(setting.label);
    if (!label) continue;
    const key = slugify(label);

    const field: Record<string, unknown> = {
      type: mapType(setting),
      label,
      selector: roleSelector(setting)
    };

    const value = currentValue(setting);
    const source = valueSource(setting);
    field.value_source = source;
    if (!isValuelessControl(field.type as string) && value !== null && value !== "") {
      field.current_value = value;
    }
    if (setting.options && setting.options.length > 0) {
      field.options = setting.options.map((opt) => opt.text);
    }
    if (setting.context.startsWith("modal:")) {
      field.opens_dialog = true;
      field.dialog_title = setting.context.replace(/^modal:/, "");
    }
    if (setting.disabled) field.disabled = true;

    out[key] = field;
  }
  return out;
}

function buildDeterministicOutput(raw: CaptureOutput): Record<string, unknown> {
  const host = process.env.PRINTER_HOST ?? "192.168.0.107";
  const hostNoProto = host.replace(/^https?:\/\//, "");
  const baseHttp = `http://${hostNoProto}`;
  const baseHttps = `https://${hostNoProto}`;

  const loginPage = pageByPath(raw.pages, "/home/login.html");
  const permissionsPage = pageByPath(raw.pages, "/permissions/permissions.html");
  const networkUsbPage = pageByPath(raw.pages, "/network/network_usb.html");
  const networkNfcPage = pageByPath(raw.pages, "/network/network_nfc.html");
  const networkEthernetPage = pageByPath(raw.pages, "/network/network_ethernet.html");
  const networkProtocolsPage = pageByPath(raw.pages, "/network/network_protocols.html");

  const loginUser = loginPage?.settings.find((s) => s.id === "loginName");
  const loginPassword = loginPage?.settings.find((s) => s.id === "loginPsw");

  const permissionsMain = (permissionsPage?.settings ?? []).filter(
    (s) => s.context === "main" && s.section === "Authentication Settings"
  );
  const permissionsAuthAccounting = (permissionsPage?.settings ?? []).filter(
    (s) => s.context === "main" && s.section === "Authentication/Accounting Settings"
  );
  const advancedSettings = (permissionsPage?.settings ?? []).filter(
    (s) => s.context === "modal:Advanced Settings"
  );

  const usbModal = (networkUsbPage?.settings ?? []).filter((s) => s.context === "modal:USB");
  const nfcModal = (networkNfcPage?.settings ?? []).filter((s) => s.context === "modal:NFC");

  const deterministic: Record<string, unknown> = {
    printer: {
      model: null,
      base_url: baseHttp,
      https_url: baseHttps,
      ssl_bypass_required: true
    },
    login: {
      url: `${baseHttps}/wuilib/login.html`,
      fields: {
        user_id: {
          type: "textbox",
          label: loginUser?.label ?? "User ID",
          selector: loginUser ? roleSelector(loginUser) : "role=textbox[name='User ID']"
        },
        password: {
          type: "textbox",
          label: loginPassword?.label ?? "Password",
          selector: loginPassword ? roleSelector(loginPassword) : "role=textbox[name='Password']"
        }
      },
      actions: {
        submit: {
          type: "button",
          label: "Log In",
          selector: "#loginButton"
        }
      },
      post_login_dialogs: []
    },
    navigation: {
      top_menu: {
        type: "menubar",
        items: ["Home", "Apps", "Pins", "Address Book", "Jobs", "Network", "Permissions", "System"]
      },
      permissions_url: `${baseHttps}/permissions/index.html#hashPermissions`
    },
    permissions_page: {
      url: `${baseHttps}/permissions/index.html#hashPermissions`,
      title: permissionsPage?.title ?? "Authentication and Accounting",
      sections: {
        authentication_and_accounting: {
          title: permissionsPage?.title ?? "Authentication and Accounting",
          subsections: {
            authentication_accounting_settings: {
              title: "Authentication/Accounting Settings",
              fields: groupedSectionFields(permissionsAuthAccounting)
            },
            authentication_settings: {
              title: "Authentication Settings",
              fields: groupedSectionFields(permissionsMain),
              advanced_settings: {
                type: "button_dialog",
                label: "Advanced Settings",
                opens_dialog: true,
                dialog_title: "Advanced Settings",
                dialog_fields: groupedSectionFields(advancedSettings)
              }
            }
          }
        }
      }
    },
    network_pages: {
      ethernet: {
        url: `${baseHttps}/network/index.html#hashNetwork/hashConnectivity`,
        title: networkEthernetPage?.title ?? "Ethernet",
        fields: groupedSectionFields(networkEthernetPage?.settings ?? [])
      },
      nfc: {
        title: "NFC",
        fields: groupedSectionFields(nfcModal)
      },
      usb: {
        title: "USB",
        fields: groupedSectionFields(usbModal)
      },
      protocols: {
        title: networkProtocolsPage?.title ?? "Protocols",
        fields: groupedSectionFields(networkProtocolsPage?.settings ?? [])
      }
    },
    settings_index: raw.pages.map((page) => ({
      url: page.url,
      title: page.title,
      settings: page.settings.map((setting) => {
        const type = mapType(setting);
        const source = valueSource(setting);
        const projectedValue = currentValue(setting);
        const out: Record<string, unknown> = {
          order: setting.order,
          key: setting.id ?? slugify(setting.label ?? setting.selector),
          type,
          label: setting.label,
          section: setting.section,
          context: setting.context,
          dependency: setting.dependency,
          selector: roleSelector(setting),
          dom_selector: setting.selector,
          checked: setting.checked,
          visible: setting.visible,
          disabled: setting.disabled,
          value_source: source
        };
        if (!isValuelessControl(type) && projectedValue !== null && projectedValue !== "") {
          out.current_value = projectedValue;
        }
        if (setting.options?.length) {
          out.options = setting.options.map((o) => o.text);
        }
        return out;
      })
    })),
    _metadata: {
      mode: raw.mode,
      generated_at: raw.generatedAt,
      deterministic_rules: [
        "Pages are processed in a fixed URL order.",
        "Settings are emitted in DOM order captured by compareDocumentPosition.",
        "Keys are slugified from stable labels/ids.",
        "Role selectors are derived from control type + label."
      ]
    }
  };

  return deterministic;
}

async function maybeLoginLive(page: import("playwright").Page, loginUrl: string): Promise<void> {
  const username = process.env.PRINTER_USERNAME ?? "";
  const password = process.env.PRINTER_PASSWORD ?? "";

  if (!username || !password) return;

  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(800);

  const user = page.locator("#loginName");
  const pass = page.locator("#loginPsw");
  if ((await user.count()) === 0 || (await pass.count()) === 0) return;

  await user.fill(username);
  await pass.fill(password);

  const loginButton = page.locator("#loginButton");
  if ((await loginButton.count()) > 0) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => undefined),
      loginButton.click({ timeout: 5000 })
    ]);
    await page.waitForTimeout(1200);
  }
}

async function capturePage(page: import("playwright").Page, url: string): Promise<PageCapture> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);

  const extractorCode = readFileSync(resolve("src/extract-settings.js"), "utf-8");
  const extracted = await page.evaluate((code) => {
    const fn = new Function(code);
    return fn();
  }, extractorCode);

  return {
    source: new URL(url).protocol === "file:" ? "local-html" : "live-printer",
    title: extracted.title,
    url,
    settings: extracted.settings as CapturedSetting[]
  };
}

async function main(): Promise<void> {
  const mode = parseMode();
  const headless = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const urls = mode === "local" ? buildLocalUrls() : buildLiveUrls(process.env.PRINTER_HOST ?? "192.168.0.107");

  if (mode === "live") {
    await maybeLoginLive(page, urls[0]);
  }

  const pages: PageCapture[] = [];
  for (const url of urls) {
    try {
      const pageCapture = await capturePage(page, url);
      pages.push(pageCapture);
      console.log(`Captured ${pageCapture.settings.length.toString().padStart(3, " ")} settings from ${url}`);
    } catch (error) {
      console.error(`Failed to capture ${url}:`, error);
    }
  }

  await browser.close();

  if (!existsSync("output")) {
    mkdirSync("output", { recursive: true });
  }

  const rawOut: CaptureOutput = {
    generatedAt: new Date().toISOString(),
    mode,
    pages
  };

  const rawPath = resolve("output", `settings-capture-${mode}.json`);
  writeFileSync(rawPath, JSON.stringify(rawOut, null, 2), "utf-8");

  const deterministicOut = buildDeterministicOutput(rawOut);
  const deterministicPath = resolve("output", `settings-deterministic-${mode}.json`);
  writeFileSync(deterministicPath, JSON.stringify(deterministicOut, null, 2), "utf-8");

  console.log(`Wrote ${rawPath}`);
  console.log(`Wrote ${deterministicPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
