import type { Page } from "playwright";

export interface LoginOptions {
  username: string;
  password: string;
  host?: string;
  timeoutMs?: number;
}

export interface LoginResult {
  attempted: boolean;
  submitted: boolean;
  reason: string;
}

function normalizeHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed.replace(/\/+$/, "");
  return `https://${trimmed}`.replace(/\/+$/, "");
}

async function firstVisible(locators: Array<ReturnType<Page["locator"]>>): Promise<ReturnType<Page["locator"]> | null> {
  for (const loc of locators) {
    if ((await loc.count()) === 0) continue;
    if (await loc.first().isVisible().catch(() => false)) return loc.first();
  }
  return null;
}

async function openLoginEntryPoint(page: Page, host: string): Promise<void> {
  const base = normalizeHost(host);
  const candidates = [
    `${base}/wuilib/login.html`,
    `${base}/home/login.html`,
    `${base}/home/index.html`
  ];

  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
      await page.waitForTimeout(350);
      return;
    } catch {
      // Try next URL.
    }
  }
}

async function openLoginModalIfNeeded(page: Page): Promise<void> {
  const triggers = [
    page.locator("#xux-profileMenuItem"),
    page.getByRole("button", { name: "Log In", exact: true }),
    page.getByText("Log In", { exact: true }),
    page.locator("a:has-text('Log In')"),
    page.locator("[id*='login'][role='button']")
  ];

  for (const trigger of triggers) {
    if ((await trigger.count()) === 0) continue;
    const button = trigger.first();
    if (!(await button.isVisible().catch(() => false))) continue;
    await button.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(250);
    break;
  }
}

export async function dismissSecurityWarnings(page: Page, timeoutMs = 15000): Promise<number> {
  const selectors = [
    "#securityAlertConfirmKoDefault",
    "#securityAlertConfirmSnmpDefault"
  ];

  let dismissed = 0;
  const endAt = Date.now() + timeoutMs;

  while (Date.now() < endAt && !page.isClosed()) {
    let clickedInThisPass = false;

    for (const selector of selectors) {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0) continue;
      if (!(await button.isVisible().catch(() => false))) continue;

      await button.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      dismissed += 1;
      clickedInThisPass = true;
    }

    // Fallback: close any remaining visible "Close" buttons inside security alert roots.
    const fallbackButtons = page
      .locator(".securityAlertRoot button, .securityAlertContent button")
      .filter({ hasText: "Close" });

    const count = await fallbackButtons.count();
    for (let i = 0; i < count; i += 1) {
      const btn = fallbackButtons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      await btn.click({ timeout: 1500 }).catch(() => undefined);
      await page.waitForTimeout(150);
      dismissed += 1;
      clickedInThisPass = true;
    }

    if (!clickedInThisPass) {
      // Wait a bit; second warning can appear after first is closed.
      await page.waitForTimeout(350);
    }
  }

  return dismissed;
}

export async function autoLoginToPrinter(page: Page, options: LoginOptions): Promise<LoginResult> {
  const timeout = options.timeoutMs ?? 20000;
  const host = options.host ?? "";
  if (host) {
    await openLoginEntryPoint(page, host);
  }

  const startedAt = Date.now();
  let userField: ReturnType<Page["locator"]> | null = null;
  let passwordField: ReturnType<Page["locator"]> | null = null;

  while (Date.now() - startedAt < timeout) {
    userField = await firstVisible([
      page.locator("#loginName"),
      page.getByLabel("User ID", { exact: true }),
      page.getByRole("textbox", { name: "User ID", exact: true }),
      page.locator("input[name='NAME']"),
      page.locator("input[type='text']")
    ]);
    passwordField = await firstVisible([
      page.locator("#loginPsw"),
      page.getByLabel("Password", { exact: true }),
      page.getByRole("textbox", { name: "Password", exact: true }),
      page.locator("input[name='PSW']"),
      page.locator("input[type='password']")
    ]);

    if (userField && passwordField) break;
    await openLoginModalIfNeeded(page);
    await page.waitForTimeout(350);
  }

  if (!userField || !passwordField) {
    return {
      attempted: false,
      submitted: false,
      reason: "login fields not found or not visible"
    };
  }

  await userField.fill(options.username);
  await passwordField.fill(options.password);

  const submitButton = await firstVisible([
    page.locator("#loginButton"),
    page.getByRole("button", { name: "Log In", exact: true }),
    page.getByText("Log In", { exact: true }).locator("xpath=ancestor::button[1]"),
    page.locator("button[type='submit']")
  ]);

  if (!submitButton) {
    await passwordField.press("Enter").catch(() => undefined);
    return {
      attempted: true,
      submitted: false,
      reason: "submit button not found, attempted Enter key"
    };
  }

  await Promise.race([
    Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined),
      submitButton.click({ timeout: Math.min(timeout, 5000) })
    ]),
    (async () => {
      await submitButton.click({ timeout: Math.min(timeout, 5000) });
      await page.waitForTimeout(1200);
    })()
  ]);

  const dismissedWarnings = await dismissSecurityWarnings(page);

  return {
    attempted: true,
    submitted: true,
    reason: dismissedWarnings > 0 ? `login submitted, dismissed ${dismissedWarnings} warning dialog(s)` : "login submitted"
  };
}
