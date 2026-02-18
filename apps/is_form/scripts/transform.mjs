import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const inputPath =
  process.argv[2] ?? path.resolve(appRoot, "data/settings-deterministic-manual-live.json");
const outputPath = process.argv[3] ?? path.resolve(appRoot, "data/ui_schema_fields.json");
const nodeBin = process.execPath;

const result = spawnSync(
  nodeBin,
  ["--import", "tsx", "src/lib/transform.ts", inputPath, outputPath],
  {
    cwd: appRoot,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
