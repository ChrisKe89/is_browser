import { NAV_TIMEOUT_MS } from "../../../packages/platform/src/env.js";
import { type FieldEntry, type PageEntry, type Selector } from "../../../packages/contracts/src/uiMap.js";

type PageLike = import("playwright").Page;
type LocatorLike = import("playwright").Locator;
const MODAL_CLOSE_RE = /cancel|close|done|ok/i;

export type PageCommitAction = {
  pageId: string;
  selector: Selector;
  label?: string;
  sourceFieldId: string;
};

export type RankedSelector = {
  selector: Selector;
  priority: number;
  originalIndex: number;
};

export function rankSelectors(selectors: Selector[]): RankedSelector[] {
  return selectors
    .map((selector, index) => ({
      selector,
      priority: selector.priority ?? index + 1,
      originalIndex: index
    }))
    .sort((left, right) => left.priority - right.priority || left.originalIndex - right.originalIndex);
}

function commitLabelPriority(label?: string): number {
  if (!label) return 5;
  if (/save/i.test(label)) return 1;
  if (/apply/i.test(label)) return 2;
  if (/submit/i.test(label)) return 3;
  if (/ok/i.test(label)) return 4;
  return 5;
}

export function buildPageCommitActionMap(fields: FieldEntry[]): Map<string, PageCommitAction> {
  const candidatesByPage = new Map<string, PageCommitAction[]>();

  for (const field of fields) {
    if (!field.actions || field.actions.length === 0) {
      continue;
    }
    for (const action of field.actions) {
      const item: PageCommitAction = {
        pageId: field.pageId,
        selector: action.selector,
        label: action.label,
        sourceFieldId: field.id
      };
      const list = candidatesByPage.get(field.pageId) ?? [];
      list.push(item);
      candidatesByPage.set(field.pageId, list);
    }
  }

  const result = new Map<string, PageCommitAction>();
  for (const [pageId, actions] of candidatesByPage.entries()) {
    const deduped = new Map<string, PageCommitAction>();
    for (const action of actions) {
      const key = JSON.stringify(action.selector);
      if (!deduped.has(key)) {
        deduped.set(key, action);
      }
    }
    const sorted = Array.from(deduped.values()).sort((left, right) => {
      return commitLabelPriority(left.label) - commitLabelPriority(right.label);
    });
    if (sorted.length > 0) {
      result.set(pageId, sorted[0]);
    }
  }

  return result;
}

function describeSelector(selector: Selector): string {
  if (selector.kind === "css") {
    return `css(${selector.value ?? "missing"})`;
  }
  if (selector.kind === "label") {
    return `label(${selector.value ?? "missing"})`;
  }
  if (selector.kind === "text") {
    return `text(${selector.value ?? "missing"})`;
  }
  return `role(${selector.role ?? "missing"}:${selector.name ?? "*"})`;
}

function selectorToLocator(page: PageLike, selector: Selector): LocatorLike | null {
  if (selector.kind === "label") {
    if (!selector.value) return null;
    return page.getByLabel(selector.value).first();
  }
  if (selector.kind === "role") {
    if (!selector.role) return null;
    if (selector.name) {
      return page.getByRole(selector.role as Parameters<PageLike["getByRole"]>[0], {
        name: selector.name
      }).first();
    }
    return page.getByRole(selector.role as Parameters<PageLike["getByRole"]>[0]).first();
  }
  if (selector.kind === "text") {
    if (!selector.value) return null;
    return page.getByText(selector.value, { exact: true }).first();
  }
  if (selector.kind === "css") {
    if (!selector.value) return null;
    return page.locator(selector.value).first();
  }
  return null;
}

function urlWithoutTrailingSlash(url: URL): string {
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    return url.pathname.slice(0, -1);
  }
  return url.pathname || "/";
}

