import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ManualRunPaths = {
  rootDir: string;
  mapPath: string;
  clickLogPath: string;
  navigationYamlPath: string;
  layoutYamlPath: string;
  screenshotsDir: string;
};

const THIS_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_FILE_DIR, "../../..");

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatRunTimestamp(now = new Date()): string {
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

export function resolveManualRunPaths(options?: {
  location?: string;
  now?: Date;
}): ManualRunPaths {
  const timestamp = formatRunTimestamp(options?.now ?? new Date());
  const base =
    options?.location && options.location.trim()
      ? options.location.trim()
      : "state";
  const rootDir = path.resolve(REPO_ROOT, base, timestamp);
  return manualRunPathsFromRoot(rootDir);
}

function manualRunPathsFromRoot(rootDir: string): ManualRunPaths {
  return {
    rootDir,
    mapPath: path.join(rootDir, "printer-ui-map.clicks.json"),
    clickLogPath: path.join(rootDir, "click-log.json"),
    navigationYamlPath: path.join(rootDir, "ui-tree.navigation.yaml"),
    layoutYamlPath: path.join(rootDir, "ui-tree.layout.yaml"),
    screenshotsDir: path.join(rootDir, "screenshots"),
  };
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function ensureManualRunPaths(
  paths: ManualRunPaths,
  withScreenshots: boolean,
): Promise<ManualRunPaths> {
  let rootDir = paths.rootDir;
  if (await pathExists(rootDir)) {
    let i = 2;
    while (await pathExists(`${paths.rootDir}-${i}`)) {
      i += 1;
    }
    rootDir = `${paths.rootDir}-${i}`;
  }

  const finalPaths = manualRunPathsFromRoot(rootDir);
  await mkdir(finalPaths.rootDir, { recursive: true });
  if (withScreenshots) {
    await mkdir(finalPaths.screenshotsDir, { recursive: true });
  }
  return finalPaths;
}
