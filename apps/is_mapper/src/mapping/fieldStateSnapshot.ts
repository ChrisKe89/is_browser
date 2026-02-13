import { type Page, type Locator } from "playwright";
import { type FieldEntry, type Selector } from "@is-browser/contract";
import {
  readControlState,
  type ReadControlStateMeta,
} from "./fieldDiscovery.js";
import { type FieldStateSnapshotEntry } from "../clickCapture.js";

const SNAPSHOT_TIMEOUT_MS = 750;

export type VisibleFieldDescriptor = {
  fieldId: string;
  controlType: string;
  type: FieldEntry["type"];
  selectors: Selector[];
  defaultValue: FieldEntry["defaultValue"];
  tagName?: string;
  roleAttr?: string;
  inputType?: string;
};

function resolveLocator(
  page: Page,
  selectors: Selector[],
  scope?: Locator,
): Locator | undefined {
  const root = scope ?? page;

  const roleSelector = selectors.find(
    (s) => s.kind === "role" && s.role && s.name,
  );
  if (roleSelector) {
    return root.getByRole(
      roleSelector.role as Parameters<typeof root.getByRole>[0],
      {
        name: roleSelector.name,
        exact: false,
      },
    );
  }

  const labelSelector = selectors.find((s) => s.kind === "label" && s.value);
  if (labelSelector) {
    return root.getByLabel(labelSelector.value!, { exact: false });
  }

  const cssSelector = selectors.find((s) => s.kind === "css" && s.value);
  if (cssSelector) {
    const value = cssSelector.value!;
    if (/^(xpath|_react|_vue|text|has-text)=|>>/.test(value)) {
      return undefined;
    }
    return root.locator(`css=${value}`);
  }

  return undefined;
}

function valueSourceForControlType(
  controlType: string,
  fieldType: string,
): string {
  if (
    controlType === "switch" ||
    controlType === "checkbox" ||
    fieldType === "checkbox"
  )
    return "checked";
  if (controlType === "radio_group" || fieldType === "radio") return "checked";
  if (controlType === "dropdown" || fieldType === "select")
    return "selectedOption";
  if (controlType === "number" || fieldType === "number") return "inputValue";
  if (
    controlType === "textbox" ||
    fieldType === "text" ||
    fieldType === "textarea"
  )
    return "inputValue";
  if (controlType === "staticTextButton") return "textContent";
  return "inputValue";
}

function buildMeta(descriptor: VisibleFieldDescriptor): ReadControlStateMeta {
  return {
    fieldType: descriptor.type,
    tagName: descriptor.tagName,
    roleAttr: descriptor.roleAttr,
    inputType: descriptor.inputType,
  };
}

function timedEvaluate<T>(
  locator: Locator,
  fn: (el: Element) => T,
): Promise<T | undefined> {
  return Promise.race([
    locator.evaluate(fn as (el: Element) => T),
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), SNAPSHOT_TIMEOUT_MS),
    ),
  ]).catch(() => undefined);
}

