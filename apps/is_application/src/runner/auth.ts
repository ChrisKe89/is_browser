import { PRINTER_PASS, PRINTER_USER } from "@is-browser/env";
import { autoLoginToPrinter } from "../../../is_mapper/src/login.js";
import type { Page } from "playwright";

const LOGIN_FIELD_SELECTORS = [
  "#loginName",
  "#loginPsw",
  "input[name='NAME']",
  "input[name='PSW']",
];

export async function isLoginPage(page: Page): Promise<boolean> {
  for (const selector of LOGIN_FIELD_SELECTORS) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    if (await locator.isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

export async function login(page: Page, host?: string): Promise<void> {
  if (!PRINTER_USER || !PRINTER_PASS) {
    throw new Error("Missing PRINTER_USER or PRINTER_PASS in environment.");
  }

  const result = await autoLoginToPrinter(page, {
    username: PRINTER_USER,
    password: PRINTER_PASS,
    host,
  });

  if (!result.submitted) {
    throw new Error(`Login failed: ${result.reason}`);
  }
}
