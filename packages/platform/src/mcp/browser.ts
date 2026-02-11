import { chromium, type Browser, type Page } from "playwright";
import { AUTH_STATE_PATH, HEADLESS, NAV_TIMEOUT_MS, USE_AUTH_STATE } from "../env.js";
import { existsSync } from "node:fs";

export async function openBrowser(options?: { headless?: boolean }): Promise<Browser> {
  return chromium.launch({
    headless: options?.headless ?? HEADLESS,
    args: ["--ignore-certificate-errors"]
  });
}

export async function newPage(
  browser: Browser,
  options?: { storageStatePath?: string }
): Promise<Page> {
  const storageStatePath = options?.storageStatePath ?? AUTH_STATE_PATH;
  const useStorage = USE_AUTH_STATE && storageStatePath && existsSync(storageStatePath);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    storageState: useStorage ? storageStatePath : undefined
  });
  context.setDefaultTimeout(NAV_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  return context.newPage();
}

