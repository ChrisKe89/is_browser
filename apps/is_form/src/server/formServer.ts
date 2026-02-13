import http from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  FORM_PORT,
  OPERATOR_PUBLIC_URL,
  PROFILE_DB_PATH,
} from "@is-browser/env";
import { importFieldOptionsFromCsvFile } from "@is-browser/sqlite-store";
import { importUiMapFile } from "@is-browser/sqlite-store";
import { migrateDatabase } from "@is-browser/sqlite-store";
import {
  deleteProfile,
  getProfile,
  getProfileEditorPages,
  listProfiles,
  ProfileValidationFailure,
  saveProfile,
} from "@is-browser/sqlite-store";
import {
  json,
  parseBody,
  resolveFieldCsvPath,
  resolveMapPath,
  serveFile,
  text,
} from "./httpUtils.js";

type FormServerOptions = {
  profileDbPath?: string;
  operatorPublicUrl?: string;
  port?: number;
};

type NormalizedField = {
  id: string;
  label: string;
  control: "text" | "select" | "checkbox" | "textarea";
  default?: string | boolean;
  options?: string[];
  required?: boolean;
  visibleIf?: { fieldId: string; equals: string | boolean | number };
  selector?: string;
  location?: { path: string[] };
  sourceSettingId?: string;
};

type NormalizedSubgroup = {
  id: string;
  title: string;
  defaultCollapsed: boolean;
  fields: NormalizedField[];
};

type NormalizedGroup = {
  id: string;
  title: string;
  subgroups: NormalizedSubgroup[];
};

type NormalizedSection = {
  id: string;
  title: string;
  groups: NormalizedGroup[];
};

type NormalizedSchema = {
  version: string;
  device: Record<string, unknown>;
  sections: NormalizedSection[];
};

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootFromServerDir = path.resolve(serverDir, "..", "..", "..", "..");
const SETTINGS_SCHEMA_CANDIDATES = [
  path.resolve(process.cwd(), "tools", "samples", "settings-schema.json"),
  path.resolve(
    repoRootFromServerDir,
    "tools",
    "samples",
    "settings-schema.json",
  ),
];

async function resolveSettingsSchemaPath(): Promise<string> {
  for (const candidate of SETTINGS_SCHEMA_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `Schema file not found. Tried: ${SETTINGS_SCHEMA_CANDIDATES.join(", ")}`,
  );
}

function normalizeControlType(
  value: unknown,
): "text" | "select" | "checkbox" | "textarea" {
  const input = String(value ?? "text").toLowerCase();
  if (input === "select" || input === "checkbox" || input === "textarea") {
    return input;
  }
  return "text";
}

function normalizeField(
  rawField: Record<string, unknown>,
  fallbackIndex: number,
): NormalizedField | null {
  const id = String(rawField.id ?? `field_${fallbackIndex}`);
  const label = String(rawField.label ?? id);
  const control = normalizeControlType(rawField.control ?? rawField.type);
  const normalized: NormalizedField = { id, label, control };
  if (Object.prototype.hasOwnProperty.call(rawField, "default")) {
    const defaultValue = rawField.default;
    if (typeof defaultValue === "boolean" || typeof defaultValue === "string") {
      normalized.default = defaultValue;
    } else if (defaultValue !== null && defaultValue !== undefined) {
      normalized.default = String(defaultValue);
    }
  }
  if (Array.isArray(rawField.options)) {
    normalized.options = rawField.options.map((option) => String(option));
  }
  if (rawField.required === true) {
    normalized.required = true;
  }
  if (
    rawField.visibleIf &&
    typeof rawField.visibleIf === "object" &&
    typeof (rawField.visibleIf as { fieldId?: unknown }).fieldId === "string"
  ) {
    const visibleIf = rawField.visibleIf as {
      fieldId: string;
      equals?: unknown;
    };
    normalized.visibleIf = {
      fieldId: visibleIf.fieldId,
      equals:
        typeof visibleIf.equals === "boolean" ||
        typeof visibleIf.equals === "number"
          ? visibleIf.equals
          : String(visibleIf.equals ?? ""),
    };
  }
  if (typeof rawField.selector === "string") {
    normalized.selector = rawField.selector;
  }
  if (
    rawField.location &&
    typeof rawField.location === "object" &&
    Array.isArray((rawField.location as { path?: unknown }).path)
  ) {
    normalized.location = {
      path: (rawField.location as { path: unknown[] }).path.map((part) =>
        String(part),
      ),
    };
  }
  if (typeof rawField.settingId === "string" && rawField.settingId.length > 0) {
    normalized.sourceSettingId = rawField.settingId;
  }
  return normalized;
}

