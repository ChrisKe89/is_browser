import { type Page } from "playwright";
import { type Selector } from "@is-browser/contract";

const LOCATOR_READ_TIMEOUT_MS = 750;
const DERIVED_LABEL_PREFIX = "(Derived)";

export type LabelQuality = "explicit" | "derived" | "missing";

async function safeGetAttribute(
  element: ReturnType<Page["locator"]>,
  name: string
): Promise<string | null> {
  return element.getAttribute(name, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => null);
}

async function safeInnerText(element: ReturnType<Page["locator"]>): Promise<string> {
  return element.innerText({ timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => "");
}

async function safeEvaluate<T>(
  element: ReturnType<Page["locator"]>,
  pageFunction: (el: SVGElement | HTMLElement) => T
): Promise<T | undefined> {
  return element.evaluate(pageFunction, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => undefined);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "field";
}

export function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let i = 2;
  while (used.has(id)) {
    id = `${base}-${i}`;
    i += 1;
  }
  used.add(id);
  return id;
}

export async function buildSelectorCandidates(
  page: Page,
  element: ReturnType<Page["locator"]>
): Promise<{ label?: string; selectors: Selector[] }>{
  const selectors: Selector[] = [];

  const ariaLabel = await safeGetAttribute(element, "aria-label");
  const ariaLabelledBy = await safeGetAttribute(element, "aria-labelledby");
  const id = await safeGetAttribute(element, "id");
  const name = await safeGetAttribute(element, "name");

  let labelText = ariaLabel?.trim();

  if (!labelText && ariaLabelledBy) {
    const resolved = await page.evaluate((ids) => {
      const parts = ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      return parts.join(" ").trim();
    }, ariaLabelledBy);
    if (resolved) labelText = resolved;
  }

  if (!labelText && id) {
    const label = page.locator(`label[for="${id}"]`).first();
    if (await label.count()) {
      labelText = (await safeInnerText(label)).trim();
    }
  }

  if (!labelText) {
    const resolved = await safeEvaluate(element, (el) => {
      const labels = (el as HTMLInputElement).labels;
      if (!labels || labels.length === 0) return "";
      return Array.from(labels)
        .map((label) => label.textContent?.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    });
    if (resolved) labelText = resolved;
  }

  if (!labelText) {
    const parentLabel = element.locator("xpath=ancestor-or-self::label").first();
    if (await parentLabel.count()) {
      labelText = (await safeInnerText(parentLabel)).trim();
    }
  }

  if (!labelText) {
    const legend = await safeEvaluate(element, (el) => {
      const fieldset = el.closest("fieldset");
      const legendEl = fieldset?.querySelector("legend");
      return legendEl?.textContent?.trim() ?? "";
    });
    if (legend) labelText = legend;
  }

  const placeholder = await safeGetAttribute(element, "placeholder");
  if (!labelText && placeholder) {
    labelText = placeholder.trim();
  }

  const title = await safeGetAttribute(element, "title");
  if (!labelText && title) {
    labelText = title.trim();
  }

  if (labelText) {
    selectors.push({ kind: "label", value: labelText });
  }

  if (id) {
    selectors.push({ kind: "css", value: `#${cssEscape(id)}` });
  } else if (name) {
    selectors.push({ kind: "css", value: `[name="${cssEscape(name)}"]` });
  }

  return { label: labelText, selectors };
}

function normalizeLabel(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function titleCaseWords(words: string[]): string {
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

function humanizeIdentifier(identifier: string | null | undefined): string | undefined {
  const raw = (identifier ?? "").trim();
  if (!raw) return undefined;
  const spaced = raw
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return undefined;

  const words = spaced.split(" ").filter(Boolean);
  if (words.length === 0) return undefined;

  const trailingNoise = new Set(["input", "select", "textbox", "text", "field", "value", "option", "control"]);
  while (words.length > 1 && trailingNoise.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }

  const leadingNoise = new Set([
    "auth",
    "authentication",
    "service",
    "access",
    "setting",
    "settings",
    "config",
    "configuration",
    "printer",
    "device"
  ]);
  while (words.length > 2 && leadingNoise.has(words[0].toLowerCase())) {
    words.shift();
  }

  return titleCaseWords(words);
}

async function resolveAriaLabelledBy(
  page: Page,
  ariaLabelledBy: string,
  scopeRoot?: ReturnType<Page["locator"]>
): Promise<string | undefined> {
  const ids = ariaLabelledBy.split(/\s+/).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return undefined;

  const resolvedParts: string[] = [];
  for (const id of ids) {
    let text = "";
    if (scopeRoot) {
      text = normalizeLabel(
        await safeInnerText(scopeRoot.locator(`[id="${cssEscape(id)}"]`).first())
      ) ?? "";
    }
    if (!text) {
      text = normalizeLabel(
        await safeInnerText(page.locator(`[id="${cssEscape(id)}"]`).first())
      ) ?? "";
    }
    if (text) resolvedParts.push(text);
  }

  return normalizeLabel(resolvedParts.join(" "));
}

async function resolveRowBasedLabel(
  element: ReturnType<Page["locator"]>
): Promise<string | undefined> {
  const fromRow = await safeEvaluate(element, (el) => {
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const row = el.closest(
      "tr,[role='row'],.row,.form-row,.xux-row,.setting-row,.setting-item,.xux-form-row,li"
    );
    if (!row) return "";

    const directCandidates = Array.from(
      row.querySelectorAll<HTMLElement>(
        ":scope > th, :scope > td, :scope > .label, :scope > .name, :scope > .title, :scope > .left"
      )
    );
    for (const candidate of directCandidates) {
      if (candidate.contains(el)) continue;
      const text = normalize(candidate.textContent);
      if (!text) continue;
      if (text.length > 120) continue;
      return text;
    }

    let sibling = el.parentElement?.previousElementSibling as HTMLElement | null;
    while (sibling) {
      const text = normalize(sibling.textContent);
      if (text && text.length <= 120) return text;
      sibling = sibling.previousElementSibling as HTMLElement | null;
    }

    return "";
  });

  return normalizeLabel(fromRow);
}

async function resolveStableIdentifier(
  element: ReturnType<Page["locator"]>
): Promise<string | undefined> {
  const fromDataAttribute = await safeEvaluate(element, (el) => {
    const attrs = [
      "data-label",
      "data-name",
      "data-field",
      "data-setting",
      "data-testid",
      "data-test-id",
      "data-id",
      "data-key"
    ];
    for (const attr of attrs) {
      const value = el.getAttribute(attr)?.trim();
      if (value) return value;
    }
    return "";
  });
  const fromData = humanizeIdentifier(fromDataAttribute);
  if (fromData) return fromData;

  const id = await safeGetAttribute(element, "id");
  const fromId = humanizeIdentifier(id);
  if (fromId) return fromId;

  const name = await safeGetAttribute(element, "name");
  return humanizeIdentifier(name);
}

export async function deriveFieldLabel(
  page: Page,
  element: ReturnType<Page["locator"]>,
  scopeRoot?: ReturnType<Page["locator"]>
): Promise<{ label: string; labelQuality: LabelQuality }> {
  const ariaLabel = normalizeLabel(await safeGetAttribute(element, "aria-label"));
  if (ariaLabel) {
    return { label: ariaLabel, labelQuality: "explicit" };
  }

  const ariaLabelledBy = await safeGetAttribute(element, "aria-labelledby");
  if (ariaLabelledBy) {
    const resolved = await resolveAriaLabelledBy(page, ariaLabelledBy, scopeRoot);
    if (resolved) {
      return { label: resolved, labelQuality: "explicit" };
    }
  }

  const id = await safeGetAttribute(element, "id");
  if (id) {
    const label = page.locator(`label[for="${cssEscape(id)}"]`).first();
    if (await label.count()) {
      const text = normalizeLabel(await safeInnerText(label));
      if (text) {
        return { label: text, labelQuality: "explicit" };
      }
    }
  }

  const fromLabelElement = normalizeLabel(
    await safeEvaluate(element, (el) => {
      const labels = (el as HTMLInputElement).labels;
      if (!labels || labels.length === 0) return "";
      return Array.from(labels)
        .map((label) => label.textContent?.trim())
        .filter(Boolean)
        .join(" ");
    })
  );
  if (fromLabelElement) {
    return { label: fromLabelElement, labelQuality: "explicit" };
  }

  const fromParentLabel = element.locator("xpath=ancestor-or-self::label[1]").first();
  if (await fromParentLabel.count()) {
    const text = normalizeLabel(await safeInnerText(fromParentLabel));
    if (text) {
      return { label: text, labelQuality: "explicit" };
    }
  }

  const fromRow = await resolveRowBasedLabel(element);
  if (fromRow) {
    return { label: fromRow, labelQuality: "derived" };
  }

  const fromStableId = await resolveStableIdentifier(element);
  if (fromStableId) {
    return { label: `${DERIVED_LABEL_PREFIX} ${fromStableId}`, labelQuality: "derived" };
  }

  return { label: "(Unknown Setting)", labelQuality: "missing" };
}

export function roleForType(type: string): string | undefined {
  if (type === "checkbox") return "checkbox";
  if (type === "radio") return "radio";
  if (type === "select") return "combobox";
  if (type === "button") return "button";
  return "textbox";
}

function cssEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