export function isNavigationTargetReached(expectedUrl: string, actualUrl: string): boolean {
  try {
    const expected = new URL(expectedUrl);
    const actual = new URL(actualUrl);
    if (expected.origin !== actual.origin) return false;
    if (urlWithoutTrailingSlash(expected) !== urlWithoutTrailingSlash(actual)) return false;
    if (expected.search !== actual.search) return false;
    if (expected.hash && expected.hash !== actual.hash) return false;
    return true;
  } catch {
    return expectedUrl === actualUrl;
  }
}

export async function resolveLocatorByPriority(
  page: PageLike,
  selectors: Selector[],
  context: string
): Promise<{ locator: LocatorLike; selector: Selector; priority: number }> {
  const ranked = rankSelectors(selectors);
  const attempts: string[] = [];

  for (const entry of ranked) {
    const locator = selectorToLocator(page, entry.selector);
    const descriptor = `#${entry.priority}:${describeSelector(entry.selector)}`;
    if (!locator) {
      attempts.push(`${descriptor}:invalid-selector`);
      continue;
    }
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      return { locator, selector: entry.selector, priority: entry.priority };
    }
    attempts.push(`${descriptor}:0-match`);
  }

  throw new Error(`Selector resolution failed for ${context}. Tried ${attempts.join(", ")}.`);
}

export async function executePageNavigation(
  page: PageLike,
  pageEntry: PageEntry,
  baseUrl: string
): Promise<void> {
  async function dismissBlockingModal(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const modalRoot = page
        .locator(
          "#openAppPositionModalWindow:visible, #deviceDetailsModalRoot:visible, .xux-modalWindow-in:visible, .ui-dialog-content:visible, .xux-modalWindow-content:visible"
        )
        .first();
      if (!(await modalRoot.count().catch(() => 0))) break;
      if (!(await modalRoot.isVisible().catch(() => false))) break;

      const closeButton = modalRoot.getByRole("button", { name: MODAL_CLOSE_RE }).first();
      if (await closeButton.count().catch(() => 0)) {
        await closeButton.click().catch(() => null);
      } else {
        await page.keyboard.press("Escape").catch(() => null);
      }
      await page.waitForTimeout(150);
    }
  }

  async function clickWithRecovery(locator: LocatorLike): Promise<void> {
    await dismissBlockingModal();
    try {
      await locator.click();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked =
        /intercepts pointer events|another element|element is obscured|not receiving pointer events/i.test(
          message
        );
      if (!blocked) {
        throw error;
      }
      await dismissBlockingModal();
      await locator.click();
    }
  }

  const navSteps = pageEntry.navPath ?? [];
  const requiresClickPath = navSteps.some((step) => step.action === "click");

  if (pageEntry.url && !requiresClickPath) {
    await page.goto(pageEntry.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => null);
    await dismissBlockingModal();
  } else if (navSteps.length > 0) {
    for (let index = 0; index < navSteps.length; index += 1) {
      const step = navSteps[index];
      if (step.action === "goto") {
        if (!step.url) {
          throw new Error(`Navigation step ${index + 1} for page "${pageEntry.id}" is missing url.`);
        }
        await page.goto(step.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
        continue;
      }

      if (!step.selector) {
        throw new Error(`Navigation step ${index + 1} for page "${pageEntry.id}" is missing selector.`);
      }
      const resolved = await resolveLocatorByPriority(
        page,
        [step.selector],
        `navigation step ${index + 1} on page "${pageEntry.id}"`
      );
      await clickWithRecovery(resolved.locator);
      await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => null);
    }
  } else {
    await page.goto(pageEntry.url ?? baseUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
  }

  if (pageEntry.url) {
    const currentUrl = page.url();
    if (!isNavigationTargetReached(pageEntry.url, currentUrl)) {
      throw new Error(
        `Navigation target mismatch for page "${pageEntry.id}". Expected "${pageEntry.url}" but reached "${currentUrl}".`
      );
    }
  }
}

function cssAttributeEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function parseSwitchTarget(value: unknown, fieldId: string): boolean {
  const normalized = String(value).trim().toLowerCase();
  if (
    value === true ||
    value === 1 ||
    normalized === "true" ||
    normalized === "1" ||
    normalized === "on" ||
    normalized === "yes"
  ) {
    return true;
  }
  if (
    value === false ||
    value === 0 ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "off" ||
    normalized === "no"
  ) {
    return false;
  }
  throw new Error(`Invalid switch value "${value}" for "${fieldId}". Use On/Off.`);
}

