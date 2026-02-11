import { type Page } from "playwright";
import { type FieldEntry, type Selector } from "@is-browser/contract";
import { buildSelectorCandidates, deriveFieldLabel, roleForType, slugify } from "../utils.js";
import { fieldFingerprint } from "./fingerprint.js";

const LOCATOR_READ_TIMEOUT_MS = 750;
const RANGE_HINT_RE = /\(\s*(\d+)\s*[-–]\s*(\d+)\s*\)/;
const MODAL_ACTION_RE = /save|apply|ok|submit|cancel|close/i;

type OptionEntry = NonNullable<FieldEntry["options"]>[number];

export type FieldCandidate = {
  label?: string;
  labelQuality?: FieldEntry["labelQuality"];
  type: FieldEntry["type"];
  selectors: Selector[];
  selectorKey: string;
  constraints?: FieldEntry["constraints"];
  options?: FieldEntry["options"];
  hints?: FieldEntry["hints"];
  rangeHint?: FieldEntry["rangeHint"];
  groupKey?: string;
  groupTitle?: string;
  groupOrder?: number;
  controlType?: FieldEntry["controlType"];
  readonly?: boolean;
  visibility?: FieldEntry["visibility"];
  currentValue?: FieldEntry["currentValue"];
  valueType?: FieldEntry["valueType"];
};

export type ControlStateRead = {
  valueType: NonNullable<FieldEntry["valueType"]>;
  currentValue: FieldEntry["currentValue"];
  displayValue?: string | null;
  options?: OptionEntry[];
};

export type ReadControlStateMeta = {
  fieldType: FieldEntry["type"];
  tagName?: string;
  roleAttr?: string;
  inputType?: string;
};

type RadioMember = {
  locator: ReturnType<Page["locator"]>;
  value: string;
  label?: string;
  selectors: Selector[];
  checked: boolean;
};

type RadioGroup = {
  groupKey: string;
  name?: string;
  label?: string;
  groupTitle?: string;
  groupOrder?: number;
  members: RadioMember[];
};

type GroupContext = {
  groupKey: string;
  groupTitle?: string;
};

async function safeGetAttribute(
  locator: ReturnType<Page["locator"]>,
  name: string
): Promise<string | null> {
  return locator.getAttribute(name, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => null);
}

async function safeEvaluate<T>(
  locator: ReturnType<Page["locator"]>,
  pageFunction: (el: SVGElement | HTMLElement) => T
): Promise<T | undefined> {
  return locator.evaluate(pageFunction, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => undefined);
}

