import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FORM_PORT, OPERATOR_PUBLIC_URL, PROFILE_DB_PATH } from "@is-browser/env";
import { importFieldOptionsFromCsvFile } from "@is-browser/sqlite-store";
import { importUiMapFile } from "@is-browser/sqlite-store";
import { migrateDatabase } from "@is-browser/sqlite-store";
import {
  deleteProfile,
  getProfile,
  getProfileEditorPages,
  listProfiles,
  ProfileValidationFailure,
  saveProfile
} from "@is-browser/sqlite-store";
import { json, parseBody, resolveFieldCsvPath, resolveMapPath, serveFile, text } from "./httpUtils.js";

type FormServerOptions = {
  profileDbPath?: string;
  operatorPublicUrl?: string;
  port?: number;
};

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

export function createFormServer(options?: FormServerOptions): http.Server {
  const profileDbPath = options?.profileDbPath ?? PROFILE_DB_PATH;
  const operatorPublicUrl = options?.operatorPublicUrl ?? OPERATOR_PUBLIC_URL;
  const startupPromise = ensureProfileSchemaData(profileDbPath).then(() => undefined);

  return http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      text(res, 400, "Bad request");
      return;
    }

    try {
      await startupPromise;
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (pathname === "/api/form/config" && req.method === "GET") {
        json(res, 200, { operatorUrl: operatorPublicUrl });
        return;
      }

      if (pathname === "/api/profiles/schema" && req.method === "GET") {
        const bootstrap = await ensureProfileSchemaData(profileDbPath, {
          forceRefresh: url.searchParams.get("refresh") === "1"
        });
        const pages = await getProfileEditorPages(profileDbPath);
        if (bootstrap.reason === "map-not-found" && pages.length === 0) {
          json(res, 503, {
            error:
              "UI map is required before profiles can be authored. Set MAP_PATH or place a map file under state/.",
            bootstrap
          });
          return;
        }
        json(res, 200, { pages, bootstrap });
        return;
      }

      if (pathname === "/api/profiles/list" && req.method === "GET") {
        const accountNumber = url.searchParams.get("accountNumber") ?? undefined;
        const profiles = await listProfiles(profileDbPath, accountNumber);
        json(res, 200, { profiles });
        return;
      }

      if (pathname === "/api/profiles/get" && req.method === "POST") {
        const body = await parseBody(req);
        if (!body.accountNumber || !body.variation) {
          json(res, 400, { error: "Missing accountNumber or variation." });
          return;
        }
        const profile = await getProfile(profileDbPath, {
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
          const profile = await saveProfile(profileDbPath, {
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
        const deleted = await deleteProfile(profileDbPath, {
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

      if (pathname === "/" || pathname === "/form.html") {
        await serveFile(res, path.join("ui", "form.html"));
        return;
      }

      text(res, 404, "Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    }
  });
}

export function startFormServer(options?: FormServerOptions): http.Server {
  const port = options?.port ?? FORM_PORT;
  const server = createFormServer(options);
  server.listen(port, () => {
    console.log(`Form server running on http://localhost:${port}`);
  });
  return server;
}

