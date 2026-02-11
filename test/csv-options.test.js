import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { importUiMapToDatabase } from "../packages/storage/src/importer.js";
import { importFieldOptionsFromCsvFile } from "../packages/storage/src/csvOptions.js";

async function makeTempPaths() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "printer-ui-csv-options-"));
  return {
    tempDir,
    dbPath: path.join(tempDir, "test.sqlite"),
    csvPath: path.join(tempDir, "fields.csv")
  };
}

test("csv option import enriches select/radio setting options", async () => {
  const { tempDir, dbPath, csvPath } = await makeTempPaths();
  try {
    await importUiMapToDatabase(dbPath, {
      meta: {
        generatedAt: "2026-02-10T00:00:00.000Z",
        printerUrl: "http://192.168.0.50",
        schemaVersion: "manual-1.0"
      },
      pages: [
        { id: "apps", title: "Apps", url: "http://192.168.0.50/apps", navPath: [] }
      ],
      fields: [
        {
          id: "apps.mode",
          label: "Mode",
          type: "select",
          selectors: [{ kind: "css", value: "#mode" }],
          pageId: "apps"
        },
        {
          id: "apps.notifications",
          label: "Notifications",
          type: "radio",
          selectors: [{ kind: "css", value: "#notifications" }],
          pageId: "apps"
        }
      ]
    });

    await writeFile(
      csvPath,
      [
        "field_id,page_id,page_title,label,type,selector_count,selectors,enum_count,enum_values,min,max,pattern,read_only",
        "apps.mode,apps,Apps,Mode,select,1,css::#mode,3,Off | Basic | Advanced,,,,",
        "apps.notifications,apps,Apps,Notifications,radio,1,css::#notifications,2,Enabled | Disabled,,,,"
      ].join("\n"),
      "utf8"
    );

    const summary = await importFieldOptionsFromCsvFile(dbPath, csvPath);
    assert.equal(summary.settingsUpdated, 2);

    const db = new DatabaseSync(dbPath);
    const modeOptions = db
      .prepare("SELECT option_key FROM ui_setting_option WHERE setting_id = ? ORDER BY sort_order")
      .all("apps.mode")
      .map((row) => row.option_key);
    const radioOptions = db
      .prepare("SELECT option_key FROM ui_setting_option WHERE setting_id = ? ORDER BY sort_order")
      .all("apps.notifications")
      .map((row) => row.option_key);
    db.close();

    assert.deepEqual(modeOptions, ["Off", "Basic", "Advanced"]);
    assert.deepEqual(radioOptions, ["Enabled", "Disabled"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