async function readDefaultValue(
  locator: Locator,
  descriptor: VisibleFieldDescriptor,
): Promise<string | number | boolean | null> {
  try {
    const controlType = descriptor.controlType;
    const fieldType = descriptor.type;

    if (
      controlType === "switch" ||
      controlType === "checkbox" ||
      fieldType === "checkbox"
    ) {
      const defaultChecked = await timedEvaluate(
        locator,
        (el) => (el as HTMLInputElement).defaultChecked,
      );
      return typeof defaultChecked === "boolean" ? defaultChecked : null;
    }

    if (
      fieldType === "text" ||
      fieldType === "textarea" ||
      fieldType === "number"
    ) {
      const defaultVal = await timedEvaluate(
        locator,
        (el) => (el as HTMLInputElement).defaultValue,
      );
      if (defaultVal === null || defaultVal === undefined || defaultVal === "")
        return null;
      if (fieldType === "number") {
        const num = Number(defaultVal);
        return Number.isFinite(num) ? num : null;
      }
      return String(defaultVal);
    }

    if (
      fieldType === "select" &&
      (descriptor.tagName ?? "").toLowerCase() === "select"
    ) {
      const defaultVal = await timedEvaluate(locator, (el) => {
        const selectEl = el as HTMLSelectElement;
        const defaultOpt = Array.from(selectEl.options).find(
          (o) => o.defaultSelected,
        );
        return defaultOpt?.value ?? null;
      });
      return defaultVal ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

export function buildVisibleFieldDescriptors(
  visibleFieldIds: string[],
  fieldsByFingerprint: Map<string, FieldEntry>,
  fieldIdToFingerprint: Map<string, string>,
): VisibleFieldDescriptor[] {
  const descriptors: VisibleFieldDescriptor[] = [];

  for (const fieldId of visibleFieldIds) {
    const fingerprint = fieldIdToFingerprint.get(fieldId);
    if (!fingerprint) continue;
    const field = fieldsByFingerprint.get(fingerprint);
    if (!field) continue;

    descriptors.push({
      fieldId: field.id,
      controlType: field.controlType ?? "unknown",
      type: field.type,
      selectors: field.selectors,
      defaultValue: field.defaultValue,
      tagName: undefined,
      roleAttr: undefined,
      inputType: undefined,
    });
  }

  return descriptors;
}

export async function captureFieldStateSnapshot(
  page: Page,
  descriptors: VisibleFieldDescriptor[],
  scopeLocator?: Locator,
): Promise<FieldStateSnapshotEntry[]> {
  const results: FieldStateSnapshotEntry[] = [];

  for (const descriptor of descriptors) {
    try {
      const locator = resolveLocator(page, descriptor.selectors, scopeLocator);
      if (!locator) {
        results.push({
          fieldId: descriptor.fieldId,
          controlType: descriptor.controlType,
          current_value: null,
          current_label: null,
          default_value: null,
          value_source: "none",
          capture_ok: false,
          capture_error: "no_selector",
        });
        continue;
      }

      const count = await locator.count();
      if (count === 0) {
        results.push({
          fieldId: descriptor.fieldId,
          controlType: descriptor.controlType,
          current_value: null,
          current_label: null,
          default_value: null,
          value_source: "none",
          capture_ok: false,
          capture_error: "not_found",
        });
        continue;
      }
      if (count > 1) {
        results.push({
          fieldId: descriptor.fieldId,
          controlType: descriptor.controlType,
          current_value: null,
          current_label: null,
          default_value: null,
          value_source: "none",
          capture_ok: false,
          capture_error: "ambiguous",
        });
        continue;
      }

      const domMeta = await timedEvaluate(locator, (el) => {
        const tag = el.tagName?.toLowerCase() ?? "";
        return {
          tagName: tag,
          roleAttr: el.getAttribute("role") ?? "",
          inputType:
            tag === "input" ? ((el as HTMLInputElement).type ?? "") : "",
        };
      });

      const enrichedDescriptor: VisibleFieldDescriptor = {
        ...descriptor,
        tagName: domMeta?.tagName || descriptor.tagName,
        roleAttr: domMeta?.roleAttr || descriptor.roleAttr,
        inputType: domMeta?.inputType || descriptor.inputType,
      };

      const meta = buildMeta(enrichedDescriptor);
      const state = await readControlState(locator, meta);

      const currentValue = state.currentValue ?? null;
      const currentLabel = state.currentLabel ?? null;
      const defaultValue = await readDefaultValue(locator, enrichedDescriptor);
      const valueSource = valueSourceForControlType(
        descriptor.controlType,
        descriptor.type,
      );

      results.push({
        fieldId: descriptor.fieldId,
        controlType: descriptor.controlType,
        current_value: currentValue,
        current_label: currentLabel,
        default_value: defaultValue,
        value_source: valueSource,
        capture_ok: true,
      });
    } catch (error) {
      results.push({
        fieldId: descriptor.fieldId,
        controlType: descriptor.controlType,
        current_value: null,
        current_label: null,
        default_value: null,
        value_source: "none",
        capture_ok: false,
        capture_error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
