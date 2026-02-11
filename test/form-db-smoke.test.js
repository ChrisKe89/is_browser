import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createFormServer } from "../settings-authoring/src/server/formServer.js";

function sampleMap() {
  return {
    meta: {
      generatedAt: "2026-02-11T00:00:00.000Z",
      printerUrl: "http://192.168.0.10",
      schemaVersion: "1.1"
    },
    pages: [
      {
        id: "system",
        title: "System",
        url: "http://192.168.0.10/#/system",
        navPath: [{ action: "goto", url: "http://192.168.0.10/#/system" }]
      }
    ],
    fields: [
      {
        id: "system.device-name",
        label: "Device Name",
        type: "text",
        selectors: [{ kind: "css", value: "#deviceName" }],
        pageId: "system"
      },
      {
        id: "system.mode",
        label: "Mode",
        type: "select",
        selectors: [{ kind: "css", value: "#mode" }],
        pageId: "system",
        constraints: { enum: ["Office", "Warehouse"] }
      }
    ]
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to read test server address.");
  }
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
}

test("settings-authoring smoke: form bootstraps from map and saves profile", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "form-smoke-"));
  const dbPath = path.join(tempDir, "profile.sqlite");
  const mapPath = path.join(tempDir, "ui-map.json");
  await writeFile(mapPath, JSON.stringify(sampleMap(), null, 2), "utf8");

  const previousMapPath = process.env.MAP_PATH;
  process.env.MAP_PATH = mapPath;
  const server = createFormServer({ profileDbPath: dbPath });

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const schemaResponse = await fetch(`${baseUrl}/api/profiles/schema`);
    assert.equal(schemaResponse.status, 200);
    const schemaPayload = await schemaResponse.json();
    assert.equal(schemaPayload.pages.length, 1);

    const saveResponse = await fetch(`${baseUrl}/api/profiles/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountNumber: "10001",
        variation: "base",
        values: [
          { settingId: "system.device-name", value: "Front Desk" },
          { settingId: "system.mode", value: "Office" }
        ]
      })
    });
    assert.equal(saveResponse.status, 200);
    const savePayload = await saveResponse.json();
    assert.equal(savePayload.profile.accountNumber, "10001");
    assert.equal(savePayload.profile.variation, "base");
  } finally {
    await close(server);
    if (previousMapPath === undefined) {
      delete process.env.MAP_PATH;
    } else {
      process.env.MAP_PATH = previousMapPath;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
