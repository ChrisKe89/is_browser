import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { getOperatorDiscoveryConfig, saveOperatorDiscoveryConfig } from "../packages/storage/src/operatorConfig.js";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "printer-ui-opcfg-"));
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

test("operator discovery config persists subnet ranges, manual IPs, and csv mode", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    const initial = await getOperatorDiscoveryConfig(dbPath);
    assert.ok(Array.isArray(initial.subnetRanges));
    assert.ok(initial.subnetRanges.length > 0);

    const saved = await saveOperatorDiscoveryConfig(dbPath, {
      subnetRanges: ["192.168.0.0/24", "192.168.10.10-192.168.10.20"],
      manualIps: ["192.168.0.31", "192.168.0.32"],
      csvMode: "daily"
    });
    assert.equal(saved.csvMode, "daily");
    assert.equal(saved.subnetRanges.length, 2);
    assert.equal(saved.manualIps.length, 2);

    const reloaded = await getOperatorDiscoveryConfig(dbPath);
    assert.deepEqual(reloaded.subnetRanges, saved.subnetRanges);
    assert.deepEqual(reloaded.manualIps, saved.manualIps);
    assert.equal(reloaded.csvMode, "daily");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

