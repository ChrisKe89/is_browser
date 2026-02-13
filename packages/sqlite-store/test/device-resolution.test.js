import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import {
  listVariationsForAccount,
  modelMatchesRequirement,
  resolveDeviceByModelAndSerial,
  searchAccounts,
  upsertDeviceResolutionRecords,
  variationMatchesModelRequirement,
} from "@is-browser/sqlite-store";
import { saveProfile } from "@is-browser/sqlite-store";
import { importUiMapToDatabase } from "@is-browser/sqlite-store";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "printer-ui-resolution-"),
  );
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

function mapWithOneSetting() {
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
        navPath: [],
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
    ],
  };
}

test("resolution lookup matches exact model+serial and enforces model requirements", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, mapWithOneSetting());
    await saveProfile(dbPath, {
      accountNumber: "10001",
      variation: "base",
      values: [{ settingId: "system.device-name", value: "One" }],
    });

    await upsertDeviceResolutionRecords(dbPath, [
      {
        modelName: "Apeos C3530",
        serial: "TC101894043240",
        customerName: "Test MFD",
        accountNumber: "10001",
        variation: "base",
        modelMatch: "Apeos*",
      },
    ]);

    const resolved = await resolveDeviceByModelAndSerial(dbPath, {
      modelName: "Apeos C3530",
      serial: "043240",
    });
    assert.ok(resolved);
    assert.equal(resolved?.accountNumber, "10001");
    assert.equal(resolved?.variation, "base");

    assert.equal(modelMatchesRequirement("Apeos C3530", "Apeos*"), true);
    assert.equal(modelMatchesRequirement("DocuPrint P450", "Apeos*"), false);

    const variations = await listVariationsForAccount(dbPath, "10001");
    assert.ok(variations.some((item) => item.variation === "base"));

    const accountMatches = await variationMatchesModelRequirement(dbPath, {
      accountNumber: "10001",
      variation: "base",
      modelName: "Apeos C3530",
    });
    assert.equal(accountMatches, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("account search includes profile and resolution account numbers", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, mapWithOneSetting());
    await saveProfile(dbPath, {
      accountNumber: "10077",
      variation: "default",
      values: [{ settingId: "system.device-name", value: "Two" }],
    });
    await upsertDeviceResolutionRecords(dbPath, [
      {
        modelName: "Apeos C3530",
        serial: "043240",
        customerName: "Test MFD",
        accountNumber: "10001",
        variation: "default",
      },
    ]);

    const all = await searchAccounts(dbPath);
    assert.ok(all.find((item) => item.accountNumber === "10077"));
    assert.ok(all.find((item) => item.accountNumber === "10001"));
    const filtered = await searchAccounts(dbPath, "1007");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].accountNumber, "10077");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
