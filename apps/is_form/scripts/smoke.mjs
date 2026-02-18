import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const nodeBin = process.execPath;

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, {
    cwd: appRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

run(nodeBin, ["scripts/transform.mjs"], "transform");
run(nodeBin, ["scripts/db-init.mjs"], "db-init");
run(
  nodeBin,
  ["--import", "tsx", "src/lib/validateSchema.ts", "data/ui_schema_fields.json"],
  "validate",
);

const dbPath = process.env.PROFILE_DB_PATH
  ? path.resolve(appRoot, process.env.PROFILE_DB_PATH)
  : path.resolve(appRoot, "state/profile-runner.sqlite");
const db = new Database(dbPath, { readonly: true });
try {
  const schemaCount = db
    .prepare("SELECT COUNT(*) AS count FROM ui_schema_fields")
    .get();
  const profileCount = db.prepare("SELECT COUNT(*) AS count FROM profiles").get();
  const valueCount = db
    .prepare("SELECT COUNT(*) AS count FROM profile_values")
    .get();
  console.log(`ui_schema_fields=${schemaCount.count}`);
  console.log(`profiles=${profileCount.count}`);
  console.log(`profile_values=${valueCount.count}`);
} finally {
  db.close();
}
