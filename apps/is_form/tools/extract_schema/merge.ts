import {
  deriveContainerKey,
  deriveFieldKey,
  normalizeContext,
  normalizeSection,
  normalizeUrlPath,
  sectionTitleFromKey,
} from "./keys.js";
import { buildLocator, deriveRadioGroupKey } from "./normalize.js";
import type {
  ExtractedAction,
  ExtractedContainer,
  ExtractedField,
  LayoutInput,
  NavigationInput,
  NormalizedSetting,
} from "./types.js";

type LayoutHints = {
  sectionTitleByFieldKey: Map<string, string>;
  sectionTitleBySectionKey: Map<string, string>;
  pageTitleByPageId: Map<string, string>;
};

type NavigationHints = {
  navPathByPageId: Map<string, string[]>;
};

function collectLayoutHints(inputs: LayoutInput[]): LayoutHints {
  const sectionTitleByFieldKey = new Map<string, string>();
  const sectionTitleBySectionKey = new Map<string, string>();
  const pageTitleByPageId = new Map<string, string>();

  for (const input of inputs) {
    for (const node of input.layout ?? []) {
      const pageId = normalizeUrlPath(node.id ?? "");
      if (pageId && node.title?.trim()) {
        pageTitleByPageId.set(pageId, node.title.trim());
      }

      for (const section of node.sections ?? []) {
        const sectionKey = normalizeSection(section.section);
        if (section.section?.trim()) {
          sectionTitleBySectionKey.set(sectionKey, sectionTitleFromKey(section.section));
        }
        for (const field of section.fields ?? []) {
          if (!field.fieldKey) {
            continue;
          }
          const title = sectionTitleBySectionKey.get(sectionKey) ?? sectionTitleFromKey(sectionKey);
          sectionTitleByFieldKey.set(field.fieldKey, title);
        }
      }
    }
  }

  return { sectionTitleByFieldKey, sectionTitleBySectionKey, pageTitleByPageId };
}

function collectNavigationHints(inputs: NavigationInput[]): NavigationHints {
  const navPathByPageId = new Map<string, string[]>();

  for (const input of inputs) {
    for (const node of input.navigation ?? []) {
      const pageId = normalizeUrlPath(node.id ?? "");
      const navPath = (node.navPath ?? [])
        .map((edge) => (edge.click ?? "").trim())
        .filter((value) => value.length > 0);
      if (!pageId) {
        continue;
      }
      const existing = navPathByPageId.get(pageId) ?? [];
      const merged = Array.from(new Set([...existing, ...navPath]));
      navPathByPageId.set(pageId, merged);
    }
  }

  return { navPathByPageId };
}

function valueTypeFor(controlType: ExtractedField["controlType"]): ExtractedField["valueType"] {
  if (controlType === "checkbox") {
    return "boolean";
  }
  if (controlType === "number") {
    return "number";
  }
  if (controlType === "select" || controlType === "radio_group") {
    return "enum";
  }
  if (controlType === "text_display") {
    return "none";
  }
  return "string";
}

function toControlType(settingType: string): ExtractedField["controlType"] | "action" {
  if (settingType === "action") {
    return "action";
  }
  if (settingType === "select") {
    return "select";
  }
  if (settingType === "radio") {
    return "radio_group";
  }
  if (settingType === "checkbox") {
    return "checkbox";
  }
  if (settingType === "number") {
    return "number";
  }
  if (settingType === "textarea") {
    return "textarea";
  }
  if (settingType === "text_display") {
    return "text_display";
  }
  return "text";
}

function baseFieldKey(setting: NormalizedSetting, controlType: string): string {
  return deriveFieldKey({
    pageId: setting.pageId,
    context: normalizeContext(setting.context),
    section: normalizeSection(setting.section),
    sourceId: setting.id ?? setting.sourceKey,
    label: setting.label,
    controlType,
  });
}

