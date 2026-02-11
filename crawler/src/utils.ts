import { type Page } from "playwright";
import { type Selector } from "../../packages/contracts/src/uiMap.js";

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

  const ariaLabel = await element.getAttribute("aria-label");
  const ariaLabelledBy = await element.getAttribute("aria-labelledby");
  const id = await element.getAttribute("id");
  const name = await element.getAttribute("name");

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
      labelText = (await label.innerText()).trim();
    }
  }

  if (!labelText) {
    const resolved = await element.evaluate((el) => {
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
      labelText = (await parentLabel.innerText()).trim();
    }
  }

  if (!labelText) {
    const legend = await element.evaluate((el) => {
      const fieldset = el.closest("fieldset");
      const legendEl = fieldset?.querySelector("legend");
      return legendEl?.textContent?.trim() ?? "";
    });
    if (legend) labelText = legend;
  }

  const placeholder = await element.getAttribute("placeholder");
  if (!labelText && placeholder) {
    labelText = placeholder.trim();
  }

  const title = await element.getAttribute("title");
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

