import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { writeMap } from "@is-browser/contract";

function sampleUiMap() {
  return {
    meta: {
      generatedAt: "2026-02-11T00:00:00.000Z",
      printerUrl: "http://192.168.0.10",
      schemaVersion: "1.1"
    },
    pages: [
      {
        id: "network",
        title: "Network",
        url: "http://192.168.0.10/#/network",
        navPath: [{ action: "goto", url: "http://192.168.0.10/#/network" }]
      }
    ],
    fields: [
      {
        id: "network.hostname",
        label: "Host Name",
        type: "text",
        selectors: [{ kind: "css", value: "#hostname" }],
        pageId: "network"
      }
    ]
  };
}

test("crawler smoke: UI map output validates against shared contract", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-smoke-"));
  const outPath = path.join(tempDir, "ui-map.json");
  try {
    await writeMap(outPath, sampleUiMap());
    const persisted = JSON.parse(await readFile(outPath, "utf8"));
    assert.equal(persisted.meta.schemaVersion, "1.1");
    assert.equal(persisted.pages.length, 1);
    assert.equal(persisted.fields[0].id, "network.hostname");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
