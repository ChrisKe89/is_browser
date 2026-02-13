import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { ZodError } from "zod";
import { MapSchema, type FieldEntry, type UiMap } from "@is-browser/contract";
import { migrateDatabase } from "./migrations.js";

type ControlType =
  | "text"
  | "number"
  | "textarea"
  | "select"
  | "radio"
  | "switch"
  | "button";

export type ImportSummary = {
  pages: number;
  settings: number;
  selectors: number;
  options: number;
  navSteps: number;
};

type SettingOption = {
  key: string;
  label: string;
  sortOrder: number;
};

function toControlType(type: FieldEntry["type"]): ControlType {
  switch (type) {
    case "checkbox":
      return "switch";
    case "text":
    case "number":
    case "textarea":
    case "select":
    case "radio":
    case "button":
      return type;
    default:
      return "text";
  }
}

function buildSettingOptions(
  field: FieldEntry,
  controlType: ControlType,
): SettingOption[] {
  if (controlType === "switch") {
    return [
      { key: "On", label: "On", sortOrder: 1 },
      { key: "Off", label: "Off", sortOrder: 2 },
    ];
  }

  if (controlType !== "select" && controlType !== "radio") {
    return [];
  }

  const enumValues = field.constraints?.enum ?? [];
  const deduped = new Set<string>();
  const options: SettingOption[] = [];
  enumValues.forEach((value, index) => {
    const normalized = String(value);
    if (deduped.has(normalized)) {
      return;
    }
    deduped.add(normalized);
    options.push({ key: normalized, label: normalized, sortOrder: index + 1 });
  });
  return options;
}

function formatIssuePath(pathParts: Array<string | number>): string {
  if (pathParts.length === 0) {
    return "(root)";
  }
  return pathParts.join(".");
}

function parseMapPayload(payload: unknown): UiMap {
  try {
    return MapSchema.parse(payload);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid UI map payload: ${details}`);
    }
    throw error;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function importUiMapFile(
  dbPath: string,
  mapPath: string,
): Promise<ImportSummary> {
  const raw = await readFile(mapPath, "utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid UI map JSON at ${mapPath}: ${toErrorMessage(error)}`,
    );
  }
  return importUiMapToDatabase(dbPath, payload);
}

export async function importUiMapToDatabase(
  dbPath: string,
  payload: unknown,
): Promise<ImportSummary> {
  const map = parseMapPayload(payload);
  await migrateDatabase(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  const upsertPage = db.prepare(`
INSERT INTO ui_page (
  id, title, url, source_generated_at, source_printer_url, source_firmware, source_schema_version, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  url = excluded.url,
  source_generated_at = excluded.source_generated_at,
  source_printer_url = excluded.source_printer_url,
  source_firmware = excluded.source_firmware,
  source_schema_version = excluded.source_schema_version,
  updated_at = excluded.updated_at
`);

  const clearPageNavSteps = db.prepare(
    "DELETE FROM ui_page_nav_step WHERE page_id = ?",
  );
  const insertPageNavStep = db.prepare(`
INSERT INTO ui_page_nav_step (
  page_id, step_index, action, target_url, selector_kind, selector_role, selector_name, selector_value
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

  const upsertSetting = db.prepare(`
INSERT INTO ui_setting (
  id, page_id, label, control_type, min_value, max_value, pattern, read_only, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  page_id = excluded.page_id,
  label = excluded.label,
  control_type = excluded.control_type,
  min_value = excluded.min_value,
  max_value = excluded.max_value,
  pattern = excluded.pattern,
  read_only = excluded.read_only,
  updated_at = excluded.updated_at
`);

  const clearSettingSelectors = db.prepare(
    "DELETE FROM ui_setting_selector WHERE setting_id = ?",
  );
  const insertSettingSelector = db.prepare(`
INSERT INTO ui_setting_selector (
  setting_id, priority, kind, role, name, value
)
VALUES (?, ?, ?, ?, ?, ?)
`);

  const clearSettingOptions = db.prepare(
    "DELETE FROM ui_setting_option WHERE setting_id = ?",
  );
  const insertSettingOption = db.prepare(`
INSERT INTO ui_setting_option (
  setting_id, option_key, option_label, sort_order
)
VALUES (?, ?, ?, ?)
`);

  const now = new Date().toISOString();
  const summary: ImportSummary = {
    pages: 0,
    settings: 0,
    selectors: 0,
    options: 0,
    navSteps: 0,
  };

  let transactionOpen = false;
  try {
    db.exec("BEGIN");
    transactionOpen = true;

    for (const page of map.pages) {
      try {
        upsertPage.run(
          page.id,
          page.title ?? null,
          page.url,
          map.meta.generatedAt,
          map.meta.printerUrl,
          map.meta.firmware ?? null,
          map.meta.schemaVersion ?? null,
          now,
        );
        summary.pages += 1;

        clearPageNavSteps.run(page.id);
        for (let index = 0; index < (page.navPath?.length ?? 0); index += 1) {
          const step = page.navPath?.[index];
          if (!step) {
            continue;
          }
          if (step.action === "goto" && !step.url) {
            throw new Error(`navPath[${index}] has action "goto" but no url`);
          }
          if (step.action === "click" && !step.selector) {
            throw new Error(
              `navPath[${index}] has action "click" but no selector`,
            );
          }

          insertPageNavStep.run(
            page.id,
            index,
            step.action,
            step.url ?? null,
            step.selector?.kind ?? null,
            step.selector?.role ?? null,
            step.selector?.name ?? null,
            step.selector?.value ?? null,
          );
          summary.navSteps += 1;
        }
      } catch (error) {
        throw new Error(`Invalid page "${page.id}": ${toErrorMessage(error)}`);
      }
    }

    for (const field of map.fields) {
      try {
        const controlType = toControlType(field.type);
        upsertSetting.run(
          field.id,
          field.pageId,
          field.label ?? null,
          controlType,
          field.constraints?.min ?? null,
          field.constraints?.max ?? null,
          field.constraints?.pattern ?? null,
          field.constraints?.readOnly ? 1 : 0,
          now,
        );
        summary.settings += 1;

        clearSettingSelectors.run(field.id);
        for (let index = 0; index < field.selectors.length; index += 1) {
          const selector = field.selectors[index];
          insertSettingSelector.run(
            field.id,
            index + 1,
            selector.kind,
            selector.role ?? null,
            selector.name ?? null,
            selector.value ?? null,
          );
          summary.selectors += 1;
        }

        const options = buildSettingOptions(field, controlType);
        clearSettingOptions.run(field.id);
        options.forEach((option) => {
          insertSettingOption.run(
            field.id,
            option.key,
            option.label,
            option.sortOrder,
          );
          summary.options += 1;
        });
      } catch (error) {
        throw new Error(
          `Invalid setting "${field.id}": ${toErrorMessage(error)}`,
        );
      }
    }

    db.exec("COMMIT");
    transactionOpen = false;
    return summary;
  } catch (error) {
    if (transactionOpen) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    db.close();
  }
}
