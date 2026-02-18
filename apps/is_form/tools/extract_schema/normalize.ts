import {
  deriveFieldKey,
  normalizeContext,
  normalizeSection,
  normalizeUrlPath,
  parseRoleSelector,
  radioClusterHint,
  sectionTitleFromKey,
} from "./keys.js";
import type {
  CaptureInput,
  DeterministicInput,
  EnumOption,
  Locator,
  NormalizedSetting,
} from "./types.js";

function controlTypeFromRaw(type: string): NormalizedSetting["type"] {
  const key = type.trim().toLowerCase();
  if (["combobox", "select"].includes(key)) {
    return "select";
  }
  if (["checkbox"].includes(key)) {
    return "checkbox";
  }
  if (["spinbutton", "number"].includes(key)) {
    return "number";
  }
  if (["radio"].includes(key)) {
    return "radio";
  }
  if (["button_dialog", "button", "action"].includes(key)) {
    return "action";
  }
  if (["text_display", "text"].includes(key)) {
    return "text_display";
  }
  if (["textarea"].includes(key)) {
    return "textarea";
  }
  return "text";
}

function toOptions(
  deterministicOptions: string[] | undefined,
  captureOptions: Array<{ value?: string; text?: string }> | undefined,
): EnumOption[] {
  const seen = new Set<string>();
  const out: EnumOption[] = [];

  for (const option of deterministicOptions ?? []) {
    const value = String(option ?? "").trim();
    if (!value) {
      continue;
    }
    const key = `${value}::${value}`;
    if (!seen.has(key)) {
      out.push({ value, label: value });
      seen.add(key);
    }
  }

  for (const option of captureOptions ?? []) {
    const value = String(option.value ?? option.text ?? "").trim();
    const label = String(option.text ?? option.value ?? "").trim();
    if (!value && !label) {
      continue;
    }
    const normalizedValue = value || label;
    const normalizedLabel = label || value;
    const key = `${normalizedValue}::${normalizedLabel}`;
    if (!seen.has(key)) {
      out.push({ value: normalizedValue, label: normalizedLabel });
      seen.add(key);
    }
  }

  return out.sort((a, b) => a.value.localeCompare(b.value) || a.label.localeCompare(b.label));
}

export function buildLocator(input: {
  role?: string;
  name?: string;
  selector?: string;
  domSelector?: string;
  id?: string;
}): Locator {
  const fallback = [input.selector, input.domSelector, input.id ? `#${input.id}` : undefined]
    .map((value) => (value ?? "").trim())
    .filter((value, index, self) => value.length > 0 && self.indexOf(value) === index);

  if (input.role && input.name) {
    return {
      strategy: "role",
      role: input.role,
      name: input.name,
      selector: `role=${input.role}[name='${input.name}']`,
      fallbackSelectors: fallback,
    };
  }

  if (input.domSelector?.startsWith("#")) {
    return {
      strategy: "id",
      selector: input.domSelector,
      fallbackSelectors: fallback,
    };
  }

  return {
    strategy: "css",
    selector: input.selector?.trim() || input.domSelector?.trim() || (input.id ? `#${input.id}` : ""),
    fallbackSelectors: fallback,
  };
}

export function normalizeInputs(input: {
  deterministicInputs: DeterministicInput[];
  captureInputs: CaptureInput[];
}): {
  settings: NormalizedSetting[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const byComposite = new Map<string, NormalizedSetting>();

  for (const deterministic of input.deterministicInputs) {
    for (const page of deterministic.pages ?? []) {
      const pageId = normalizeUrlPath(page.url);
      const pageTitle = (page.title ?? pageId).trim() || pageId;
      for (const setting of page.settings ?? []) {
        const type = controlTypeFromRaw(setting.type ?? "text");
        const context = normalizeContext(setting.context);
        const section = normalizeSection(setting.section);
        const sourceKey = (setting.key ?? setting.dom_selector ?? setting.selector ?? setting.label ?? "").trim();
        const parsedRole = parseRoleSelector(setting.selector);
        const fieldKey = deriveFieldKey({
          pageId,
          context,
          section,
          sourceId: sourceKey,
          label: setting.label ?? sourceKey,
          controlType: type,
        });

        byComposite.set(fieldKey, {
          pageId,
          pageTitle,
          sourceKey,
          type,
          label: (setting.label ?? sourceKey ?? fieldKey).trim(),
          section,
          context,
          dependency: (setting.dependency ?? "").trim(),
          selectorRole: parsedRole.role,
          selectorName: parsedRole.name,
          selector: setting.selector?.trim(),
          domSelector: setting.dom_selector?.trim(),
          currentValue: setting.current_value ?? null,
          disabled: setting.disabled === true,
          options: toOptions(setting.options, undefined),
          order: setting.order ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }

  for (const capture of input.captureInputs) {
    for (const page of capture.pages ?? []) {
      const pageId = normalizeUrlPath(page.url);
      const pageTitle = (page.title ?? pageId).trim() || pageId;
      for (const setting of page.settings ?? []) {
        const type = controlTypeFromRaw(setting.kind ?? "text");
        const context = normalizeContext(setting.context);
        const section = normalizeSection(setting.section);
        const sourceKey = (setting.id ?? setting.cssPath ?? setting.selector ?? setting.label ?? "").trim();
        const fieldKey = deriveFieldKey({
          pageId,
          context,
          section,
          sourceId: sourceKey,
          label: setting.label ?? sourceKey,
          controlType: type,
        });

        const existing = byComposite.get(fieldKey);
        const resolvedCurrentValue =
          type === "checkbox" ? (setting.checked ?? existing?.currentValue ?? false) : (setting.value ?? existing?.currentValue ?? null);
        const parsedRole = parseRoleSelector(existing?.selector);

        byComposite.set(fieldKey, {
          pageId,
          pageTitle,
          sourceKey,
          type,
          label: (setting.label ?? existing?.label ?? sourceKey ?? fieldKey).trim(),
          section,
          context,
          dependency: (setting.dependency ?? existing?.dependency ?? "").trim(),
          selectorRole: existing?.selectorRole ?? parsedRole.role,
          selectorName: existing?.selectorName ?? parsedRole.name,
          selector: existing?.selector ?? setting.selector?.trim() ?? setting.cssPath?.trim(),
          domSelector: existing?.domSelector ?? setting.cssPath?.trim() ?? (setting.id ? `#${setting.id}` : undefined),
          id: setting.id ?? undefined,
          name: setting.name ?? undefined,
          currentValue: resolvedCurrentValue,
          disabled: setting.disabled ?? existing?.disabled ?? false,
          options: toOptions(existing?.options.map((option) => option.label), setting.options),
          order: Math.min(existing?.order ?? Number.MAX_SAFE_INTEGER, setting.order ?? Number.MAX_SAFE_INTEGER),
        });
      }
    }
  }

  const settings = Array.from(byComposite.values());
  settings.sort((a, b) => {
    return (
      a.pageId.localeCompare(b.pageId) ||
      a.context.localeCompare(b.context) ||
      a.section.localeCompare(b.section) ||
      a.order - b.order ||
      a.sourceKey.localeCompare(b.sourceKey)
    );
  });

  if (settings.length === 0) {
    warnings.push("No settings were found in provided input files.");
  }

  return { settings, warnings };
}

export function deriveRadioGroupKey(setting: NormalizedSetting): string {
  return radioClusterHint(setting.dependency, setting.section, setting.id ?? setting.sourceKey, setting.name ?? "");
}

export function sectionTitle(sectionKey: string): string {
  return sectionTitleFromKey(sectionKey);
}
