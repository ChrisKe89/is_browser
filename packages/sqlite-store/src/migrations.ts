import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type Migration = {
  name: string;
  sql: string;
};

const MIGRATIONS: Migration[] = [
  {
    name: "001_ui_map_core",
    sql: `
CREATE TABLE IF NOT EXISTS ui_page (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT NOT NULL,
  source_generated_at TEXT,
  source_printer_url TEXT,
  source_firmware TEXT,
  source_schema_version TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS ui_setting (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  label TEXT,
  control_type TEXT NOT NULL CHECK (
    control_type IN ('text', 'number', 'textarea', 'select', 'radio', 'switch', 'button')
  ),
  min_value REAL,
  max_value REAL,
  pattern TEXT,
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (page_id) REFERENCES ui_page(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS ui_setting_option (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id TEXT NOT NULL,
  option_key TEXT NOT NULL,
  option_label TEXT,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (setting_id) REFERENCES ui_setting(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (setting_id, option_key)
);

CREATE TABLE IF NOT EXISTS ui_setting_selector (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_id TEXT NOT NULL,
  priority INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('css', 'label', 'text', 'role')),
  role TEXT,
  name TEXT,
  value TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (setting_id) REFERENCES ui_setting(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (setting_id, priority)
);

CREATE TABLE IF NOT EXISTS ui_page_nav_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('goto', 'click')),
  target_url TEXT,
  selector_kind TEXT CHECK (selector_kind IN ('css', 'label', 'text', 'role')),
  selector_role TEXT,
  selector_name TEXT,
  selector_value TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (page_id) REFERENCES ui_page(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (page_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_ui_setting_page_id ON ui_setting(page_id);
CREATE INDEX IF NOT EXISTS idx_ui_setting_option_setting_id ON ui_setting_option(setting_id);
CREATE INDEX IF NOT EXISTS idx_ui_setting_selector_setting_id ON ui_setting_selector(setting_id);
CREATE INDEX IF NOT EXISTS idx_ui_page_nav_step_page_id ON ui_page_nav_step(page_id);
`,
  },
  {
    name: "002_profile_and_run_audit",
    sql: `
CREATE TABLE IF NOT EXISTS config_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT NOT NULL,
  variation TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (account_number, variation)
);

CREATE TABLE IF NOT EXISTS config_profile_value (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  setting_id TEXT NOT NULL,
  value_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (profile_id) REFERENCES config_profile(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (setting_id) REFERENCES ui_setting(id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (profile_id, setting_id)
);

CREATE TABLE IF NOT EXISTS apply_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_number TEXT NOT NULL,
  variation TEXT NOT NULL,
  device_ip TEXT,
  map_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'partial', 'failed')),
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS apply_run_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  setting_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
  message TEXT,
  attempted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (run_id) REFERENCES apply_run(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (setting_id) REFERENCES ui_setting(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_config_profile_identity ON config_profile(account_number, variation);
CREATE INDEX IF NOT EXISTS idx_config_profile_value_profile_id ON config_profile_value(profile_id);
CREATE INDEX IF NOT EXISTS idx_apply_run_identity ON apply_run(account_number, variation);
CREATE INDEX IF NOT EXISTS idx_apply_run_item_run_id ON apply_run_item(run_id);
`,
  },
  {
    name: "003_profile_value_enabled",
    sql: `
ALTER TABLE config_profile_value
ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
`,
  },
  {
    name: "004_operator_discovery_and_resolution",
    sql: `
CREATE TABLE IF NOT EXISTS operator_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_resolution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name TEXT NOT NULL,
  serial TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  variation TEXT NOT NULL DEFAULT 'default',
  model_match TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  UNIQUE (model_name, serial)
);

CREATE INDEX IF NOT EXISTS idx_device_resolution_identity
ON device_resolution(model_name, serial);
CREATE INDEX IF NOT EXISTS idx_device_resolution_account_variation
ON device_resolution(account_number, variation);
`,
  },
];

async function ensureDbDirectory(dbPath: string): Promise<void> {
  const directory = path.dirname(dbPath);
  if (directory && directory !== ".") {
    await mkdir(directory, { recursive: true });
  }
}

function isApplied(db: DatabaseSync, migrationName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS applied FROM schema_migration WHERE name = ? LIMIT 1")
    .get(migrationName) as { applied: number } | undefined;
  return row?.applied === 1;
}

export async function migrateDatabase(dbPath: string): Promise<void> {
  await ensureDbDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`
CREATE TABLE IF NOT EXISTS schema_migration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
`);

    const markApplied = db.prepare(
      "INSERT INTO schema_migration (name, applied_at) VALUES (?, ?)",
    );

    for (const migration of MIGRATIONS) {
      if (isApplied(db, migration.name)) {
        continue;
      }

      let transactionOpen = false;
      try {
        db.exec("BEGIN");
        transactionOpen = true;
        db.exec(migration.sql);
        markApplied.run(migration.name, new Date().toISOString());
        db.exec("COMMIT");
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) {
          db.exec("ROLLBACK");
        }
        throw error;
      }
    }
  } finally {
    db.close();
  }
}
