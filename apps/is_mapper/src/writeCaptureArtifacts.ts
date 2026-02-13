import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMap, type FieldEntry, type NavStep, type PageEntry, type Selector, type UiMap } from "@is-browser/contract";
import {
  buildCaptureSchema,
  buildCaptureVerifyReport,
  captureSchemaToFormYaml,
  type CaptureSchema,
  type CaptureVerifyReport,
  type SnapshotOverlayEntry
} from "./captureContract.js";
import { type FieldStateSnapshotEntry } from "./clickCapture.js";

export type CaptureArtifacts = {
  schema: CaptureSchema;
  verifyReport: CaptureVerifyReport;
  paths: {
    schema: string;
    form: string;
    verify: string;
  };
};

type LegacyLocator = {
  kind?: string;
  role?: string;
  name?: string;
  text?: string;
  value?: string;
};

type LegacySelectorCandidate = {
  kind?: string;
  locator?: LegacyLocator;
  value?: string;
};

type LegacyField = {
  fieldKey?: string;
  sourceFieldId?: string;
  fieldId?: string;
  label?: string;
  labelQuality?: string;
  groupKey?: string;
  groupTitle?: string;
  groupOrder?: number;
  controlType?: string;
  valueType?: string;
  selectors?: LegacySelectorCandidate[];
  currentValue?: unknown;
  currentLabel?: string;
  defaultValue?: unknown;
  readonly?: boolean;
  visibility?: { visible?: boolean; enabled?: boolean };
  constraints?: {
    min?: number;
    max?: number;
    step?: number;
    pattern?: string;
    enum?: string[];
    options?: Array<{ value: string; label?: string }>;
  };
};

