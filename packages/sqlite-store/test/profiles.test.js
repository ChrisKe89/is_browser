import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import {
  ProfileValidationFailure,
  buildSettingsFromProfile,
  deleteProfile,
  getProfile,
  getProfileEditorPages,
  listProfiles,
  saveProfile,
} from "@is-browser/sqlite-store";
import { importUiMapToDatabase } from "@is-browser/sqlite-store";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "printer-ui-profile-"));
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

function sampleMap() {
  return {
    meta: {
      generatedAt: "2026-02-10T00:00:00.000Z",
      printerUrl: "http://192.168.0.10",
      schemaVersion: "1.1",
    },
    pages: [
      {
        id: "system",
        title: "System",
        url: "http://192.168.0.10/#/system",
        navPath: [{ action: "goto", url: "http://192.168.0.10/#/system" }],
      },
    ],
    fields: [
      {
        id: "system.device-name",
        label: "Device Name",
        type: "text",
        selectors: [{ kind: "css", value: "#deviceName" }],
        pageId: "system",
      },
      {
        id: "system.mode",
        label: "Mode",
        type: "select",
        selectors: [{ kind: "css", value: "#mode" }],
        pageId: "system",
        constraints: { enum: ["Office", "Warehouse"] },
      },
      {
        id: "system.energy-save",
        label: "Energy Save",
        type: "checkbox",
        selectors: [{ kind: "label", value: "Energy Save" }],
        pageId: "system",
      },
    ],
  };
}

test("save/get/list/delete profile by account and variation", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, sampleMap());

    const base = await saveProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
      displayName: "Base Setup",
      values: [
        { settingId: "system.device-name", value: "Main Lobby Printer" },
        { settingId: "system.mode", value: "Office" },
        { settingId: "system.energy-save", value: "On" },
      ],
    });
    assert.equal(base.accountNumber, "10001");
    assert.equal(base.variation, "base");
    assert.equal(base.values.length, 3);

    await saveProfile(dbPath, {
      accountNumber: "10001",
      variation: "night",
      displayName: "Night Setup",
      values: [
        { settingId: "system.device-name", value: "Night Printer" },
        { settingId: "system.mode", value: "Warehouse" },
        { settingId: "system.energy-save", value: "Off" },
      ],
    });

    const fetched = await getProfile(dbPath, {
      accountNumber: "10001",
      variation: "night",
    });
    assert.ok(fetched);
    assert.equal(fetched?.displayName, "Night Setup");

    const profiles = await listProfiles(dbPath, "10001");
    assert.equal(profiles.length, 2);

    const deleted = await deleteProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
    });
    assert.equal(deleted, true);
    const missing = await getProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
    });
    assert.equal(missing, null);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("profile save returns per-field validation errors", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, sampleMap());

    await assert.rejects(
      async () => {
        await saveProfile(dbPath, {
          accountNumber: "",
          variation: "",
          values: [
            { settingId: "system.mode", value: "InvalidMode" },
            { settingId: "system.energy-save", value: "invalid-switch" },
          ],
        });
      },
      (error) => {
        assert.ok(error instanceof ProfileValidationFailure);
        const fields = error.errors.map((item) => item.field);
        assert.ok(fields.includes("accountNumber"));
        assert.ok(fields.includes("variation"));
        assert.ok(fields.includes("values.system.mode"));
        assert.ok(fields.includes("values.system.energy-save"));
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("profile editor pages are grouped by page and control type", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, sampleMap());
    const pages = await getProfileEditorPages(dbPath);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].id, "system");
    assert.ok(pages[0].groups.find((group) => group.controlType === "text"));
    assert.ok(pages[0].groups.find((group) => group.controlType === "select"));
    assert.ok(pages[0].groups.find((group) => group.controlType === "switch"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("buildSettingsFromProfile validates before apply", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, sampleMap());
    await saveProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
      values: [
        { settingId: "system.device-name", value: "Profile Device" },
        { settingId: "system.mode", value: "Office" },
        { settingId: "system.energy-save", value: "On", enabled: false },
      ],
    });

    const settings = await buildSettingsFromProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
    });
    assert.equal(settings.length, 2);
    assert.ok(!settings.find((item) => item.id === "system.energy-save"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("disabled profile setting can keep invalid value without blocking apply settings build", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, sampleMap());
    await saveProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
      values: [
        { settingId: "system.device-name", value: "Profile Device" },
        { settingId: "system.mode", value: "InvalidMode", enabled: false },
        { settingId: "system.energy-save", value: "On" },
      ],
    });

    const settings = await buildSettingsFromProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
    });
    assert.equal(settings.length, 2);
    assert.ok(!settings.find((item) => item.id === "system.mode"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("enabled setting with missing value is persisted and skipped during apply settings build", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, sampleMap());
    await saveProfile(dbPath, {
      accountNumber: "10002",
      variation: "base",
      values: [
        { settingId: "system.device-name", value: "Profile Device" },
        { settingId: "system.mode", value: "", enabled: true },
        { settingId: "system.energy-save", value: "On", enabled: true },
      ],
    });

    const settings = await buildSettingsFromProfile(dbPath, {
      accountNumber: "10002",
      variation: "base",
    });
    assert.equal(settings.length, 2);
    assert.ok(!settings.find((item) => item.id === "system.mode"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
