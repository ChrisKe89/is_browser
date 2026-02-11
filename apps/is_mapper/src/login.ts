import { type Page } from "playwright";
import { PRINTER_USER, PRINTER_PASS } from "@is-browser/env";

const USER_LABEL_RE = /user id|user|login|name|email/i;
const PASS_LABEL_RE = /pass|password|pin/i;
const LOGIN_TRIGGER_RE = /log in|login|sign in/i;
const LOGOUT_RE = /log out|logout/i;
const CLOSE_RE = /close/i;

async function openLoginModal(page: Page): Promise<boolean> {
  const trigger = page.getByRole("button", { name: LOGIN_TRIGGER_RE }).first();
  if (await trigger.count()) {
    console.log("[login] clicking login trigger");
    await trigger.click();
    try {
      const modal = page.locator("#loginRoot");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      return true;
    } catch {
      const passwordInputs = page.locator('input[type="password"]');
      if ((await passwordInputs.count()) > 0) return true;
      const userByLabel = page.getByLabel(USER_LABEL_RE);
      if (await userByLabel.count()) return true;
    }
  }
  return false;
}

export async function isLoginPage(page: Page): Promise<boolean> {
  const loginTrigger = page.getByRole("button", { name: LOGIN_TRIGGER_RE }).first();
  if ((await loginTrigger.count()) > 0 && (await loginTrigger.isVisible().catch(() => false))) {
    return true;
  }

  const passwordInputs = page.locator('input[type="password"]');
  if ((await passwordInputs.count()) > 0) {
    return true;
  }
  const userLike = await page
    .locator("input, textarea")
    .evaluateAll((els, pattern) => {
      const re = new RegExp(pattern, "i");
      return els.some((el) => {
        const attrs = [
          el.getAttribute("aria-label"),
          el.getAttribute("name"),
          el.getAttribute("id"),
          el.getAttribute("placeholder")
        ]
          .filter(Boolean)
          .join(" ");
        return re.test(attrs);
      });
    }, USER_LABEL_RE.source);
  if (userLike) return true;
  return false;
}

export async function login(page: Page): Promise<void> {
  console.log("[login] start");
  await openLoginModal(page);

  const userField = page.getByLabel(USER_LABEL_RE).first();
  const passField = page.getByLabel(PASS_LABEL_RE).first();
  const userByRole = page.getByRole("textbox", { name: USER_LABEL_RE }).first();
  const passByRole = page.getByRole("textbox", { name: PASS_LABEL_RE }).first();
  const passwordInputs = page.locator('input[type="password"]');

  const chosenUserField = (await userField.count()) ? userField : userByRole;
  if (await chosenUserField.count()) {
    console.log("[login] filling user");
    const fillable = await chosenUserField
      .evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        return (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (el as HTMLElement).isContentEditable === true
        );
      })
      .catch(() => false);
    if (fillable) {
      await chosenUserField.fill(PRINTER_USER);
    }
  }

  const chosenPassField = (await passField.count()) ? passField : passByRole;
  if (await chosenPassField.count()) {
    console.log("[login] filling password");
    const fillable = await chosenPassField
      .evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        return (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          (el as HTMLElement).isContentEditable === true
        );
      })
      .catch(() => false);
    if (fillable) {
      await chosenPassField.fill(PRINTER_PASS);
    }
  } else if ((await passwordInputs.count()) > 0) {
    await passwordInputs.first().fill(PRINTER_PASS);
  }

  const loginModal = page.locator("#loginModal");
  if (await loginModal.isVisible().catch(() => false)) {
    console.log("[login] login modal visible");
    const modalSubmit = loginModal
      .getByRole("button", { name: /login|log in|sign in|submit|ok|apply/i })
      .first();
    if (await modalSubmit.count()) {
      console.log("[login] submitting modal login button");
      await modalSubmit.click();
      await finalizeLogin(page);
      return;
    }

    const modalFormSubmit = loginModal
      .locator('input[type="submit"], button[type="submit"]')
      .first();
    if (await modalFormSubmit.count()) {
      console.log("[login] submitting modal form");
      await modalFormSubmit.click();
      await finalizeLogin(page);
      return;
    }
  }

  const scopedLogin = page.getByLabel(/log in|login|sign in/i).getByRole("button", { name: LOGIN_TRIGGER_RE }).first();
  if (await scopedLogin.count()) {
    console.log("[login] submitting scoped login button");
    await scopedLogin.click();
    await finalizeLogin(page);
    return;
  }

  const formSubmit = page
    .locator('form >> input[type="submit"], form >> button[type="submit"]')
    .first();
  if ((await formSubmit.count()) && (await formSubmit.isVisible().catch(() => false))) {
    console.log("[login] submitting form button");
    await formSubmit.click();
    await finalizeLogin(page);
    return;
  }

  if ((await passwordInputs.count()) > 0) {
    const form = passwordInputs.first().locator("xpath=ancestor::form[1]");
    if (await form.count()) {
      const formButton = form
        .getByRole("button", { name: /login|log in|sign in|submit|ok|apply/i })
        .first();
      if ((await formButton.count()) && (await formButton.isVisible().catch(() => false))) {
        console.log("[login] submitting form ancestor button");
        await formButton.click();
        await finalizeLogin(page);
        return;
      }
    }

    const container = passwordInputs.first().locator(
      "xpath=ancestor::*[self::div or self::section or self::main][1]"
    );
    if (await container.count()) {
      const containerButton = container
        .getByRole("button", { name: /login|log in|sign in|submit|ok|apply/i })
        .first();
      if (await containerButton.count()) {
        const label =
          (await containerButton.getAttribute("aria-label"))?.trim() ||
          (await containerButton.innerText()).trim();
        if (!LOGOUT_RE.test(label)) {
          console.log("[login] submitting container button");
          await containerButton.click();
          await finalizeLogin(page);
          return;
        }
      }
    }

    await passwordInputs.first().press("Enter");
    console.log("[login] submitting with enter");
    await finalizeLogin(page);
  }
}

async function finalizeLogin(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => null);
  await dismissPostLoginDialogs(page);
}

async function dismissPostLoginDialogs(page: Page): Promise<void> {
  // Some device UIs show one or more informational modal popups after login.
  for (let i = 0; i < 3; i += 1) {
    const closeButton = page.getByRole("button", { name: CLOSE_RE }).first();
    if (!(await closeButton.count())) break;
    const visible = await closeButton.isVisible().catch(() => false);
    if (!visible) break;
    await closeButton.click().catch(() => null);
    await page.waitForTimeout(200);
  }
}