type LegacyContainer = {
  containerKey?: string;
  pageKey?: string;
  sourceNodeId?: string;
  title?: string;
  type?: string;
  url?: string;
  normalizedUrl?: string;
  urlNormalized?: string;
  breadcrumb?: string[];
  navPath?: Array<{
    action?: string;
    url?: string;
    label?: string;
    kind?: NavStep["kind"];
    frameUrl?: string;
    selector?: LegacyLocator | Selector;
  }>;
  actions?: Array<{
    label?: string;
    selector?: LegacyLocator | Selector;
  }>;
  fields?: LegacyField[];
  openedBy?: {
    fieldKey?: string;
  };
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function controlTypeToFieldType(controlType: string | undefined): FieldEntry["type"] {
  switch ((controlType ?? "").toLowerCase()) {
    case "switch":
    case "checkbox":
      return "checkbox";
    case "number":
    case "spinbutton":
      return "number";
    case "dropdown":
    case "dropdown_native":
    case "dropdown_aria":
      return "select";
    case "radio_group":
      return "radio";
    case "button":
    case "button_dialog":
      return "button";
    case "textbox":
      return "text";
    default:
      return "text";
  }
}

function legacyLocatorToSelector(locator: LegacyLocator | Selector | undefined): Selector | undefined {
  if (!locator) return undefined;

  const kind = normalizeText((locator as LegacyLocator).kind);
  if (!kind) return undefined;

  if (kind === "role") {
    const role = normalizeText((locator as LegacyLocator).role);
    const name = normalizeText((locator as LegacyLocator).name);
    if (!role || !name) return undefined;
    return { kind: "role", role, name };
  }

  if (kind === "label") {
    const value = normalizeText((locator as LegacyLocator).value || (locator as LegacyLocator).text);
    if (!value) return undefined;
    return { kind: "label", value };
  }

  if (kind === "text") {
    const value = normalizeText((locator as LegacyLocator).value || (locator as LegacyLocator).text);
    if (!value) return undefined;
    return { kind: "text", value };
  }

  if (kind === "css") {
    const value = normalizeText((locator as LegacyLocator).value);
    if (!value) return undefined;
    return { kind: "css", value };
  }

  return undefined;
}

function legacyFieldSelectors(field: LegacyField): Selector[] {
  const selectors: Selector[] = [];
  const seen = new Set<string>();
  for (const candidate of field.selectors ?? []) {
    const mapped = legacyLocatorToSelector(candidate.locator);
    if (!mapped) continue;
    const key = JSON.stringify(mapped);
    if (seen.has(key)) continue;
    seen.add(key);
    selectors.push(mapped);
  }
  return selectors;
}

function asFieldEntry(
  pageId: string,
  field: LegacyField,
  index: number
): FieldEntry {
  const selectors = legacyFieldSelectors(field);
  const type = controlTypeToFieldType(field.controlType);
  const id = normalizeText(field.sourceFieldId) || normalizeText(field.fieldKey) || `${pageId}.field-${index + 1}`;
  const currentValue = field.currentValue;
  const defaultValue = field.defaultValue;
  return {
    id,
    fieldId: normalizeText(field.fieldId) || undefined,
    label: normalizeText(field.label) || undefined,
    labelQuality: (field.labelQuality as FieldEntry["labelQuality"]) || undefined,
    type,
    selectors,
    pageId,
    groupKey: normalizeText(field.groupKey) || undefined,
    groupTitle: normalizeText(field.groupTitle) || undefined,
    groupOrder: field.groupOrder,
    controlType: (field.controlType as FieldEntry["controlType"]) || undefined,
    valueType: (field.valueType as FieldEntry["valueType"]) || undefined,
    defaultValue: (defaultValue as FieldEntry["defaultValue"]) ?? null,
    currentValue: (currentValue as FieldEntry["currentValue"]) ?? null,
    currentLabel: normalizeText(field.currentLabel) || undefined,
    options: (field.constraints?.options ?? []).map((option) => ({
      value: normalizeText(option.value),
      label: normalizeText(option.label) || undefined
    })).filter((option) => option.value.length > 0),
    constraints: {
      min: field.constraints?.min,
      max: field.constraints?.max,
      step: field.constraints?.step,
      pattern: field.constraints?.pattern,
      enum: field.constraints?.enum,
      readOnly: field.readonly
    },
    readonly: field.readonly,
    visibility: {
      visible: field.visibility?.visible ?? true,
      enabled: field.visibility?.enabled ?? !(field.readonly ?? false)
    }
  };
}

function legacyToUiMap(payload: { meta?: Record<string, unknown>; pages?: LegacyContainer[]; containers?: LegacyContainer[] }): UiMap {
  const containers = (payload.pages ?? payload.containers ?? []).filter((item): item is LegacyContainer => Boolean(item));
  const pages: PageEntry[] = [];
  const fields: FieldEntry[] = [];
  const fieldByLegacyKey = new Map<string, FieldEntry>();
  const pageIdByContainerKey = new Map<string, string>();
  const modalLinkByFieldKey = new Map<string, { pageId: string; title?: string }>();

  for (const container of containers) {
    const pageId = normalizeText(container.sourceNodeId) || normalizeText(container.pageKey) || normalizeText(container.containerKey) || `page-${pages.length + 1}`;
    pageIdByContainerKey.set(normalizeText(container.containerKey), pageId);
    const navPath = (container.navPath ?? [])
      .map((step) => {
        if (step.action !== "goto" && step.action !== "click") return undefined;
        const selector = legacyLocatorToSelector(step.selector);
        const navStep: NavStep = {
          action: step.action,
          url: normalizeText(step.url) || undefined,
          label: normalizeText(step.label) || undefined,
          kind: step.kind,
          frameUrl: normalizeText(step.frameUrl) || undefined,
          selector
        };
        return navStep;
      })
      .filter((step): step is NavStep => Boolean(step));

    const actions: NonNullable<PageEntry["actions"]> = [];
    for (const action of container.actions ?? []) {
      const selector = legacyLocatorToSelector(action.selector);
      if (!selector) continue;
      actions.push({
        selector,
        label: normalizeText(action.label) || undefined
      });
    }

    pages.push({
      id: pageId,
      title: normalizeText(container.title) || undefined,
      url: normalizeText(container.url) || normalizeText(container.normalizedUrl) || normalizeText(container.urlNormalized) || "",
      breadcrumbs: (container.breadcrumb ?? []).map((crumb) => normalizeText(crumb)).filter(Boolean),
      navPath,
      actions
    });

    for (const [index, field] of (container.fields ?? []).entries()) {
      const entry = asFieldEntry(pageId, field, index);
      fields.push(entry);
      const legacyFieldKey = normalizeText(field.fieldKey);
      if (legacyFieldKey) {
        fieldByLegacyKey.set(legacyFieldKey, entry);
      }
    }
  }

  for (const container of containers) {
    const pageId = pageIdByContainerKey.get(normalizeText(container.containerKey));
    if (!pageId) continue;
    const openerFieldKey = normalizeText(container.openedBy?.fieldKey);
    if (!openerFieldKey) continue;
    modalLinkByFieldKey.set(openerFieldKey, {
      pageId,
      title: normalizeText(container.title) || undefined
    });
  }

  for (const [fieldKey, modal] of modalLinkByFieldKey.entries()) {
    const field = fieldByLegacyKey.get(fieldKey);
    if (!field) continue;
    field.opensModal = true;
    field.interaction = "opensModal";
    field.modalRef = modal.pageId;
    field.modalTitle = modal.title;
  }

  return {
    meta: {
      generatedAt: normalizeText(payload.meta?.generatedAt) || new Date().toISOString(),
      printerUrl: normalizeText(payload.meta?.printerUrl || payload.meta?.printerBaseUrl),
      firmware: normalizeText(payload.meta?.firmware) || undefined,
      deviceModel: normalizeText(payload.meta?.deviceModel) || undefined,
      schemaVersion: "1.1"
    },
    pages,
    fields
  };
}

function isRawUiMapPayload(payload: unknown): payload is UiMap {
  const probe = payload as UiMap;
  return Boolean(probe?.meta?.printerUrl && Array.isArray(probe.pages) && Array.isArray(probe.fields));
}

async function buildSnapshotOverlayFromClickLog(
  clickLogPath: string
): Promise<Map<string, SnapshotOverlayEntry> | undefined> {
  try {
    await access(clickLogPath);
  } catch {
    return undefined;
  }

  try {
    const raw = await readFile(clickLogPath, "utf8");
    const parsed = JSON.parse(raw) as {
      clicks?: Array<{ fieldStateSnapshot?: FieldStateSnapshotEntry[] }>;
    };

    const overlay = new Map<string, SnapshotOverlayEntry>();
    for (const click of parsed.clicks ?? []) {
      for (const snap of click.fieldStateSnapshot ?? []) {
        if (!snap.capture_ok) continue;
        const existing = overlay.get(snap.fieldId);
        const currentValue = snap.current_value !== null && snap.current_value !== undefined
          ? snap.current_value
          : existing?.current_value ?? null;
        const defaultValue = snap.default_value !== null && snap.default_value !== undefined
          ? snap.default_value
          : existing?.default_value ?? null;
        const currentLabel = snap.current_label !== null
          ? snap.current_label
          : existing?.current_label ?? null;

        overlay.set(snap.fieldId, {
          current_value: currentValue,
          current_label: currentLabel,
          default_value: defaultValue
        });
      }
    }

    return overlay.size > 0 ? overlay : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCaptureArtifacts(
  map: UiMap,
  distDir = "dist",
  snapshotOverlay?: Map<string, SnapshotOverlayEntry>
): Promise<CaptureArtifacts> {
  const schema = buildCaptureSchema(map, snapshotOverlay);
  const verifyReport = buildCaptureVerifyReport(schema);

  await mkdir(distDir, { recursive: true });
  const schemaPath = path.join(distDir, "ui_schema.json");
  const formPath = path.join(distDir, "ui_form.yaml");
  const verifyPath = path.join(distDir, "verify_report.json");

  await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  await writeFile(formPath, captureSchemaToFormYaml(schema), "utf8");
  await writeFile(verifyPath, `${JSON.stringify(verifyReport, null, 2)}\n`, "utf8");

  return {
    schema,
    verifyReport,
    paths: {
      schema: schemaPath,
      form: formPath,
      verify: verifyPath
    }
  };
}

export async function writeCaptureArtifactsFromMapPath(
  mapPath: string,
  distDir = "dist"
): Promise<CaptureArtifacts> {
  const clickLogPath = path.join(path.dirname(path.resolve(mapPath)), "click-log.json");
  const snapshotOverlay = await buildSnapshotOverlayFromClickLog(clickLogPath);

  try {
    const map = await readMap(mapPath);
    const artifacts = await writeCaptureArtifacts(map, distDir, snapshotOverlay);
    await reconcileClickLogWithFieldRecords(mapPath, artifacts);
    return artifacts;
  } catch {
    const raw = await readFile(mapPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRawUiMapPayload(parsed)) {
      const artifacts = await writeCaptureArtifacts(parsed, distDir, snapshotOverlay);
      await reconcileClickLogWithFieldRecords(mapPath, artifacts);
      return artifacts;
    }
    const normalized = legacyToUiMap(parsed as { meta?: Record<string, unknown>; pages?: LegacyContainer[]; containers?: LegacyContainer[] });
    const artifacts = await writeCaptureArtifacts(normalized, distDir, snapshotOverlay);
    await reconcileClickLogWithFieldRecords(mapPath, artifacts);
    return artifacts;
  }
}

async function reconcileClickLogWithFieldRecords(mapPath: string, artifacts: CaptureArtifacts): Promise<void> {
  const clickLogPath = path.join(path.dirname(path.resolve(mapPath)), "click-log.json");
  try {
    await access(clickLogPath);
  } catch {
    return;
  }

  const sourceFieldIds = new Set(
    artifacts.schema.fieldRecords.map((record) => record.source_field_id).filter(Boolean)
  );
  const raw = await readFile(clickLogPath, "utf8");
  const parsed = JSON.parse(raw) as {
    clicks?: Array<{ newlyDiscoveredFieldIds?: string[] }>;
  };
  const discovered = new Set<string>();
  for (const click of parsed.clicks ?? []) {
    for (const id of click.newlyDiscoveredFieldIds ?? []) {
      const normalized = String(id ?? "").trim();
      if (!normalized) continue;
      discovered.add(normalized);
    }
  }
  const missing = Array.from(discovered).filter((id) => !sourceFieldIds.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Click-log reconciliation failed: ${missing.length} newlyDiscoveredFieldIds missing from FieldRecords (sample: ${missing.slice(0, 8).join(", ")}).`
    );
  }
}
