PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_values (
  profile_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, field_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE TABLE IF NOT EXISTS ui_schema_fields (
  field_id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  context TEXT NOT NULL,
  label TEXT NOT NULL,
  control_type TEXT NOT NULL,
  value_type TEXT NOT NULL,
  options_json TEXT,
  locators_json TEXT NOT NULL,
  disabled INTEGER,
  current_value_json TEXT,
  default_value_json TEXT,
  last_seen_at TEXT NOT NULL
);
