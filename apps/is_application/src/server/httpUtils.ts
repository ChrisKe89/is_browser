import http from "node:http";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";

export function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function text(res: http.ServerResponse, status: number, data: string): void {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(data);
}

export async function serveFile(res: http.ServerResponse, filePath: string): Promise<void> {
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === ".html"
        ? "text/html"
        : ext === ".css"
          ? "text/css"
          : ext === ".js"
            ? "application/javascript"
            : "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    text(res, 404, "Not found");
  }
}

export async function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findLatestFileByName(
  rootDir: string,
  fileName: string
): Promise<string | null> {
  let latestPath: string | null = null;
  let latestMtimeMs = -1;

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== fileName) {
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.mtimeMs > latestMtimeMs) {
        latestMtimeMs = fileStat.mtimeMs;
        latestPath = fullPath;
      }
    }
  }

  await walk(rootDir);
  return latestPath;
}

export async function resolveMapPath(): Promise<string | null> {
  const envMapPath = process.env.MAP_PATH?.trim();
  if (envMapPath && (await pathExists(envMapPath))) {
    return envMapPath;
  }

  const staticCandidates = ["state/printer-ui-map.clicks.json", "state/printer-ui-map.json"];
  for (const candidate of staticCandidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  const latestClickMap = await findLatestFileByName("state", "printer-ui-map.clicks.json");
  if (latestClickMap) {
    return latestClickMap;
  }

  const latestCrawlerMap = await findLatestFileByName("state", "printer-ui-map.json");
  if (latestCrawlerMap) {
    return latestCrawlerMap;
  }

  return null;
}

export async function resolveFieldCsvPath(mapPath: string): Promise<string | null> {
  const envFieldCsvPath = process.env.MAP_FIELD_CSV_PATH?.trim();
  if (envFieldCsvPath && (await pathExists(envFieldCsvPath))) {
    return envFieldCsvPath;
  }

  if (mapPath.endsWith(".json")) {
    const adjacentCsvPath = mapPath.replace(/\.json$/i, ".fields.csv");
    if (await pathExists(adjacentCsvPath)) {
      return adjacentCsvPath;
    }
  }

  const staticCandidate = "state/printer-ui-map.clicks.fields.csv";
  if (await pathExists(staticCandidate)) {
    return staticCandidate;
  }

  return findLatestFileByName("state", "printer-ui-map.clicks.fields.csv");
}
