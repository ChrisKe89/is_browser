import { DatabaseSync } from "node:sqlite";
import {
  DEVICE_LOG_MODE,
  DISCOVERY_RANGE_END,
  DISCOVERY_RANGE_START,
  DISCOVERY_SUBNET,
} from "@is-browser/env";
import { migrateDatabase } from "./migrations.js";

const DISCOVERY_CONFIG_KEY = "operator.discovery";

export type OperatorDiscoveryConfig = {
  subnetRanges: string[];
  manualIps: string[];
  csvMode: "all-time" | "daily";
  updatedAt: string;
};

function parseConfigPayload(
  payload: string | null,
): Omit<OperatorDiscoveryConfig, "updatedAt"> | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const subnetRanges = Array.isArray(parsed.subnetRanges)
      ? parsed.subnetRanges.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const manualIps = Array.isArray(parsed.manualIps)
      ? parsed.manualIps.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const csvMode = parsed.csvMode === "daily" ? "daily" : "all-time";
    return { subnetRanges, manualIps, csvMode };
  } catch {
    return null;
  }
}

function defaultSubnetRange(): string {
  if (DISCOVERY_RANGE_START === 1 && DISCOVERY_RANGE_END === 254) {
    return `${DISCOVERY_SUBNET}.0/24`;
  }
  return `${DISCOVERY_SUBNET}.${DISCOVERY_RANGE_START}-${DISCOVERY_SUBNET}.${DISCOVERY_RANGE_END}`;
}

function defaultConfig(): OperatorDiscoveryConfig {
  return {
    subnetRanges: [defaultSubnetRange()],
    manualIps: [],
    csvMode: DEVICE_LOG_MODE,
    updatedAt: new Date().toISOString(),
  };
}

export async function getOperatorDiscoveryConfig(
  dbPath: string,
): Promise<OperatorDiscoveryConfig> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare(
        "SELECT value_json, updated_at FROM operator_config WHERE key = ?",
      )
      .get(DISCOVERY_CONFIG_KEY) as
      | { value_json: string; updated_at: string }
      | undefined;
    if (!row) {
      return defaultConfig();
    }

    const parsed = parseConfigPayload(row.value_json);
    if (!parsed) {
      return defaultConfig();
    }

    return {
      subnetRanges:
        parsed.subnetRanges.length > 0
          ? parsed.subnetRanges
          : [defaultSubnetRange()],
      manualIps: parsed.manualIps,
      csvMode: parsed.csvMode,
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}

export async function saveOperatorDiscoveryConfig(
  dbPath: string,
  input: Partial<Omit<OperatorDiscoveryConfig, "updatedAt">>,
): Promise<OperatorDiscoveryConfig> {
  const current = await getOperatorDiscoveryConfig(dbPath);
  const merged: OperatorDiscoveryConfig = {
    subnetRanges:
      input.subnetRanges?.map((value) => value.trim()).filter(Boolean) ??
      current.subnetRanges,
    manualIps:
      input.manualIps?.map((value) => value.trim()).filter(Boolean) ??
      current.manualIps,
    csvMode: input.csvMode ?? current.csvMode,
    updatedAt: new Date().toISOString(),
  };

  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO operator_config (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    ).run(
      DISCOVERY_CONFIG_KEY,
      JSON.stringify({
        subnetRanges: merged.subnetRanges,
        manualIps: merged.manualIps,
        csvMode: merged.csvMode,
      }),
      merged.updatedAt,
    );
    return merged;
  } finally {
    db.close();
  }
}
