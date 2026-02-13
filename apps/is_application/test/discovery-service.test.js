import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { importUiMapToDatabase } from "@is-browser/sqlite-store";
import { saveProfile } from "@is-browser/sqlite-store";
import { upsertDeviceResolutionRecords } from "@is-browser/sqlite-store";
import {
  addManualDevice,
  discoverDevicesFromSubnets,
  expandSubnetRanges,
} from "../src/discovery/service.js";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "printer-ui-discovery-"),
  );
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

function minimalMap() {
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

test("expandSubnetRanges supports /24, shorthand, and explicit ranges", () => {
  const cidr = expandSubnetRanges(["192.168.2.0/30"]);
  assert.deepEqual(cidr, ["192.168.2.1", "192.168.2.2"]);

  const shorthand = expandSubnetRanges(["10.10.10"]);
  assert.equal(shorthand[0], "10.10.10.1");
  assert.equal(shorthand[shorthand.length - 1], "10.10.10.254");

  const explicit = expandSubnetRanges(["192.168.1.10-192.168.1.12"]);
  assert.deepEqual(explicit, ["192.168.1.10", "192.168.1.11", "192.168.1.12"]);
});

test("discoverDevicesFromSubnets resolves known model+serial and flags unknown devices", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, minimalMap());
    await saveProfile(dbPath, {
      accountNumber: "10001",
      variation: "default",
      values: [{ settingId: "system.device-name", value: "Name" }],
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

    const ipIdentity = new Map([
      ["192.168.10.5", { model: "Apeos C3530", serial: "TC101894043240" }],
      ["192.168.10.6", { model: "Unknown MFP", serial: "000999" }],
    ]);
    const devices = await discoverDevicesFromSubnets(
      dbPath,
      ["192.168.10.5-192.168.10.6"],
      {
        pingHost: async () => true,
        tcpProbe: async () => true,
        fetchIdentity: async (ip) => ipIdentity.get(ip) || null,
      },
    );

    assert.equal(devices.length, 2);
    const known = devices.find((item) => item.ip === "192.168.10.5");
    const unknown = devices.find((item) => item.ip === "192.168.10.6");
    assert.ok(known);
    assert.equal(known?.resolved, true);
    assert.equal(known?.accountNumber, "10001");
    assert.equal(known?.variation, "default");
    assert.equal(known?.status, "READY");
    assert.ok(unknown);
    assert.equal(unknown?.requiresIntervention, true);
    assert.equal(unknown?.status, "USER_INTERVENTION_REQUIRED");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("addManualDevice requires reachable host and validates IPv4", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    await importUiMapToDatabase(dbPath, minimalMap());

    await assert.rejects(
      async () => addManualDevice(dbPath, "bad-ip"),
      /valid IPv4/,
    );
    await assert.rejects(
      async () =>
        addManualDevice(dbPath, "192.168.10.10", {
          pingHost: async () => false,
          tcpProbe: async () => false,
          fetchIdentity: async () => null,
        }),
      /not reachable/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
