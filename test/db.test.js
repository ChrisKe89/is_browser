import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../packages/storage/src/migrations.js";
import { importUiMapToDatabase } from "../packages/storage/src/importer.js";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "printer-ui-db-"));
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

function readTableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
}

function readCount(db, tableName) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  return row.count;
}

function readColumnNames(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => row.name);
}

test("migrations create required schema tables", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await migrateDatabase(dbPath);
    const db = new DatabaseSync(dbPath);
    const names = readTableNames(db);
    const profileValueColumns = readColumnNames(db, "config_profile_value");
    db.close();

    assert.ok(names.includes("ui_page"));
    assert.ok(names.includes("ui_setting"));
    assert.ok(names.includes("ui_setting_option"));
    assert.ok(names.includes("ui_setting_selector"));
    assert.ok(names.includes("ui_page_nav_step"));
    assert.ok(names.includes("config_profile"));
    assert.ok(names.includes("config_profile_value"));
    assert.ok(names.includes("apply_run"));
    assert.ok(names.includes("apply_run_item"));
    assert.ok(names.includes("operator_config"));
    assert.ok(names.includes("device_resolution"));
    assert.ok(profileValueColumns.includes("enabled"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("import is idempotent and normalizes checkbox to switch options", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    const sampleMap = {
      meta: {
        generatedAt: "2026-02-10T00:00:00.000Z",
        printerUrl: "http://192.168.0.10",
        schemaVersion: "1.1"
      },
      pages: [
        {
          id: "network",
          title: "Network",
          url: "http://192.168.0.10/#/network",
          navPath: [
            { action: "goto", url: "http://192.168.0.10/#/network" },
            {
              action: "click",
              selector: { kind: "role", role: "link", name: "Network" }
            }
          ]
        }
      ],
      fields: [
        {
          id: "network.hostname",
          label: "Host Name",
          type: "text",
          selectors: [{ kind: "css", value: "#hostName" }],
          pageId: "network"
        },
        {
          id: "network.ipv6-enable",
          label: "Enable IPv6",
          type: "checkbox",
          selectors: [{ kind: "label", value: "Enable IPv6" }],
          pageId: "network"
        },
        {
          id: "network.mode",
          label: "Address Mode",
          type: "select",
          selectors: [{ kind: "css", value: "#addressMode" }],
          pageId: "network",
          constraints: { enum: ["DHCP", "Static"] }
        }
      ]
    };

    await importUiMapToDatabase(dbPath, sampleMap);
    await importUiMapToDatabase(dbPath, sampleMap);

    const db = new DatabaseSync(dbPath);
    assert.equal(readCount(db, "ui_page"), 1);
    assert.equal(readCount(db, "ui_setting"), 3);
    assert.equal(readCount(db, "ui_page_nav_step"), 2);
    assert.equal(readCount(db, "ui_setting_selector"), 3);
    assert.equal(readCount(db, "ui_setting_option"), 4);

    const switchSetting = db
      .prepare("SELECT control_type FROM ui_setting WHERE id = ?")
      .get("network.ipv6-enable");
    assert.equal(switchSetting.control_type, "switch");

    const switchOptions = db
      .prepare("SELECT option_key FROM ui_setting_option WHERE setting_id = ? ORDER BY sort_order")
      .all("network.ipv6-enable")
      .map((row) => row.option_key);
    assert.deepEqual(switchOptions, ["On", "Off"]);
    db.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("profiles allow account variations and enforce identity uniqueness", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await migrateDatabase(dbPath);
    const db = new DatabaseSync(dbPath);
    const insertProfile = db.prepare(
      "INSERT INTO config_profile (account_number, variation, display_name) VALUES (?, ?, ?)"
    );

    insertProfile.run("10001", "base", "Base");
    insertProfile.run("10001", "night", "Night Shift");

    assert.throws(() => {
      insertProfile.run("10001", "base", "Duplicate");
    });
    db.close();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("import rejects invalid payload with clear context", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await assert.rejects(async () => {
      await importUiMapToDatabase(dbPath, { invalid: true });
    }, /Invalid UI map payload:/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

