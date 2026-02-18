import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const nodeBin = process.execPath;

const result = spawnSync(nodeBin, ["--import", "tsx", "src/lib/db.ts", "--init"], {
  cwd: appRoot,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
