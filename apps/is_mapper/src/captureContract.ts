import { createHash } from "node:crypto";
import {
  type FieldEntry,
  type NavStep,
  type PageEntry,
  type Selector,
  type UiMap,
} from "@is-browser/contract";
import { slugify } from "./utils.js";

type PrimitiveValue = string | number | boolean | null;

const ACTION_LABEL_RE = /^(save|apply|ok|cancel|close|done)$/i;
const REQUIRED_MARK_RE = /\*\s*$/;

export type CaptureSelector =
  | {
      kind: "role";
      role: string;
      name: string;
      exact: true;
      stability?: "stable" | "fragile";
    }
  | {
      kind: "label";
      text: string;
      exact: true;
      stability?: "stable" | "fragile";
    }
  | { kind: "css"; value: string; stability?: "stable" | "fragile" };

export type CaptureNavStep = {
  action: "goto" | "click";
  url?: string;
  label?: string;
  kind?: NavStep["kind"];
  selector?: CaptureSelector;
  frameUrl?: string;
};

export type CaptureContainerAction = {
  label: string;
  kind: "save" | "cancel" | "close" | "unknown";
  selector: CaptureSelector;
};

export type CaptureContainer = {
  container_id: string;
  containerKey: string;
  type: "page" | "modal";
  title: string;
  page: string;
  breadcrumb: string[];
  frameContext: {
    inFrame: boolean;
    frameUrl: string | null;
  };
  navPath: CaptureNavStep[];
  actions: CaptureContainerAction[];
};

export type CaptureSettingType =
  | "textbox"
  | "spinbutton"
  | "checkbox"
  | "switch"
  | "radio_group"
  | "dropdown_native"
  | "dropdown_aria"
  | "button_dialog"
  | "text_display"
  | "table";

export type FieldRecord = {
  field_id: string;
  source_field_id: string;
  page: string;
  breadcrumb: string[];
  container: {
    type: "page" | "modal";
    title: string;
  };
  group: {
    title: string;
    order: number;
  };
  control: {
    primary_selector: {
      role: string;
      name: string;
    };
    fallback_selectors: CaptureSelector[];
    canonical_control_id: string;
  };
  context: {
    frame_url: string | null;
    in_modal: boolean;
    modal_title: string | null;
  };
  value: {
    value_type: "string" | "number" | "boolean" | "enum" | "table";
    default_value: PrimitiveValue;
    current_value: PrimitiveValue;
    current_label: string | null;
    value_quality: "high" | "medium" | "low" | "unknown";
    value_quality_reason?: string;
    is_default: boolean;
  };
  options: Array<{ value: string; label: string }>;
  constraints: {
    enum?: string[];
    min?: number;
    max?: number;
    step?: number;
    pattern?: string;
    required?: boolean;
  };
  type: CaptureSettingType;
  readonly: boolean;
  visibility: {
    visible: boolean;
    enabled: boolean;
  };
  selectorProof: {
    resolvedBy: "primary" | number;
    count: number;
    unstable?: boolean;
    diagnostics?: string[];
  };
  settingKey: string;
  containerKey: string;
};

export type CaptureSetting = FieldRecord;

export type CaptureSchema = {
  meta: {
    generatedAt: string;
    printerBaseUrl: string;
    deviceProfile: { model: string | null; firmware: string | null } | null;
    schemaVersion: string;
  };
  containers: CaptureContainer[];
  fieldRecords: FieldRecord[];
  settings: FieldRecord[];
};

