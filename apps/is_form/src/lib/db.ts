import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { ProfileRecord, UISchemaField } from "./types.js";

type ProfileValueMap = Record<string, unknown>;

const STORABLE_CONTROL_TYPES = new Set([
  "dropdown",
  "radio_group",
  "checkbox",
  "text",
  "number",
]);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(moduleDir, "../..");
const defaultDbPath = path.resolve(appRoot, "state/profile-runner.sqlite");
const defaultSchemaPath = path.resolve(appRoot, "db/schema.sql");
const defaultUiSchemaPath = path.resolve(appRoot, "data/ui_schema_fields.json");

let initialized = false;

function nowIso(): string {
  return new Date().toISOString();
}

function dbPath(): string {
  return process.env.PROFILE_DB_PATH
    ? path.resolve(process.cwd(), process.env.PROFILE_DB_PATH)
    : defaultDbPath;
}

function ensureDbDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as T;
}

export function openDb(): Database.Database {
  const filePath = dbPath();
  ensureDbDirectory(filePath);
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  return db;
}

export function initDatabase(schemaPath = defaultSchemaPath): void {
  const sql = readFileSync(schemaPath, "utf8");
  const db = openDb();
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

export function seedUiSchemaFromFile(uiSchemaPath = defaultUiSchemaPath): number {
  const content = readFileSync(uiSchemaPath, "utf8");
  const fields = JSON.parse(content) as UISchemaField[];
  const db = openDb();
  try {
    const insert = db.prepare(`
      INSERT INTO ui_schema_fields (
        field_id, container_id, page_path, context, label, control_type, value_type,
        options_json, locators_json, disabled, current_value_json, default_value_json, last_seen_at
      ) VALUES (
        @field_id, @container_id, @page_path, @context, @label, @control_type, @value_type,
        @options_json, @locators_json, @disabled, @current_value_json, @default_value_json, @last_seen_at
      )
      ON CONFLICT(field_id) DO UPDATE SET
        container_id=excluded.container_id,
        page_path=excluded.page_path,
        context=excluded.context,
        label=excluded.label,
        control_type=excluded.control_type,
        value_type=excluded.value_type,
        options_json=excluded.options_json,
        locators_json=excluded.locators_json,
        disabled=excluded.disabled,
        current_value_json=excluded.current_value_json,
        default_value_json=excluded.default_value_json,
        last_seen_at=excluded.last_seen_at
    `);

    const transaction = db.transaction((records: UISchemaField[]) => {
      db.exec("DELETE FROM ui_schema_fields");
      const timestamp = nowIso();
      for (const field of records) {
        insert.run({
          field_id: field.field_id,
          container_id: field.container_id,
          page_path: field.page_path,
          context: field.context,
          label: field.label,
          control_type: field.control_type,
          value_type: field.value_type,
          options_json: jsonOrNull(field.options ?? null),
          locators_json: JSON.stringify(field.locators ?? {}),
          disabled:
            typeof field.disabled === "boolean" ? (field.disabled ? 1 : 0) : null,
          current_value_json: jsonOrNull(field.current_value),
          default_value_json: jsonOrNull(field.default_value),
          last_seen_at: timestamp,
        });
      }
    });

    transaction(fields);
    return fields.length;
  } finally {
    db.close();
  }
}

export function initAndSeedDb(): number {
  initDatabase();
  return seedUiSchemaFromFile();
}

export function ensureInitialized(): void {
  if (initialized) {
    return;
  }
  initDatabase();
  const db = openDb();
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM ui_schema_fields")
      .get() as { count: number };
    if (row.count === 0) {
      seedUiSchemaFromFile();
    }
  } finally {
    db.close();
  }
  initialized = true;
}

export function listProfiles(): ProfileRecord[] {
  ensureInitialized();
  const db = openDb();
  try {
    return db
      .prepare(
        "SELECT id, account, name, created_at, updated_at FROM profiles ORDER BY updated_at DESC",
      )
      .all() as ProfileRecord[];
  } finally {
    db.close();
  }
}

