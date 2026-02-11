import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "./migrations.js";

export type CsvOptionImportSummary = {
  rowsRead: number;
  settingsUpdated: number;
  settingsUnchanged: number;
  optionsWritten: number;
  skippedMissingSetting: number;
  skippedUnsupportedType: number;
};

function parseCsvLine(line: string): string[] {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      columns.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  columns.push(current);
  return columns;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function splitEnumValues(raw: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of raw.split("|")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

function mergeUnique(existing: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of [...existing, ...extra]) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    merged.push(value);
  }

  return merged;
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export async function importFieldOptionsFromCsvFile(
  dbPath: string,
  csvPath: string
): Promise<CsvOptionImportSummary> {
  await migrateDatabase(dbPath);
  const raw = await readFile(csvPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const summary: CsvOptionImportSummary = {
    rowsRead: 0,
    settingsUpdated: 0,
    settingsUnchanged: 0,
    optionsWritten: 0,
    skippedMissingSetting: 0,
    skippedUnsupportedType: 0
  };

  if (lines.length < 2) {
    return summary;
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const headerIndex = (name: string): number => headers.indexOf(name);
  const fieldIdIndex = headerIndex("field_id");
  const typeIndex = headerIndex("type");
  const enumValuesIndex = headerIndex("enum_values");

  if (fieldIdIndex < 0 || typeIndex < 0 || enumValuesIndex < 0) {
    return summary;
  }

  const csvOptionsBySetting = new Map<string, string[]>();
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const columns = parseCsvLine(lines[rowIndex]);
    const settingId = (columns[fieldIdIndex] ?? "").trim();
    const controlType = (columns[typeIndex] ?? "").trim().toLowerCase();
    const rawEnumValues = (columns[enumValuesIndex] ?? "").trim();
    summary.rowsRead += 1;

    if (!settingId || !rawEnumValues) {
      continue;
    }
    if (controlType !== "select" && controlType !== "radio") {
      continue;
    }

    const values = splitEnumValues(rawEnumValues);
    if (!values.length) {
      continue;
    }

    const existing = csvOptionsBySetting.get(settingId) ?? [];
    csvOptionsBySetting.set(settingId, mergeUnique(existing, values));
  }

  if (!csvOptionsBySetting.size) {
    return summary;
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  const selectSetting = db.prepare(
    "SELECT id, control_type FROM ui_setting WHERE id = ?"
  );
  const selectExistingOptions = db.prepare(
    "SELECT option_key FROM ui_setting_option WHERE setting_id = ? ORDER BY sort_order"
  );
  const clearOptions = db.prepare("DELETE FROM ui_setting_option WHERE setting_id = ?");
  const insertOption = db.prepare(
    "INSERT INTO ui_setting_option (setting_id, option_key, option_label, sort_order) VALUES (?, ?, ?, ?)"
  );

  let transactionOpen = false;
  try {
    db.exec("BEGIN");
    transactionOpen = true;

    for (const [settingId, csvOptions] of csvOptionsBySetting.entries()) {
      const setting = selectSetting.get(settingId) as
        | { id: string; control_type: string }
        | undefined;

      if (!setting) {
        summary.skippedMissingSetting += 1;
        continue;
      }
      if (setting.control_type !== "select" && setting.control_type !== "radio") {
        summary.skippedUnsupportedType += 1;
        continue;
      }

      const existingOptions = selectExistingOptions
        .all(settingId)
        .map((row) => String((row as { option_key: string }).option_key));
      const mergedOptions = mergeUnique(existingOptions, csvOptions);

      if (arraysEqual(existingOptions, mergedOptions)) {
        summary.settingsUnchanged += 1;
        continue;
      }

      clearOptions.run(settingId);
      for (let index = 0; index < mergedOptions.length; index += 1) {
        const value = mergedOptions[index];
        insertOption.run(settingId, value, value, index + 1);
        summary.optionsWritten += 1;
      }
      summary.settingsUpdated += 1;
    }

    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    db.close();
  }

  return summary;
}