export type CaptureVerifyReport = {
  meta: {
    generatedAt: string;
    schemaVersion: string;
  };
  counts: {
    totalSettings: number;
    byType: Record<string, number>;
    unstableSelectors: number;
    missingEnums: number;
    missingCurrentValue: number;
  };
  unstableSelectors: Array<{
    field_id: string;
    container_id: string;
    label: string;
    resolvedBy: "primary" | number;
    count: number;
    diagnostics?: string[];
  }>;
  missingEnums: Array<{
    field_id: string;
    container_id: string;
    label: string;
    type: CaptureSettingType;
    reason: string;
  }>;
  missingCurrentValue: Array<{
    field_id: string;
    container_id: string;
    label: string;
    type: CaptureSettingType;
  }>;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeUrlIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.hash}`;
  } catch {
    return normalizeText(url);
  }
}

function mapSelector(
  selector: Selector | undefined,
): CaptureSelector | undefined {
  if (!selector) return undefined;
  if (selector.kind === "css") {
    const value = normalizeText(selector.value);
    if (!value) return undefined;
    return {
      kind: "css",
      value,
      stability: value.startsWith("#") ? "stable" : "fragile",
    };
  }
  if (selector.kind === "label" || selector.kind === "text") {
    const text = normalizeText(selector.value);
    if (!text) return undefined;
    return { kind: "label", text, exact: true, stability: "stable" };
  }
  if (selector.kind === "role") {
    const role = normalizeText(selector.role).toLowerCase();
    const name = normalizeText(selector.name);
    if (!role || !name) return undefined;
    return { kind: "role", role, name, exact: true, stability: "stable" };
  }
  return undefined;
}

function actionKind(label: string): CaptureContainerAction["kind"] {
  const normalized = normalizeText(label).toLowerCase();
  if (/save|apply|ok/.test(normalized)) return "save";
  if (/cancel/.test(normalized)) return "cancel";
  if (/close|done/.test(normalized)) return "close";
  return "unknown";
}

function inferContainerType(page: PageEntry): "page" | "modal" {
  const probe = `${page.id} ${page.title ?? ""}`.toLowerCase();
  if (probe.includes("modal") || probe.includes("dialog")) return "modal";
  return (page.navPath ?? []).some((step) => step.kind === "modal_open")
    ? "modal"
    : "page";
}

function inferBreadcrumb(page: PageEntry): string[] {
  const isNoise = (label: string): boolean => {
    const normalized = label.toLowerCase();
    if (["span", "input", "button", "a", "div", "label"].includes(normalized))
      return true;
    if (label.length > 80) return true;
    return false;
  };
  if (page.breadcrumbs?.length) {
    const seen = new Set<string>();
    return page.breadcrumbs
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .filter((item) => !isNoise(item))
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  const seen = new Set<string>();
  return (page.navPath ?? [])
    .filter((step) => step.action === "click")
    .map((step) =>
      normalizeText(step.label ?? step.selector?.name ?? step.selector?.value),
    )
    .filter(
      (label) =>
        label.length > 0 && !ACTION_LABEL_RE.test(label) && !isNoise(label),
    )
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function inferFrameContext(page: PageEntry): {
  inFrame: boolean;
  frameUrl: string | null;
} {
  for (let i = (page.navPath ?? []).length - 1; i >= 0; i -= 1) {
    const frameUrl = normalizeText(page.navPath?.[i]?.frameUrl);
    if (frameUrl) {
      return { inFrame: true, frameUrl: normalizeUrlIdentity(frameUrl) };
    }
  }
  return { inFrame: false, frameUrl: null };
}

function dedupeNavPath(path: CaptureNavStep[]): CaptureNavStep[] {
  const deduped: CaptureNavStep[] = [];
  let lastKey = "";
  for (const step of path) {
    const key = JSON.stringify({
      action: step.action,
      label: normalizeText(step.label),
      kind: step.kind,
      selector: step.selector,
      url: normalizeText(step.url),
      frameUrl: normalizeText(step.frameUrl),
    });
    if (key === lastKey) continue;
    deduped.push(step);
    lastKey = key;
  }
  return deduped;
}

function buildContainer(page: PageEntry): CaptureContainer {
  const type = inferContainerType(page);
  const title =
    normalizeText(page.title) || normalizeText(page.id) || "Untitled";
  const breadcrumb = inferBreadcrumb(page);
  const frameContext = inferFrameContext(page);
  const navPath = dedupeNavPath(
    (page.navPath ?? [])
      .map((step): CaptureNavStep | undefined => {
        if (step.action === "goto") {
          const url = normalizeText(step.url);
          if (!url) return undefined;
          return { action: "goto", url: normalizeUrlIdentity(url) };
        }
        if (step.action !== "click") return undefined;
        const label = normalizeText(
          step.label ?? step.selector?.name ?? step.selector?.value,
        );
        if (
          ACTION_LABEL_RE.test(label) &&
          step.kind !== "modal_open" &&
          step.kind !== "modal_close"
        ) {
          return undefined;
        }
        return {
          action: "click",
          kind: step.kind,
          label: label || undefined,
          frameUrl: normalizeText(step.frameUrl) || undefined,
          selector: mapSelector(step.selector),
        };
      })
      .filter((step): step is CaptureNavStep => Boolean(step)),
  );

  const actions = (page.actions ?? [])
    .map((action) => {
      const label = normalizeText(
        action.label ?? action.selector.name ?? action.selector.value,
      );
      const selector = mapSelector(action.selector);
      if (!label || !selector) return undefined;
      return {
        label,
        kind: actionKind(label),
        selector,
      } as CaptureContainerAction;
    })
    .filter((action): action is CaptureContainerAction => Boolean(action));

  const pathPart = slugify(breadcrumb.join("-") || title);
  const titlePart = slugify(title);
  const pagePart = slugify(page.id);
  const container_id = `container.${type}.${pathPart}.${titlePart}.${pagePart}`;

  return {
    container_id,
    containerKey: container_id,
    type,
    title,
    page: page.id,
    breadcrumb,
    frameContext,
    navPath,
    actions,
  };
}

function inferSettingType(field: FieldEntry): CaptureSettingType {
  if (field.opensModal || field.interaction === "opensModal")
    return "button_dialog";
  if (field.controlType === "radio_group" || field.type === "radio")
    return "radio_group";
  if (field.controlType === "dropdown" || field.type === "select") {
    return field.valueQuality === "native-select"
      ? "dropdown_native"
      : "dropdown_aria";
  }
  if (field.controlType === "switch") return "switch";
  if (field.controlType === "checkbox" || field.type === "checkbox")
    return "checkbox";
  if (field.controlType === "number" || field.type === "number")
    return "spinbutton";
  if (
    (field.readonly || field.constraints?.readOnly) &&
    field.valueQuality === "static-text"
  )
    return "text_display";
  if (field.controlType === "staticTextButton")
    return field.opensModal ? "button_dialog" : "text_display";
  if (
    field.type === "textarea" ||
    field.type === "text" ||
    field.controlType === "textbox"
  ) {
    return field.readonly || field.constraints?.readOnly
      ? "text_display"
      : "textbox";
  }
  return "text_display";
}

function inferValueType(
  type: CaptureSettingType,
): FieldRecord["value"]["value_type"] {
  if (type === "spinbutton") return "number";
  if (type === "checkbox" || type === "switch") return "boolean";
  if (
    type === "radio_group" ||
    type === "dropdown_native" ||
    type === "dropdown_aria"
  )
    return "enum";
  return "string";
}

function normalizePrimitive(
  value: unknown,
  valueType: FieldRecord["value"]["value_type"],
): PrimitiveValue {
  if (value === null || value === undefined) return null;
  if (valueType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (valueType === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
    return Boolean(value);
  }
  return normalizeText(String(value));
}

function pickCanonicalControlId(field: FieldEntry): string {
  for (const selector of field.selectors ?? []) {
    if (selector.kind !== "css") continue;
    const value = normalizeText(selector.value);
    if (value.startsWith("#")) return `id:${value.slice(1)}`;
    const nameMatch = value.match(/\[name\s*=\s*["']([^"']+)["']\]/i);
    if (nameMatch?.[1]) return `name:${nameMatch[1]}`;
  }
  if (field.fieldId) return `field:${field.fieldId}`;
  if (field.label) return `label:${normalizeText(field.label)}`;
  return `source:${field.id}`;
}

function normalizeOptions(
  field: FieldEntry,
): Array<{ value: string; label: string }> {
  const byValue = new Map<string, string>();
  for (const option of field.options ?? []) {
    const value = normalizeText(option.value);
    const label = normalizeText(option.label) || value;
    if (!value) continue;
    if (!byValue.has(value)) byValue.set(value, label);
  }
  if (byValue.size === 0) {
    for (const rawValue of field.constraints?.enum ?? []) {
      const value = normalizeText(rawValue);
      if (!value) continue;
      if (!byValue.has(value)) byValue.set(value, value);
    }
  }
  return Array.from(byValue.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

function inferPrimarySelector(
  field: FieldEntry,
  type: CaptureSettingType,
): { role: string; name: string } {
  const role = (field.selectors ?? []).find(
    (selector) => selector.kind === "role",
  );
  if (role?.role && role.name)
    return { role: normalizeText(role.role), name: normalizeText(role.name) };
  const label =
    normalizeText(field.label) || normalizeText(field.fieldId) || field.id;
  if (type === "radio_group") return { role: "radio", name: label };
  if (type === "dropdown_native" || type === "dropdown_aria")
    return { role: "combobox", name: label };
  if (type === "checkbox" || type === "switch")
    return { role: "checkbox", name: label };
  if (type === "spinbutton") return { role: "spinbutton", name: label };
  if (type === "button_dialog") return { role: "button", name: label };
  return { role: "textbox", name: label };
}

function toCaptureSelector(selector: Selector): CaptureSelector | undefined {
  return mapSelector(selector);
}

function deterministicFieldId(
  container: CaptureContainer,
  groupTitle: string,
  canonicalControlId: string,
): string {
  const pathPart = slugify(container.breadcrumb.join("-") || container.title);
  const containerPart = slugify(container.title);
  const groupPart = slugify(groupTitle);
  const controlPart = slugify(canonicalControlId);
  const identity = [
    container.breadcrumb.join(" > "),
    container.title,
    groupTitle,
    canonicalControlId,
    container.frameContext.frameUrl ?? "",
    container.type === "modal" ? container.title : "",
  ].join("|");
  return `field.${pathPart}.${containerPart}.${groupPart}.${controlPart}.${sha1(identity).slice(0, 10)}`;
}

function valueQuality(
  field: FieldEntry,
  options: Array<{ value: string; label: string }>,
  currentValue: PrimitiveValue,
): { quality: FieldRecord["value"]["value_quality"]; reason?: string } {
  if (
    (field.type === "select" || field.controlType === "dropdown") &&
    options.length === 0
  ) {
    const unknownReason =
      (field.hints ?? [])
        .find((hint) => hint.startsWith("options_unavailable:"))
        ?.replace("options_unavailable:", "") ??
      "unable to enumerate dropdown options";
    return { quality: "unknown", reason: unknownReason };
  }
  if (currentValue === null || currentValue === "")
    return { quality: "low", reason: "missing current value" };
  if (
    field.valueQuality === "native-select" ||
    field.valueQuality === "opened-options"
  )
    return { quality: "high" };
  if (
    field.valueQuality === "trigger-text" ||
    field.valueQuality === "static-text"
  )
    return { quality: "medium" };
  return { quality: "high" };
}

export type SnapshotOverlayEntry = {
  current_value: unknown;
  current_label?: string | null;
  default_value?: unknown;
};

export function buildCaptureSchema(
  map: UiMap,
  snapshotOverlay?: Map<string, SnapshotOverlayEntry>,
): CaptureSchema {
  const containersByPageId = new Map<string, CaptureContainer>();
  for (const page of map.pages) {
    containersByPageId.set(page.id, buildContainer(page));
  }

  const records: FieldRecord[] = [];

  for (const field of map.fields) {
    const container = containersByPageId.get(field.pageId);
    if (!container) continue;

    const type = inferSettingType(field);
    const valueType = inferValueType(type);
    const options = normalizeOptions(field);
    let currentValue = normalizePrimitive(field.currentValue, valueType);
    let defaultValue = normalizePrimitive(field.defaultValue, valueType);
    let overlayLabel: string | null | undefined;

    const overlay = snapshotOverlay?.get(field.id);
    if (overlay) {
      // current_value: last-write-wins — the snapshot is a more recent, accurate re-read
      if (
        overlay.current_value !== null &&
        overlay.current_value !== undefined
      ) {
        const overlayCurrentValue = normalizePrimitive(
          overlay.current_value,
          valueType,
        );
        if (overlayCurrentValue !== null) {
          currentValue = overlayCurrentValue;
        }
      }
      // default_value: only fill nulls — default is set once during initial discovery
      if (
        overlay.default_value !== null &&
        overlay.default_value !== undefined &&
        defaultValue === null
      ) {
        const overlayDefaultValue = normalizePrimitive(
          overlay.default_value,
          valueType,
        );
        if (overlayDefaultValue !== null) {
          defaultValue = overlayDefaultValue;
        }
      }
      overlayLabel = overlay.current_label;
    }

    const quality = valueQuality(field, options, currentValue);
    const canonicalControlId = pickCanonicalControlId(field);
    const groupTitle = normalizeText(field.groupTitle) || "General";
    const groupOrder = field.groupOrder ?? 1;

    const fallback_selectors = (field.selectors ?? [])
      .map((selector) => toCaptureSelector(selector))
      .filter((selector): selector is CaptureSelector => Boolean(selector))
      .filter((selector) => !(selector.kind === "role"));

    const constraintsEnum = Array.from(
      new Set([
        ...(field.constraints?.enum ?? []),
        ...options.map((option) => option.value),
      ]),
    );

    const field_id = deterministicFieldId(
      container,
      groupTitle,
      canonicalControlId,
    );

    records.push({
      field_id,
      source_field_id: field.id,
      settingKey: field_id,
      containerKey: container.container_id,
      page: container.page,
      breadcrumb: container.breadcrumb,
      container: {
        type: container.type,
        title: container.title,
      },
      group: {
        title: groupTitle,
        order: groupOrder,
      },
      control: {
        primary_selector: inferPrimarySelector(field, type),
        fallback_selectors,
        canonical_control_id: canonicalControlId,
      },
      context: {
        frame_url: container.frameContext.frameUrl,
        in_modal: container.type === "modal",
        modal_title: container.type === "modal" ? container.title : null,
      },
      value: {
        value_type: valueType,
        default_value: defaultValue,
        current_value: currentValue,
        current_label:
          (overlayLabel != null ? normalizeText(overlayLabel) : null) ||
          normalizeText(field.currentLabel) ||
          null,
        value_quality: quality.quality,
        value_quality_reason: quality.reason,
        is_default:
          JSON.stringify(defaultValue) === JSON.stringify(currentValue),
      },
      options,
      constraints: {
        enum: constraintsEnum.length ? constraintsEnum : undefined,
        min: field.constraints?.min,
        max: field.constraints?.max,
        step: field.constraints?.step,
        pattern: field.constraints?.pattern,
        required:
          REQUIRED_MARK_RE.test(normalizeText(field.label)) || undefined,
      },
      type,
      readonly: field.readonly ?? field.constraints?.readOnly ?? false,
      visibility: {
        visible: field.visibility?.visible ?? true,
        enabled:
          field.visibility?.enabled ??
          !(field.readonly ?? field.constraints?.readOnly ?? false),
      },
      selectorProof: {
        resolvedBy: "primary",
        count: 1,
      },
    });
  }

  const sortedContainers = Array.from(containersByPageId.values()).sort(
    (a, b) => a.container_id.localeCompare(b.container_id),
  );
  const sortedRecords = records.sort((a, b) =>
    a.field_id.localeCompare(b.field_id),
  );

  const model = normalizeText(map.meta.deviceModel);
  const firmware = normalizeText(map.meta.firmware);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      printerBaseUrl: map.meta.printerUrl,
      deviceProfile:
        model || firmware
          ? { model: model || null, firmware: firmware || null }
          : null,
      schemaVersion: "4.0.0",
    },
    containers: sortedContainers,
    fieldRecords: sortedRecords,
    settings: sortedRecords,
  };
}

export function buildCaptureVerifyReport(
  schema: CaptureSchema,
): CaptureVerifyReport {
  const byType: Record<string, number> = {};
  const unstableSelectors: CaptureVerifyReport["unstableSelectors"] = [];
  const missingEnums: CaptureVerifyReport["missingEnums"] = [];
  const missingCurrentValue: CaptureVerifyReport["missingCurrentValue"] = [];

  for (const setting of schema.fieldRecords) {
    byType[setting.type] = (byType[setting.type] ?? 0) + 1;

    if (setting.selectorProof.count !== 1) {
      unstableSelectors.push({
        field_id: setting.field_id,
        container_id: setting.containerKey,
        label: setting.control.primary_selector.name,
        resolvedBy: setting.selectorProof.resolvedBy,
        count: setting.selectorProof.count,
        diagnostics: setting.selectorProof.diagnostics,
      });
    }

    if (
      (setting.type === "dropdown_native" ||
        setting.type === "dropdown_aria" ||
        setting.type === "radio_group") &&
      setting.visibility.visible &&
      setting.visibility.enabled &&
      setting.options.length === 0
    ) {
      missingEnums.push({
        field_id: setting.field_id,
        container_id: setting.containerKey,
        label: setting.control.primary_selector.name,
        type: setting.type,
        reason:
          setting.value.value_quality_reason ??
          "visible+enabled enum control has empty options[]",
      });
    }

    if (
      setting.value.current_value === null ||
      setting.value.current_value === undefined ||
      setting.value.current_value === ""
    ) {
      missingCurrentValue.push({
        field_id: setting.field_id,
        container_id: setting.containerKey,
        label: setting.control.primary_selector.name,
        type: setting.type,
      });
    }
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      schemaVersion: schema.meta.schemaVersion,
    },
    counts: {
      totalSettings: schema.fieldRecords.length,
      byType,
      unstableSelectors: unstableSelectors.length,
      missingEnums: missingEnums.length,
      missingCurrentValue: missingCurrentValue.length,
    },
    unstableSelectors,
    missingEnums,
    missingCurrentValue,
  };
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value !== "string") return JSON.stringify(value);
  if (value.length === 0) return '""';
  if (/^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function keyName(key: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) return key;
  return JSON.stringify(key);
}

function renderYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value
      .map((item) => {
        if (
          item === null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return `${pad}- ${scalar(item)}`;
        }
        return `${pad}-\n${renderYaml(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entryValue]) => entryValue !== undefined,
    );
    if (entries.length === 0) return `${pad}{}`;
    return entries
      .map(([key, entryValue]) => {
        if (
          entryValue === null ||
          typeof entryValue === "string" ||
          typeof entryValue === "number" ||
          typeof entryValue === "boolean"
        ) {
          return `${pad}${keyName(key)}: ${scalar(entryValue)}`;
        }
        return `${pad}${keyName(key)}:\n${renderYaml(entryValue, indent + 2)}`;
      })
      .join("\n");
  }

  return `${pad}${scalar(value)}`;
}

export function captureSchemaToFormYaml(schema: CaptureSchema): string {
  const containers = schema.containers.map((container) => ({
    container_id: container.container_id,
    type: container.type,
    title: container.title,
    breadcrumb: container.breadcrumb,
    fields: schema.fieldRecords
      .filter((field) => field.containerKey === container.container_id)
      .map((field) => ({
        field_id: field.field_id,
        label: field.control.primary_selector.name,
        type: field.type,
        default: field.value.default_value,
        current: field.value.current_value,
        current_label: field.value.current_label,
        options: field.options,
        constraints: field.constraints,
        readonly: field.readonly,
        visibility: field.visibility,
      })),
  }));

  return `${renderYaml({ meta: schema.meta, containers })}\n`;
}