function normalizeSchema(rawSchema: unknown): NormalizedSchema {
  if (!rawSchema || typeof rawSchema !== "object") {
    return { version: "1", device: {}, sections: [] };
  }
  const source = rawSchema as Record<string, unknown>;
  const sectionsInput = Array.isArray(source.sections) ? source.sections : [];

  const hasGroups = sectionsInput.some(
    (section) =>
      section &&
      typeof section === "object" &&
      Array.isArray((section as { groups?: unknown }).groups),
  );

  if (hasGroups) {
    const sections: NormalizedSection[] = [];
    sectionsInput.forEach((rawSection, sectionIndex) => {
      if (!rawSection || typeof rawSection !== "object") {
        return;
      }
      const sectionObj = rawSection as Record<string, unknown>;
      const sectionId = String(sectionObj.id ?? `section_${sectionIndex}`);
      const sectionTitle = String(sectionObj.title ?? sectionId);
      const groupsInput = Array.isArray(sectionObj.groups)
        ? sectionObj.groups
        : [];
      const groups: NormalizedGroup[] = [];

      groupsInput.forEach((rawGroup, groupIndex) => {
        if (!rawGroup || typeof rawGroup !== "object") {
          return;
        }
        const groupObj = rawGroup as Record<string, unknown>;
        const groupId = String(
          groupObj.id ?? `${sectionId}_group_${groupIndex}`,
        );
        const groupTitle = String(groupObj.title ?? groupId);
        const subgroupsInput = Array.isArray(groupObj.subgroups)
          ? groupObj.subgroups
          : [];
        const subgroups: NormalizedSubgroup[] = [];

        subgroupsInput.forEach((rawSubgroup, subgroupIndex) => {
          if (!rawSubgroup || typeof rawSubgroup !== "object") {
            return;
          }
          const subgroupObj = rawSubgroup as Record<string, unknown>;
          const subgroupId = String(
            subgroupObj.id ?? `${groupId}_subgroup_${subgroupIndex}`,
          );
          const subgroupTitle = String(subgroupObj.title ?? subgroupId);
          const fieldsInput = Array.isArray(subgroupObj.fields)
            ? subgroupObj.fields
            : [];
          const fields: NormalizedField[] = [];
          fieldsInput.forEach((rawField, fieldIndex) => {
            if (!rawField || typeof rawField !== "object") {
              return;
            }
            const normalizedField = normalizeField(
              rawField as Record<string, unknown>,
              fieldIndex,
            );
            if (normalizedField) {
              fields.push(normalizedField);
            }
          });
          subgroups.push({
            id: subgroupId,
            title: subgroupTitle,
            defaultCollapsed: subgroupObj.defaultCollapsed === true,
            fields,
          });
        });

        groups.push({ id: groupId, title: groupTitle, subgroups });
      });

      sections.push({ id: sectionId, title: sectionTitle, groups });
    });

    return {
      version: String(source.version ?? "1"),
      device:
        source.device && typeof source.device === "object"
          ? (source.device as Record<string, unknown>)
          : {},
      sections,
    };
  }

  const sections: NormalizedSection[] = sectionsInput.map(
    (rawSection, sectionIndex) => {
      const sectionObj =
        rawSection && typeof rawSection === "object"
          ? (rawSection as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const sectionId = String(sectionObj.id ?? `section_${sectionIndex}`);
      const sectionTitle = String(sectionObj.title ?? sectionId);
      const fieldsInput = Array.isArray(sectionObj.fields)
        ? sectionObj.fields
        : [];
      const fields: NormalizedField[] = [];
      fieldsInput.forEach((rawField, fieldIndex) => {
        if (!rawField || typeof rawField !== "object") {
          return;
        }
        const normalizedField = normalizeField(
          rawField as Record<string, unknown>,
          fieldIndex,
        );
        if (normalizedField) {
          fields.push(normalizedField);
        }
      });
      return {
        id: sectionId,
        title: sectionTitle,
        groups: [
          {
            id: `${sectionId}_group`,
            title: sectionTitle,
            subgroups: [
              {
                id: `${sectionId}_subgroup`,
                title: "Settings",
                defaultCollapsed: false,
                fields,
              },
            ],
          },
        ],
      };
    },
  );

  return {
    version: String(source.version ?? "1"),
    device:
      source.device && typeof source.device === "object"
        ? (source.device as Record<string, unknown>)
        : {},
    sections,
  };
}

function readUiSettingCount(dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM ui_setting")
      .get() as { count: number };
    return Number(row.count ?? 0);
  } finally {
    db.close();
  }
}

async function ensureProfileSchemaData(
  dbPath: string,
  options?: { forceRefresh?: boolean },
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
  const startupPromise = ensureProfileSchemaData(profileDbPath).then(
    () => undefined,
  );

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

      if (pathname === "/api/form/schema" && req.method === "GET") {
        const schemaPath = await resolveSettingsSchemaPath();
        const schemaText = await readFile(schemaPath, "utf8");
        const schema = normalizeSchema(JSON.parse(schemaText));
        json(res, 200, schema);
        return;
      }

      if (pathname === "/api/profiles/schema" && req.method === "GET") {
        const bootstrap = await ensureProfileSchemaData(profileDbPath, {
          forceRefresh: url.searchParams.get("refresh") === "1",
        });
        const pages = await getProfileEditorPages(profileDbPath);
        if (bootstrap.reason === "map-not-found" && pages.length === 0) {
          json(res, 503, {
            error:
              "UI map is required before profiles can be authored. Set MAP_PATH or place a map file under state/.",
            bootstrap,
          });
          return;
        }
        json(res, 200, { pages, bootstrap });
        return;
      }

      if (pathname === "/api/profiles/list" && req.method === "GET") {
        const accountNumber =
          url.searchParams.get("accountNumber") ?? undefined;
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
          variation: String(body.variation),
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
        const rawValues = body.values as Array<{
          settingId?: unknown;
          value?: unknown;
          enabled?: unknown;
        }>;
        try {
          const profile = await saveProfile(profileDbPath, {
            accountNumber: String(body.accountNumber),
            variation: String(body.variation),
            displayName: body.displayName
              ? String(body.displayName)
              : undefined,
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
                    ),
            })),
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
          variation: String(body.variation),
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

      if (pathname.startsWith("/assets/")) {
        const relativeAssetPath = pathname.slice(1);
        await serveFile(res, path.join("ui", relativeAssetPath));
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
