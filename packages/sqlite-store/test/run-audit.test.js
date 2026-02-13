import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { startRunAudit } from "@is-browser/sqlite-store";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "printer-ui-runaudit-"));
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

async function removeWithRetry(targetPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 20));
    }
  }
  if (lastError && lastError.code === "EBUSY") {
    return;
  }
  throw lastError;
}

test("run audit persists lifecycle and item outcomes", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    const session = await startRunAudit(dbPath, {
      accountNumber: "10001",
      variation: "base",
      deviceIp: "192.168.0.10",
      mapPath: "state/printer-ui-map.json",
    });

    session.recordItem({
      attempt: 1,
      status: "ok",
      message: "Applied one setting",
    });
    session.recordItem({
      attempt: 1,
      status: "error",
      message: "Invalid option",
    });
    session.finish({
      status: "partial",
      message: "Run completed with partial failures.",
    });
    session.close();

    const db = new DatabaseSync(dbPath);
    const run = db
      .prepare(
        `SELECT account_number, variation, status, message, started_at, finished_at
         FROM apply_run
         LIMIT 1`,
      )
      .get();
    assert.equal(run.account_number, "10001");
    assert.equal(run.variation, "base");
    assert.equal(run.status, "partial");
    assert.equal(run.message, "Run completed with partial failures.");
    assert.ok(run.started_at);
    assert.ok(run.finished_at);

    const items = db
      .prepare(
        `SELECT setting_id, attempt, status, message
         FROM apply_run_item
         ORDER BY id`,
      )
      .all();
    assert.equal(items.length, 2);
    assert.equal(items[0].setting_id, null);
    assert.equal(items[0].status, "ok");
    assert.equal(items[1].setting_id, null);
    assert.equal(items[1].status, "error");
    db.close();
  } finally {
    await removeWithRetry(tempDir);
  }
});