export function mergeToContainers(input: {
  settings: NormalizedSetting[];
  navigationInputs: NavigationInput[];
  layoutInputs: LayoutInput[];
}): {
  containers: ExtractedContainer[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const navigationHints = collectNavigationHints(input.navigationInputs);
  const layoutHints = collectLayoutHints(input.layoutInputs);

  const containersByKey = new Map<string, ExtractedContainer>();
  const radioBuckets = new Map<string, NormalizedSetting[]>();

  for (const setting of input.settings) {
    const containerKey = deriveContainerKey(setting.pageId, setting.context);
    const navPath = navigationHints.navPathByPageId.get(setting.pageId) ?? [];
    const title =
      layoutHints.pageTitleByPageId.get(setting.pageId) ??
      setting.pageTitle ??
      setting.pageId;

    if (!containersByKey.has(containerKey)) {
      containersByKey.set(containerKey, {
        containerKey,
        sourcePages: [setting.pageId],
        title,
        contexts: [setting.context],
        navPath,
        fields: [],
        actions: [],
      });
    }

    const container = containersByKey.get(containerKey);
    if (!container) {
      continue;
    }
    if (!container.sourcePages.includes(setting.pageId)) {
      container.sourcePages.push(setting.pageId);
    }
    if (!container.contexts.includes(setting.context)) {
      container.contexts.push(setting.context);
    }

    const sectionKey = normalizeSection(setting.section);
    const sectionTitle =
      layoutHints.sectionTitleByFieldKey.get(setting.sourceKey) ??
      layoutHints.sectionTitleBySectionKey.get(sectionKey) ??
      sectionTitleFromKey(sectionKey);

    if (setting.type === "radio") {
      const bucketKey = `${containerKey}::${sectionKey}::${deriveRadioGroupKey(setting)}`;
      const bucket = radioBuckets.get(bucketKey) ?? [];
      bucket.push(setting);
      radioBuckets.set(bucketKey, bucket);
      continue;
    }

    if (setting.type === "action") {
      const action: ExtractedAction = {
        actionKey: baseFieldKey(setting, "action"),
        sourceKeys: [setting.sourceKey],
        label: setting.label,
        context: setting.context,
        sectionKey,
        sectionTitle,
        locator: buildLocator({
          role: setting.selectorRole,
          name: setting.selectorName,
          selector: setting.selector,
          domSelector: setting.domSelector,
          id: setting.id,
        }),
        orderHint: setting.order,
        navPath,
      };
      container.actions.push(action);
      continue;
    }

    const controlType = toControlType(setting.type);
    if (controlType === "action") {
      continue;
    }

    const field: ExtractedField = {
      fieldKey: baseFieldKey(setting, controlType),
      sourceKeys: [setting.sourceKey],
      label: setting.label,
      controlType,
      valueType: valueTypeFor(controlType),
      sectionKey,
      sectionTitle,
      context: setting.context,
      currentValue: setting.currentValue,
      disabled: setting.disabled,
      options: [...setting.options],
      locator: buildLocator({
        role: setting.selectorRole,
        name: setting.selectorName,
        selector: setting.selector,
        domSelector: setting.domSelector,
        id: setting.id,
      }),
      orderHint: setting.order,
      navPath,
    };
    container.fields.push(field);
  }

  for (const [bucketKey, members] of Array.from(radioBuckets.entries())) {
    members.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    const first = members[0];
    if (!first) {
      continue;
    }

    const [containerKey, sectionKey] = bucketKey.split("::");
    const container = containersByKey.get(containerKey);
    if (!container) {
      continue;
    }

    const sectionTitle =
      layoutHints.sectionTitleByFieldKey.get(first.sourceKey) ??
      layoutHints.sectionTitleBySectionKey.get(sectionKey) ??
      sectionTitleFromKey(sectionKey);

    const selectedOption = members.find((member) => member.currentValue === true)?.label ?? null;

    const radioField: ExtractedField = {
      fieldKey: baseFieldKey(first, "radio_group"),
      sourceKeys: members.map((member) => member.sourceKey).sort((a, b) => a.localeCompare(b)),
      label: first.label,
      controlType: "radio_group",
      valueType: "enum",
      sectionKey,
      sectionTitle,
      context: first.context,
      currentValue: selectedOption,
      disabled: members.every((member) => member.disabled),
      options: members
        .map((member) => ({ value: member.label, label: member.label }))
        .sort((a, b) => a.value.localeCompare(b.value)),
      locator: buildLocator({
        role: first.selectorRole,
        name: first.selectorName,
        selector: first.selector,
        domSelector: first.domSelector,
        id: first.id,
      }),
      orderHint: first.order,
      navPath: navigationHints.navPathByPageId.get(first.pageId) ?? [],
    };

    container.fields.push(radioField);
  }

  const containers = Array.from(containersByKey.values())
    .map((container) => ({
      ...container,
      sourcePages: [...container.sourcePages].sort((a, b) => a.localeCompare(b)),
      contexts: [...container.contexts].sort((a, b) => a.localeCompare(b)),
      navPath: [...container.navPath],
      fields: container.fields
        .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey))
        .map((field) => ({ ...field, sourceKeys: [...field.sourceKeys].sort((a, b) => a.localeCompare(b)) })),
      actions: container.actions
        .sort((a, b) => a.actionKey.localeCompare(b.actionKey))
        .map((action) => ({
          ...action,
          sourceKeys: [...action.sourceKeys].sort((a, b) => a.localeCompare(b)),
        })),
    }))
    .sort((a, b) => a.containerKey.localeCompare(b.containerKey));

  if (containers.length === 0) {
    warnings.push("No containers produced by extractor.");
  }

  return { containers, warnings };
}
