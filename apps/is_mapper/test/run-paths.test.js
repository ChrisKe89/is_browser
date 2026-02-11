import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { ensureManualRunPaths, formatRunTimestamp, resolveManualRunPaths } from "../src/runPaths.ts";

test("manual run paths: uses location folder when provided", () => {
  const now = new Date("2026-02-11T12:34:56.000Z");
  const timestamp = formatRunTimestamp(now);
  assert.equal(timestamp.length, 15);

  const paths = resolveManualRunPaths({ location: "permissions", now });
  assert.match(paths.rootDir.replace(/\\/g, "/"), /permissions\/\d{8}-\d{6}$/);
  assert.ok(paths.mapPath.endsWith("printer-ui-map.clicks.json"));
  assert.ok(paths.clickLogPath.endsWith("click-log.json"));
  assert.ok(paths.navigationYamlPath.endsWith("ui-tree.navigation.yaml"));
  assert.ok(paths.layoutYamlPath.endsWith("ui-tree.layout.yaml"));
  assert.ok(paths.screenshotsDir.endsWith("screenshots"));
});

test("manual run paths: defaults to state folder", () => {
  const now = new Date("2026-02-11T12:34:56.000Z");
  const paths = resolveManualRunPaths({ now });
  assert.match(paths.rootDir.replace(/\\/g, "/"), /state\/\d{8}-\d{6}$/);
});

test("manual run paths: creates unique folder when timestamp path already exists", async () => {
  const tempBase = await mkdtemp(path.join(os.tmpdir(), "mapper-runs-"));
  try {
    const now = new Date("2026-02-11T12:34:56.000Z");
    const first = resolveManualRunPaths({ location: tempBase, now });
    const firstResolved = await ensureManualRunPaths(first, false);
    const second = resolveManualRunPaths({ location: tempBase, now });
    const secondResolved = await ensureManualRunPaths(second, false);

    assert.notEqual(firstResolved.rootDir, secondResolved.rootDir);
    assert.match(secondResolved.rootDir, /-2$/);
  } finally {
    await rm(tempBase, { recursive: true, force: true });
  }
});