export function getProfileById(id: string): ProfileRecord | null {
  ensureInitialized();
  const db = openDb();
  try {
    const row = db
      .prepare("SELECT id, account, name, created_at, updated_at FROM profiles WHERE id = ?")
      .get(id) as ProfileRecord | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export function createProfile(account: string, name?: string): ProfileRecord {
  ensureInitialized();
  const db = openDb();
  const id = randomUUID();
  const now = nowIso();
  try {
    db.prepare(
      "INSERT INTO profiles (id, account, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, account.trim(), name?.trim() || null, now, now);
  } finally {
    db.close();
  }

  const profile = getProfileById(id);
  if (!profile) {
    throw new Error("Profile creation failed");
  }
  return profile;
}

export function updateProfile(
  id: string,
  updates: { account: string; name: string | null },
): ProfileRecord {
  ensureInitialized();
  const db = openDb();
  const now = nowIso();
  try {
    const account = updates.account.trim();
    if (!account) {
      throw new Error("Account is required");
    }
    const result = db
      .prepare(
        "UPDATE profiles SET account = ?, name = ?, updated_at = ? WHERE id = ?",
      )
      .run(account, updates.name?.trim() || null, now, id);
    if (result.changes === 0) {
      throw new Error("Profile not found");
    }
  } finally {
    db.close();
  }

  const profile = getProfileById(id);
  if (!profile) {
    throw new Error("Profile not found");
  }
  return profile;
}

export function getSchemaFields(): UISchemaField[] {
  ensureInitialized();
  const db = openDb();
  try {
    const rows = db
      .prepare(
        "SELECT * FROM ui_schema_fields ORDER BY page_path ASC, context ASC, field_id ASC",
      )
      .all() as Array<{
      field_id: string;
      container_id: string;
      page_path: string;
      context: string;
      label: string;
      control_type: UISchemaField["control_type"];
      value_type: UISchemaField["value_type"];
      options_json: string | null;
      locators_json: string;
      disabled: number | null;
      current_value_json: string | null;
      default_value_json: string | null;
    }>;

    return rows.map((row) => ({
      field_id: row.field_id,
      container_id: row.container_id,
      page_path: row.page_path,
      context: row.context,
      label: row.label,
      control_type: row.control_type,
      value_type: row.value_type,
      options: parseJson<string[]>(row.options_json) ?? undefined,
      locators: parseJson<UISchemaField["locators"]>(row.locators_json) ?? {},
      disabled: row.disabled === null ? undefined : row.disabled === 1,
      current_value: parseJson<unknown>(row.current_value_json),
      default_value: parseJson<unknown>(row.default_value_json),
    }));
  } finally {
    db.close();
  }
}

export function getProfileValues(profileId: string): ProfileValueMap {
  ensureInitialized();
  const db = openDb();
  try {
    const rows = db
      .prepare(
        "SELECT field_id, value_json FROM profile_values WHERE profile_id = ? ORDER BY field_id ASC",
      )
      .all(profileId) as Array<{ field_id: string; value_json: string }>;
    const values: ProfileValueMap = {};
    for (const row of rows) {
      values[row.field_id] = JSON.parse(row.value_json);
    }
    return values;
  } finally {
    db.close();
  }
}

export function upsertProfileValues(profileId: string, values: ProfileValueMap): number {
  ensureInitialized();
  const db = openDb();
  try {
    const allowedFieldRows = db
      .prepare(
        `SELECT field_id FROM ui_schema_fields
         WHERE control_type IN ('dropdown', 'radio_group', 'checkbox', 'text', 'number')`,
      )
      .all() as Array<{ field_id: string }>;
    const allowed = new Set(allowedFieldRows.map((row) => row.field_id));
    const entries = Object.entries(values).filter(([fieldId]) => allowed.has(fieldId));
    const now = nowIso();

    const insert = db.prepare(`
      INSERT INTO profile_values (profile_id, field_id, value_json, updated_at)
      VALUES (@profile_id, @field_id, @value_json, @updated_at)
      ON CONFLICT(profile_id, field_id) DO UPDATE SET
        value_json=excluded.value_json,
        updated_at=excluded.updated_at
    `);

    const tx = db.transaction(() => {
      for (const [fieldId, value] of entries) {
        insert.run({
          profile_id: profileId,
          field_id: fieldId,
          value_json: JSON.stringify(value),
          updated_at: now,
        });
      }
      db.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(now, profileId);
    });

    tx();
    return entries.length;
  } finally {
    db.close();
  }
}

export function exportProfile(profileId: string): {
  account: string;
  profile_id: string;
  values: ProfileValueMap;
} {
  ensureInitialized();
  const profile = getProfileById(profileId);
  if (!profile) {
    throw new Error("Profile not found");
  }

  const schema = getSchemaFields();
  const storableFieldIds = new Set(
    schema
      .filter((field) => STORABLE_CONTROL_TYPES.has(field.control_type))
      .map((field) => field.field_id),
  );
  const rawValues = getProfileValues(profileId);
  const filteredValues: ProfileValueMap = {};
  for (const [fieldId, value] of Object.entries(rawValues)) {
    if (storableFieldIds.has(fieldId)) {
      filteredValues[fieldId] = value;
    }
  }

  return {
    account: profile.account,
    profile_id: profile.id,
    values: filteredValues,
  };
}

function runCli(): void {
  if (process.argv.includes("--init")) {
    const count = initAndSeedDb();
    console.log(`DB initialized and seeded ${count} schema fields`);
    return;
  }
  console.log("Usage: tsx src/lib/db.ts --init");
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (thisFile === invokedFile) {
  try {
    runCli();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