async function safeInputValue(locator: ReturnType<Page["locator"]>): Promise<string | null> {
  return locator.inputValue({ timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => null);
}

async function safeInnerText(locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.innerText({ timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => "");
}

function asNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asPositiveInteger(value: string | null): number | undefined {
  const n = asNumber(value);
  if (typeof n !== "number") return undefined;
  if (!Number.isInteger(n)) return undefined;
  if (n < 0) return undefined;
  return n;
}

function normalizeLabel(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function normalizeCurrentString(value: string | null | undefined): string | null {
  const normalized = normalizeLabel(value);
  return normalized ?? null;
}

function normalizeLabelQuality(label: string | undefined): FieldEntry["labelQuality"] {
  if (!label) return "missing";
  if (label === "(Unknown Setting)") return "missing";
  if (label.startsWith("(Derived)")) return "derived";
  return "explicit";
}

export function mergeEnums(existing: string[] = [], incoming: string[] = []): string[] {
  return Array.from(new Set([...existing, ...incoming].map((value) => value.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b)
  );
}

function normalizeOptions(options: OptionEntry[] = []): OptionEntry[] {
  const byValue = new Map<string, OptionEntry>();
  for (const option of options) {
    const value = option.value.trim();
    if (!value) continue;
    const existing = byValue.get(value);
    if (!existing) {
      byValue.set(value, { value, label: normalizeLabel(option.label) });
      continue;
    }
    if (!existing.label && option.label) {
      existing.label = normalizeLabel(option.label);
    }
  }
  return Array.from(byValue.values()).sort((a, b) => a.value.localeCompare(b.value));
}

function mergeOptionLists(...lists: Array<OptionEntry[] | undefined>): OptionEntry[] {
  const merged: OptionEntry[] = [];
  for (const list of lists) {
    if (!list || list.length === 0) continue;
    merged.push(...list);
  }
  return normalizeOptions(merged);
}

function toEnumValues(options?: OptionEntry[]): string[] | undefined {
  const values = options?.map((option) => option.value) ?? [];
  const normalized = mergeEnums(values, []);
  return normalized.length > 0 ? normalized : undefined;
}

function inferControlType(
  fieldType: FieldEntry["type"],
  roleAttr: string | undefined,
  constraints: FieldEntry["constraints"] | undefined
): NonNullable<FieldEntry["controlType"]> {
  if (fieldType === "checkbox" && roleAttr === "switch") return "switch";
  if (fieldType === "checkbox") return "checkbox";
  if (fieldType === "number") return "number";
  if (fieldType === "select") return "dropdown";
  if (fieldType === "radio") return "radio_group";
  if (fieldType === "button") return "button";
  if (fieldType === "textarea" || fieldType === "text") return "textbox";
  if (constraints?.enum?.length) return "dropdown";
  return "unknown";
}

function normalizeGroupTitle(groupKey: string, groupTitle?: string): string | undefined {
  if (groupTitle) return groupTitle;
  if (!groupKey || groupKey === "group:general") return "General";
  const normalized = groupKey
    .replace(/^group:/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "General";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function readNativeSelectState(
  handle: ReturnType<Page["locator"]>
): Promise<ControlStateRead> {
  const currentRaw = await safeInputValue(handle);
  const nativeOptions = await handle
    .locator("option")
    .evaluateAll((options) => {
      const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
      const out: Array<{ value: string; label?: string; selected: boolean }> = [];
      for (const option of options) {
        const label = normalize(option.textContent);
        const optionValue = normalize(option.getAttribute("value"));
        const value = optionValue || label;
        if (!value) continue;
        out.push({
          value,
          label: label || undefined,
          selected: (option as HTMLOptionElement).selected
        });
      }
      return out;
    })
    .catch(() => []);

  const options = normalizeOptions(
    nativeOptions.map((option) => ({
      value: option.value,
      label: option.label
    }))
  );

  const selected = nativeOptions.find((option) => option.selected);
  let currentValue = normalizeCurrentString(currentRaw);
  let displayValue = normalizeCurrentString(selected?.label ?? null);

  if (!currentValue && selected?.value) {
    currentValue = normalizeCurrentString(selected.value);
  }
  if (!currentValue && displayValue) {
    currentValue = displayValue;
  }
  if (!displayValue && currentValue) {
    displayValue = options.find((option) => option.value === currentValue)?.label ?? null;
  }

  return {
    valueType: "enum",
    currentValue,
    displayValue,
    options: options.length ? options : undefined
  };
}

async function readCustomComboboxState(
  handle: ReturnType<Page["locator"]>
): Promise<ControlStateRead> {
  const snapshot = await handle
    .evaluate((el) => {
      const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
      const isVisible = (option: HTMLElement) => {
        const style = window.getComputedStyle(option);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (option.offsetParent === null && style.position !== "fixed") return false;
        return true;
      };
      const resolveOption = (option: Element | null) => {
        if (!option) return undefined;
        const node = option as HTMLElement;
        const label = normalize(node.getAttribute("aria-label") || node.textContent);
        const value = normalize(node.getAttribute("data-value") || node.getAttribute("value") || label);
        if (!value && !label) return undefined;
        return { value: value || label || "", label: label || undefined };
      };

      const controls = el.getAttribute("aria-controls") || "";
      const owns = el.getAttribute("aria-owns") || "";
      const ids = [...controls.split(/\s+/), ...owns.split(/\s+/)].map((id) => id.trim()).filter(Boolean);
      const lists = ids
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => Boolean(node));

      const activeDescendantId = el.getAttribute("aria-activedescendant");
      const activeDescendant = activeDescendantId ? document.getElementById(activeDescendantId) : null;
      const activeOption = resolveOption(activeDescendant);

      const expanded = (el.getAttribute("aria-expanded") || "").toLowerCase() === "true";
      let selectedOption: { value: string; label?: string } | undefined;
      const options: Array<{ value: string; label?: string }> = [];

      if (expanded && lists.length > 0) {
        for (const list of lists) {
          const listOptions = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
          for (const option of listOptions) {
            const resolved = resolveOption(option);
            if (!resolved) continue;
            options.push(resolved);
            const selected =
              option.getAttribute("aria-selected") === "true" ||
              option.getAttribute("aria-current") === "true" ||
              option.getAttribute("aria-checked") === "true" ||
              option.getAttribute("data-selected") === "true" ||
              option.classList.contains("selected");
            if (selected && !selectedOption) {
              selectedOption = resolved;
            }
          }
        }
      }

      const inputValue =
        "value" in el && typeof (el as HTMLInputElement).value === "string"
          ? normalize((el as HTMLInputElement).value)
          : "";
      const controlText = normalize((el as HTMLElement).innerText || el.textContent || "");

      return {
        activeOption,
        selectedOption,
        expanded,
        controlText: inputValue || controlText || "",
        options
      };
    }, { timeout: LOCATOR_READ_TIMEOUT_MS })
    .catch(() => undefined);

  const options = normalizeOptions(snapshot?.options ?? []);
  let currentValue: FieldEntry["currentValue"] = null;
  let displayValue: string | null = null;

  if (snapshot?.activeOption) {
    displayValue = normalizeCurrentString(snapshot.activeOption.label ?? snapshot.activeOption.value);
    currentValue = normalizeCurrentString(snapshot.activeOption.value || snapshot.activeOption.label);
  }

  if (currentValue === null && snapshot?.selectedOption) {
    displayValue = normalizeCurrentString(snapshot.selectedOption.label ?? snapshot.selectedOption.value);
    currentValue = normalizeCurrentString(snapshot.selectedOption.value || snapshot.selectedOption.label);
  }

  if (currentValue === null) {
    const fallback = normalizeCurrentString(snapshot?.controlText);
    if (fallback) {
      currentValue = fallback;
      displayValue = fallback;
    }
  }

  return {
    valueType: "enum",
    currentValue,
    displayValue,
    options: options.length ? options : undefined
  };
}

export async function readControlState(
  handle: ReturnType<Page["locator"]>,
  meta: ReadControlStateMeta
): Promise<ControlStateRead> {
  try {
    if (meta.fieldType === "checkbox" || meta.roleAttr === "switch") {
      const checked = await handle.isChecked({ timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => undefined);
      return { valueType: "boolean", currentValue: typeof checked === "boolean" ? checked : null };
    }

    if (meta.fieldType === "select") {
      if ((meta.tagName ?? "").toLowerCase() === "select") {
        return readNativeSelectState(handle);
      }
      return readCustomComboboxState(handle);
    }

    if (meta.fieldType === "radio") {
      const checked = await handle.isChecked({ timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => false);
      if (!checked) {
        return { valueType: "enum", currentValue: null };
      }
      const value = normalizeCurrentString(await safeGetAttribute(handle, "value"));
      if (value) return { valueType: "enum", currentValue: value };
      const label = normalizeCurrentString(await safeGetAttribute(handle, "aria-label"));
      return { valueType: "enum", currentValue: label };
    }

    if (meta.fieldType === "number" || meta.inputType === "number") {
      const value = normalizeCurrentString(await safeInputValue(handle));
      if (!value) return { valueType: "number", currentValue: null };
      const numeric = Number(value);
      return {
        valueType: "number",
        currentValue: Number.isFinite(numeric) ? numeric : null
      };
    }

    if (meta.fieldType === "text" || meta.fieldType === "textarea") {
      const value = normalizeCurrentString(await safeInputValue(handle));
      return { valueType: "string", currentValue: value };
    }

    return { valueType: "unknown", currentValue: null };
  } catch {
    return { valueType: "unknown", currentValue: null };
  }
}

export async function readControlValue(
  handle: ReturnType<Page["locator"]>,
  type: FieldEntry["type"]
): Promise<{ valueType: NonNullable<FieldEntry["valueType"]>; value: FieldEntry["currentValue"] }> {
  const state = await readControlState(handle, { fieldType: type });
  return { valueType: state.valueType, value: state.currentValue };
}

async function readOptionLabel(page: Page, radio: ReturnType<Page["locator"]>): Promise<string | undefined> {
  const id = await safeGetAttribute(radio, "id");
  if (id) {
    const label = page.locator(`label[for="${id}"]`).first();
    if (await label.count()) {
      const text = normalizeLabel(await safeInnerText(label));
      if (text) return text;
    }
  }

  const ariaLabel = normalizeLabel(await safeGetAttribute(radio, "aria-label"));
  if (ariaLabel) return ariaLabel;

  const parentLabel = radio.locator("xpath=ancestor-or-self::label[1]").first();
  if (await parentLabel.count()) {
    const text = normalizeLabel(await safeInnerText(parentLabel));
    if (text) return text;
  }

  const siblingText = await radio.evaluate((el) => {
    const sib = el.nextSibling;
    if (!sib) return "";
    return (sib.textContent ?? "").trim();
  }, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => "");
  return normalizeLabel(siblingText);
}

async function readGroupContext(element: ReturnType<Page["locator"]>): Promise<GroupContext> {
  const context =
    (await element.evaluate((el) => {
      const fromFieldset = el.closest("fieldset");
      const legendText = (fromFieldset?.querySelector("legend")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (legendText) {
        return {
          groupKey: `group:${
            legendText
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || "fieldset"
          }`,
          groupTitle: legendText
        };
      }

      const containerSelectors = [
        "section",
        "[role='group']",
        "[role='region']",
        ".xux-panel",
        ".xux-group",
        ".panel",
        ".group",
        ".section",
        ".accordion-item"
      ];
      const container = el.closest(containerSelectors.join(","));
      if (container) {
        const heading = container.querySelector(
          ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role='heading'], :scope > .title, :scope > .header"
        );
        const headingText = (heading?.textContent || "").replace(/\s+/g, " ").trim();
        if (headingText) {
          return {
            groupKey: `group:${
              headingText
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "") || "section"
            }`,
            groupTitle: headingText
          };
        }
      }

      let walker: Element | null = el;
      while (walker) {
        let sibling = walker.previousElementSibling;
        while (sibling) {
          const heading =
            sibling.matches("h1,h2,h3,h4,h5,h6,[role='heading'],.title,.header")
              ? sibling
              : sibling.querySelector("h1,h2,h3,h4,h5,h6,[role='heading'],.title,.header");
          const headingText = (heading?.textContent || "").replace(/\s+/g, " ").trim();
          if (headingText) {
            return {
              groupKey: `group:${
                headingText
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "") || "section"
              }`,
              groupTitle: headingText
            };
          }
          sibling = sibling.previousElementSibling;
        }
        walker = walker.parentElement;
      }

      return { groupKey: "group:general", groupTitle: "General" };
    }, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => undefined)) ??
    { groupKey: "group:general", groupTitle: "General" };

  return {
    groupKey: context.groupKey || "group:general",
    groupTitle: normalizeGroupTitle(context.groupKey || "group:general", context.groupTitle)
  };
}

async function readRangeHint(element: ReturnType<Page["locator"]>): Promise<string | undefined> {
  const rowText = await safeEvaluate(element, (el) => {
    const row = el.closest("tr,[role='row'],.row,.form-row,.xux-row,.setting-row,.setting-item,.xux-form-row,li");
    const text = (row?.textContent || "").replace(/\s+/g, " ").trim();
    return text;
  });
  const normalized = normalizeLabel(rowText);
  if (!normalized) return undefined;
  const match = normalized.match(RANGE_HINT_RE);
  if (!match) return undefined;
  return match[0];
}

function parseRangeHint(rangeHint: string | undefined): { min?: number; max?: number } {
  if (!rangeHint) return {};
  const match = rangeHint.match(RANGE_HINT_RE);
  if (!match) return {};
  const min = Number(match[1]);
  const max = Number(match[2]);
  return {
    min: Number.isFinite(min) ? min : undefined,
    max: Number.isFinite(max) ? max : undefined
  };
}

async function radioGroupingKey(radio: ReturnType<Page["locator"]>): Promise<{ key: string; name?: string; label?: string }> {
  const name = normalizeLabel(await safeGetAttribute(radio, "name"));
  const fromDom = await radio.evaluate((el) => {
    const fieldset = el.closest("fieldset");
    const legend = (fieldset?.querySelector("legend")?.textContent || "").replace(/\s+/g, " ").trim();
    if (fieldset?.id) {
      return { key: `fieldset:${fieldset.id}`, label: legend || undefined };
    }

    const radioGroup = el.closest('[role="radiogroup"]');
    const groupLabel = (
      radioGroup?.getAttribute("aria-label") ||
      radioGroup?.querySelector("legend")?.textContent ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (radioGroup?.id) {
      return { key: `radiogroup:${radioGroup.id}`, label: groupLabel || undefined };
    }

    const parent = el.parentElement;
    const parentHint = parent
      ? `${parent.tagName.toLowerCase()}.${Array.from(parent.classList).slice(0, 2).join(".")}`
      : "radio";
    return { key: `parent:${parentHint}`, label: groupLabel || legend || undefined };
  }, { timeout: LOCATOR_READ_TIMEOUT_MS }).catch((): { key: string; label?: string } => ({ key: "radio" }));

  if (name) {
    return { key: `name:${name}`, name, label: fromDom.label };
  }
  return { key: fromDom.key, label: fromDom.label };
}

async function discoverRadioGroups(page: Page, root: ReturnType<Page["locator"]>): Promise<FieldCandidate[]> {
  const radios = root.locator("input[type='radio']");
  const radioCount = await radios.count();
  if (radioCount === 0) return [];

  const groups = new Map<string, RadioGroup>();
  const groupOrderByKey = new Map<string, number>();
  let groupOrderCounter = 1;

  for (let i = 0; i < radioCount; i += 1) {
    const radio = radios.nth(i);
    try {
      if (!(await radio.isVisible().catch(() => false))) {
        continue;
      }

      const grouping = await radioGroupingKey(radio);
      const groupContext = await readGroupContext(radio);
      const group = groups.get(grouping.key) ?? {
        groupKey: grouping.key,
        name: grouping.name,
        label: grouping.label,
        groupTitle: groupContext.groupTitle,
        members: []
      };

      const { label, selectors } = await buildSelectorCandidates(page, radio);
      const optionLabel = (await readOptionLabel(page, radio)) ?? label;
      const optionValue =
        normalizeLabel(await safeGetAttribute(radio, "value")) ??
        normalizeLabel(optionLabel) ??
        `option-${group.members.length + 1}`;

      const checked = await radio.isChecked({ timeout: LOCATOR_READ_TIMEOUT_MS }).catch(() => false);
      group.members.push({
        locator: radio,
        value: optionValue,
        label: optionLabel,
        selectors,
        checked
      });

      if (!group.label && grouping.label) {
        group.label = grouping.label;
      }

      groups.set(grouping.key, group);
    } catch {
      // Dynamic UIs can detach controls between selector resolution and reads.
      continue;
    }
  }

  const candidates: FieldCandidate[] = [];
  for (const group of groups.values()) {
    if (group.members.length === 0) continue;

    const groupLabel = group.label ?? group.name ?? group.members[0].label ?? `radio-${slugify(group.groupKey)}`;
    const selectors: Selector[] = [];

    if (group.name) {
      selectors.push({ kind: "css", value: `input[type="radio"][name="${group.name}"]` });
    }
    if (groupLabel) {
      selectors.push({ kind: "label", value: groupLabel });
    }

    const firstSelectors = group.members[0].selectors;
    for (const selector of firstSelectors) {
      if (!selectors.find((existing) => JSON.stringify(existing) === JSON.stringify(selector))) {
        selectors.push(selector);
      }
    }

    const options = normalizeOptions(
      group.members.map((member) => ({ value: member.value, label: member.label }))
    );
    const selected = group.members.find((member) => member.checked)?.value ?? null;
    const selectorKey = fieldFingerprint("radio", selectors, groupLabel);

    candidates.push({
      label: groupLabel,
      labelQuality: normalizeLabelQuality(groupLabel),
      type: "radio",
      selectors,
      selectorKey,
      groupKey: group.groupKey,
      groupTitle: group.groupTitle,
      groupOrder:
        groupOrderByKey.get(group.groupKey) ??
        (() => {
          const next = groupOrderCounter;
          groupOrderCounter += 1;
          groupOrderByKey.set(group.groupKey, next);
          return next;
        })(),
      options,
      currentValue: selected,
      controlType: "radio_group",
      visibility: { visible: true, enabled: true },
      valueType: "enum",
      constraints: options.length
        ? {
            enum: options.map((option) => option.value)
          }
        : undefined
    });
  }

  return candidates;
}

export async function discoverFieldCandidates(
  page: Page,
  scope?: ReturnType<Page["locator"]>
): Promise<{ candidates: FieldCandidate[]; actions: FieldEntry["actions"] }> {
  const candidates: FieldCandidate[] = [];
  const groupOrderByKey = new Map<string, number>();
  let groupOrderCounter = 1;
  const root = scope ?? page.locator("body");
  const controls = root.locator(
    "input:not([type='radio']), textarea, select, [role='textbox'], [role='combobox'], [role='checkbox'], [role='spinbutton'], [role='radio']"
  );
  const count = await controls.count();

  for (let i = 0; i < count; i += 1) {
    const element = controls.nth(i);
    try {
      if (!(await element.isVisible().catch(() => false))) {
        continue;
      }

      const tag = (await safeEvaluate(element, (el) => el.tagName.toLowerCase())) ?? "";
      if (!tag) {
        continue;
      }
      const roleAttr = normalizeLabel(await safeGetAttribute(element, "role"))?.toLowerCase();
      const typeAttr = normalizeLabel(await safeGetAttribute(element, "type"))?.toLowerCase();

      if (tag === "input" && (typeAttr === "hidden" || typeAttr === "submit")) {
        continue;
      }

      let fieldType: FieldEntry["type"] = "text";
      if (tag === "textarea") fieldType = "textarea";
      else if (tag === "select") fieldType = "select";
      else if (typeAttr === "checkbox") fieldType = "checkbox";
      else if (typeAttr === "number") fieldType = "number";
      else if (typeAttr === "button") fieldType = "button";
      else if (roleAttr === "checkbox") fieldType = "checkbox";
      else if (roleAttr === "radio") fieldType = "radio";
      else if (roleAttr === "combobox") fieldType = "select";
      else if (roleAttr === "spinbutton") fieldType = "number";
      else if (roleAttr === "button") fieldType = "button";

      const { label, labelQuality } = await deriveFieldLabel(page, element, root);
      const { selectors } = await buildSelectorCandidates(page, element);
      if (label && !selectors.some((selector) => selector.kind === "label" && normalizeLabel(selector.value) === label)) {
        selectors.unshift({ kind: "label", value: label });
      }

      const role = roleForType(fieldType);
      if (role && label && !selectors.some((selector) => selector.kind === "role" && selector.role === role && selector.name === label)) {
        selectors.unshift({ kind: "role", role, name: label });
      }

      if (selectors.length === 0) {
        continue;
      }

      const constraints: FieldEntry["constraints"] = {};
      const min = asNumber(await safeGetAttribute(element, "min"));
      const max = asNumber(await safeGetAttribute(element, "max"));
      const step = asNumber(await safeGetAttribute(element, "step"));
      const maxLength = asPositiveInteger(await safeGetAttribute(element, "maxlength"));
      const pattern = normalizeLabel(await safeGetAttribute(element, "pattern"));
      const inputMode = normalizeLabel(await safeGetAttribute(element, "inputmode"));
      const readOnly =
        (await safeGetAttribute(element, "readonly")) !== null ||
        (await safeGetAttribute(element, "disabled")) !== null;
      const rangeHint = await readRangeHint(element);
      const rangeFromHint = parseRangeHint(rangeHint);
      const hints = rangeHint ? [rangeHint] : undefined;

      if (typeof min === "number") constraints.min = min;
      if (typeof max === "number") constraints.max = max;
      if (typeof step === "number") constraints.step = step;
      if (typeof maxLength === "number") constraints.maxLength = maxLength;
      if (pattern) constraints.pattern = pattern;
      if (inputMode) constraints.inputMode = inputMode;
      if (readOnly) constraints.readOnly = true;
      if (constraints.min === undefined && typeof rangeFromHint.min === "number") {
        constraints.min = rangeFromHint.min;
      }
      if (constraints.max === undefined && typeof rangeFromHint.max === "number") {
        constraints.max = rangeFromHint.max;
      }

      const state = await readControlState(element, {
        fieldType,
        tagName: tag,
        roleAttr,
        inputType: typeAttr
      });
      let options: OptionEntry[] | undefined = state.options;
      if (fieldType === "select" && state.displayValue && state.currentValue === null) {
        state.currentValue = state.displayValue;
      }
      if (fieldType === "select") {
        options = options?.length ? options : undefined;
      }

      const enumValues = toEnumValues(options);
      if (enumValues) {
        constraints.enum = enumValues;
      }

      const groupContext = await readGroupContext(element);
      const groupKey = groupContext.groupKey;
      const groupOrder =
        groupOrderByKey.get(groupKey) ??
        (() => {
          const next = groupOrderCounter;
          groupOrderCounter += 1;
          groupOrderByKey.set(groupKey, next);
          return next;
        })();
      const enabled = await element.isEnabled().catch(() => !readOnly);
      const controlType = inferControlType(fieldType, roleAttr, constraints);
      const selectorKey = fieldFingerprint(fieldType, selectors, label);

      candidates.push({
        label,
        labelQuality,
        type: fieldType,
        selectors,
        selectorKey,
        groupKey,
        groupTitle: groupContext.groupTitle,
        groupOrder,
        controlType,
        readonly: readOnly,
        visibility: { visible: true, enabled },
        constraints: Object.keys(constraints).length ? constraints : undefined,
        options,
        currentValue: state.currentValue ?? null,
        valueType: state.valueType,
        hints,
        rangeHint
      });
    } catch {
      // Dynamic UIs can detach controls between discovery and reads.
      continue;
    }
  }

  const radioGroups = await discoverRadioGroups(page, root);
  candidates.push(...radioGroups);

  const actionButtons = root.getByRole("button", { name: MODAL_ACTION_RE });
  const actionCount = await actionButtons.count();
  const actions: FieldEntry["actions"] = [];
  const seenActions = new Set<string>();
  for (let i = 0; i < actionCount; i += 1) {
    const button = actionButtons.nth(i);
    const label = normalizeLabel(await safeInnerText(button));
    if (!label) continue;
    const key = label.toLowerCase();
    if (seenActions.has(key)) continue;
    seenActions.add(key);
    actions.push({ selector: { kind: "role", role: "button", name: label }, label });
  }

  return {
    candidates,
    actions: actions.length ? actions : undefined
  };
}
