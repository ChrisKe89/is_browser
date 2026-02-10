import http from "node:http";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { readFile, readdir, stat, access } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { OPERATOR_PORT, DEVICE_LOG_MODE, PROFILE_DB_PATH } from "../config/env.js";
import { discoverDevices } from "../discovery/index.js";
import { applySettings } from "../runner/applySettings.js";
import { type SettingsFile } from "../runner/settings.js";
import { importFieldOptionsFromCsvFile } from "../db/csvOptions.js";
import { importUiMapFile } from "../db/importer.js";
import { migrateDatabase } from "../db/migrations.js";
import {
  ProfileValidationFailure,
  buildSettingsFromProfile,
  deleteProfile,
  getProfile,
  getProfileEditorPages,
  listProfiles,
  saveProfile
} from "../db/profiles.js";

type JobState = "IDLE" | "WORKING" | "COMPLETED" | "FAILED" | "USER INTERVENTION REQUIRED";

const state = {
  devices: [] as Array<{ ip: string; mac?: string; reachable: boolean; source: string }>,
  job: {
    state: "IDLE" as JobState,
    console: [] as string[],
    retryResolver: null as null | ((value: boolean) => void)
  }
};

function pushConsole(message: string) {
  state.job.console.push(message);
  if (state.job.console.length > 200) {
    state.job.console.shift();
  }
  console.log(message);
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function text(res: http.ServerResponse, status: number, data: string) {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(data);
}

function isValidIp(ip: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

async function serveFile(res: http.ServerResponse, filePath: string) {
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findLatestFileByName(rootDir: string, fileName: string): Promise<string | null> {
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

async function resolveMapPath(): Promise<string | null> {
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

async function resolveFieldCsvPath(mapPath: string): Promise<string | null> {
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

function readUiSettingCount(dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM ui_setting").get() as { count: number };
    return Number(row.count ?? 0);
  } finally {
    db.close();
  }
}

async function ensureProfileSchemaData(
  dbPath: string,
  options?: { forceRefresh?: boolean }
): Promise<{
  imported: boolean;
  mapPath?: string;
  csvPath?: string;
  reason?: string;
}> {
  await migrateDatabase(dbPath);
  const forceRefresh = options?.forceRefresh === true;
  const currentCount = readUiSettingCount(dbPath);
  if (currentCount > 0 && !forceRefresh) {
    return { imported: false, reason: "already-populated" };
  }

  const mapPath = await resolveMapPath();
  if (!mapPath) {
    return { imported: false, reason: "map-not-found" };
  }

  await importUiMapFile(dbPath, mapPath);

  const csvPath = await resolveFieldCsvPath(mapPath);
  if (csvPath) {
    await importFieldOptionsFromCsvFile(dbPath, csvPath);
  }

  return { imported: true, mapPath, csvPath: csvPath ?? undefined };
}

async function parseBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function startApplyJob(options: {
  ip: string;
  settings: SettingsFile;
  mapPath: string;
}) {
  state.job.state = "WORKING";
  state.job.console = [];
  pushConsole(`Starting job for ${options.ip}`);

  const settings = options.settings;
  const consoleVisible = settings.options?.consoleVisible ?? true;
  const headless = settings.options?.headless ?? false;
  const deviceLogMode = settings.options?.deviceLogMode ?? DEVICE_LOG_MODE;

  applySettings({
    deviceIp: options.ip,
    settings,
    mapPath: options.mapPath,
    consoleVisible,
    headless,
    deviceLogMode,
    onConsole: (line) => pushConsole(line),
    onRetryPrompt: async () => {
      state.job.state = "USER INTERVENTION REQUIRED";
      pushConsole("Retry required. Waiting for /api/retry");
      return new Promise((resolve) => {
        state.job.retryResolver = resolve;
      });
    }
  })
    .then((result) => {
      state.job.state = result.status === "COMPLETED" ? "COMPLETED" : "FAILED";
      pushConsole(`Job finished: ${result.status}`);
    })
    .catch((err) => {
      state.job.state = "FAILED";
      pushConsole(`Job error: ${String(err)}`);
    });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    text(res, 400, "Bad request");
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/api/discover" && req.method === "POST") {
    state.job.state = "WORKING";
    state.devices = await discoverDevices();
    state.job.state = "IDLE";
    json(res, 200, state.devices);
    return;
  }

  if (pathname === "/api/devices/manual" && req.method === "POST") {
    const body = await parseBody(req);
    if (!body.ip || !isValidIp(body.ip)) {
      json(res, 400, { error: "Invalid IP" });
      return;
    }
    const device = { ip: body.ip, reachable: true, source: "manual" };
    json(res, 200, device);
    return;
  }

  if (pathname === "/api/profiles/schema" && req.method === "GET") {
    const bootstrap = await ensureProfileSchemaData(PROFILE_DB_PATH, {
      forceRefresh: url.searchParams.get("refresh") === "1"
    });
    const pages = await getProfileEditorPages(PROFILE_DB_PATH);
    json(res, 200, { pages, bootstrap });
    return;
  }

  if (pathname === "/api/profiles/list" && req.method === "GET") {
    const accountNumber = url.searchParams.get("accountNumber") ?? undefined;
    const profiles = await listProfiles(PROFILE_DB_PATH, accountNumber);
    json(res, 200, { profiles });
    return;
  }

  if (pathname === "/api/profiles/get" && req.method === "POST") {
    const body = await parseBody(req);
    if (!body.accountNumber || !body.variation) {
      json(res, 400, { error: "Missing accountNumber or variation." });
      return;
    }
    const profile = await getProfile(PROFILE_DB_PATH, {
      accountNumber: String(body.accountNumber),
      variation: String(body.variation)
    });
    if (!profile) {
      json(res, 404, { error: "Profile not found." });
      return;
    }
    json(res, 200, { profile });
    return;
  }

  if (pathname === "/api/profiles/save" && req.method === "POST") {
    const body = await parseBody(req);
    if (!body.accountNumber || !body.variation) {
      json(res, 400, { error: "Missing accountNumber or variation." });
      return;
    }
    if (!Array.isArray(body.values)) {
      json(res, 400, { error: "Missing values array." });
      return;
    }
    const rawValues = body.values as Array<{ settingId?: unknown; value?: unknown; enabled?: unknown }>;

    try {
      const profile = await saveProfile(PROFILE_DB_PATH, {
        accountNumber: String(body.accountNumber),
        variation: String(body.variation),
        displayName: body.displayName ? String(body.displayName) : undefined,
        values: rawValues.map((item) => ({
          settingId: String(item.settingId ?? ""),
          value: String(item.value ?? ""),
          enabled:
            item.enabled === undefined
              ? true
              : !(
                  item.enabled === false ||
                  item.enabled === 0 ||
                  item.enabled === "0" ||
                  String(item.enabled).toLowerCase() === "false"
                )
        }))
      });
      json(res, 200, { profile });
      return;
    } catch (error) {
      if (error instanceof ProfileValidationFailure) {
        json(res, 400, { error: error.message, fieldErrors: error.errors });
        return;
      }
      throw error;
    }
  }

  if (pathname === "/api/profiles/delete" && req.method === "POST") {
    const body = await parseBody(req);
    if (!body.accountNumber || !body.variation) {
      json(res, 400, { error: "Missing accountNumber or variation." });
      return;
    }

    const deleted = await deleteProfile(PROFILE_DB_PATH, {
      accountNumber: String(body.accountNumber),
      variation: String(body.variation)
    });
    if (!deleted) {
      json(res, 404, { error: "Profile not found." });
      return;
    }
    json(res, 200, { deleted: true });
    return;
  }

  if (pathname === "/api/start" && req.method === "POST") {
    json(res, 410, {
      error: "File-based settings apply is disabled. Use /api/start/profile for DB-backed profiles."
    });
    return;
  }

  if (pathname === "/api/start/profile" && req.method === "POST") {
    const body = await parseBody(req);
    if (!body.ip || !body.accountNumber || !body.variation) {
      json(res, 400, { error: "Missing ip, accountNumber, or variation." });
      return;
    }

    try {
      const mapPath = body.mapPath
        ? String(body.mapPath)
        : (await resolveMapPath()) ?? "state/printer-ui-map.json";
      const profileSettings = await buildSettingsFromProfile(PROFILE_DB_PATH, {
        accountNumber: String(body.accountNumber),
        variation: String(body.variation)
      });

      startApplyJob({
        ip: String(body.ip),
        mapPath,
        settings: {
          meta: {
            customerName: body.customerName ? String(body.customerName) : "unknown",
            accountNumber: String(body.accountNumber),
            variation: String(body.variation),
            scriptVariant: String(body.variation)
          },
          options: {
            consoleVisible: body.consoleVisible === undefined ? true : Boolean(body.consoleVisible),
            headless: body.headless === undefined ? false : Boolean(body.headless),
            deviceLogMode:
              body.deviceLogMode === "daily" || body.deviceLogMode === "all-time"
                ? body.deviceLogMode
                : DEVICE_LOG_MODE
          },
          settings: profileSettings
        }
      });
      json(res, 200, { status: "started" });
      return;
    } catch (error) {
      if (error instanceof ProfileValidationFailure) {
        json(res, 400, {
          error: error.message,
          fieldErrors: error.errors
        });
        return;
      }
      throw error;
    }
  }

  if (pathname === "/api/retry" && req.method === "POST") {
    if (state.job.retryResolver) {
      state.job.retryResolver(true);
      state.job.retryResolver = null;
      state.job.state = "WORKING";
      json(res, 200, { status: "resumed" });
      return;
    }
    json(res, 400, { error: "No retry pending" });
    return;
  }

  if (pathname === "/api/status" && req.method === "GET") {
    json(res, 200, { state: state.job.state, console: state.job.console });
    return;
  }

  if (pathname === "/settings-schema.json") {
    await serveFile(res, "config/settings-schema.json");
    return;
  }

  if (pathname === "/") {
    await serveFile(res, path.join("ui", "operator.html"));
    return;
  }

  if (pathname.startsWith("/")) {
    const filePath = path.join("ui", pathname.replace("/", ""));
    await serveFile(res, filePath);
    return;
  }

  text(res, 404, "Not found");
});

server.listen(OPERATOR_PORT, () => {
  console.log(`Operator server running on http://localhost:${OPERATOR_PORT}`);
});