async function readCheckedState(locator: LocatorLike): Promise<boolean | null> {
  const checked = await locator.isChecked().catch(() => null);
  if (typeof checked === "boolean") {
    return checked;
  }
  const aria = await locator.getAttribute("aria-checked").catch(() => null);
  if (aria === "true") return true;
  if (aria === "false") return false;
  return null;
}

export async function applySwitchValue(
  locator: LocatorLike,
  value: unknown,
  fieldId: string
): Promise<void> {
  const target = parseSwitchTarget(value, fieldId);
  let current = await readCheckedState(locator);

  if (current !== target) {
    if (target) {
      await locator.check().catch(async () => {
        await locator.click();
      });
    } else {
      await locator.uncheck().catch(async () => {
        await locator.click();
      });
    }
    current = await readCheckedState(locator);
    if (current !== target) {
      await locator.click();
      current = await readCheckedState(locator);
    }
  }

  if (current === null) {
    throw new Error(`Unable to verify switch state for "${fieldId}".`);
  }
  if (current !== target) {
    throw new Error(
      `Switch "${fieldId}" did not reach requested state "${target ? "On" : "Off"}".`
    );
  }
}

export async function applySelectValue(
  page: PageLike,
  locator: LocatorLike,
  value: unknown,
  fieldId: string
): Promise<void> {
  const target = String(value);
  const byValue = await locator.selectOption({ value: target }).catch(() => []);
  if (byValue.length > 0) return;

  const byLabel = await locator.selectOption({ label: target }).catch(() => []);
  if (byLabel.length > 0) return;

  const optionByValue = locator
    .locator(`option[value="${cssAttributeEscape(target)}"]`)
    .first();
  if ((await optionByValue.count().catch(() => 0)) > 0) {
    await optionByValue.click();
    return;
  }

  const optionByText = locator
    .locator("option")
    .filter({ hasText: target })
    .first();
  if ((await optionByText.count().catch(() => 0)) > 0) {
    await optionByText.click();
    return;
  }

  await locator.click().catch(() => null);
  const roleOption = page.getByRole("option", { name: target }).first();
  if ((await roleOption.count().catch(() => 0)) > 0) {
    await roleOption.click();
    return;
  }
  const textOption = page.getByText(target, { exact: true }).first();
  if ((await textOption.count().catch(() => 0)) > 0) {
    await textOption.click();
    return;
  }

  throw new Error(`Unable to apply select value "${target}" for "${fieldId}".`);
}

export async function applyRadioValue(
  page: PageLike,
  locator: LocatorLike,
  value: unknown,
  fieldId: string
): Promise<void> {
  const target = String(value).trim();
  if (target) {
    const candidates = [
      page.getByRole("radio", { name: target }).first(),
      page.getByLabel(target).first(),
      page.getByText(target, { exact: true }).first()
    ];
    for (const candidate of candidates) {
      if ((await candidate.count().catch(() => 0)) > 0) {
        await candidate.click();
        return;
      }
    }
  }

  await locator.check().catch(async () => {
    await locator.click();
  });
  const checked = await readCheckedState(locator);
  if (checked === false) {
    throw new Error(`Unable to select radio option "${target}" for "${fieldId}".`);
  }
}

export async function applyFieldValue(
  page: PageLike,
  locator: LocatorLike,
  field: Pick<FieldEntry, "id" | "type">,
  value: unknown
): Promise<void> {
  switch (field.type) {
    case "text":
    case "textarea":
    case "number":
      await locator.fill(String(value));
      return;
    case "select":
      await applySelectValue(page, locator, value, field.id);
      return;
    case "radio":
      await applyRadioValue(page, locator, value, field.id);
      return;
    case "checkbox":
      await applySwitchValue(locator, value, field.id);
      return;
    case "button":
      await locator.click();
      return;
    default:
      await locator.fill(String(value));
  }
}

