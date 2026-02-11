import { readFile } from "node:fs/promises";
import path from "node:path";
import { CUSTOMER_MAP_CSV } from "@is-browser/env";

export type SettingsFile = {
  meta?: {
    customerName?: string;
    accountNumber?: string;
    variation?: string;
    scriptVariant?: string;
    model?: string;
    serial?: string;
    productCode?: string;
    rawSerialCombined?: string;
    createdAt?: string;
  };
  options?: {
    consoleVisible?: boolean;
    headless?: boolean;
    deviceLogMode?: "all-time" | "daily";
    autoDeploy?: boolean;
  };
  settings: Array<{ id?: string; label?: string; value: unknown }>;
  remotePanel?: {
    profileId?: string;
    steps?: Array<{
      action: "click" | "type" | "key" | "wait";
      x?: number;
      y?: number;
      key?: string;
      text?: string;
      delayMs?: number;
    }>;
  };
};

export async function readSettings(pathToFile: string): Promise<SettingsFile> {
  const raw = await readFile(pathToFile, "utf8");
  return JSON.parse(raw) as SettingsFile;
}

export function resolveCustomerFolder(customerName?: string, accountNumber?: string): string {
  const safeCustomer = sanitizePath(customerName ?? "unknown-customer");
  const safeAccount = sanitizePath(accountNumber ?? "unknown-account");
  return path.join("tools", "samples", "settings", `${safeCustomer} - ${safeAccount}`);
}

export async function resolveSettingsFromCsv(model?: string, serial?: string): Promise<string | null> {
  if (!model || !serial) return null;
  let raw = "";
  try {
    raw = await readFile(CUSTOMER_MAP_CSV, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) return null;
  const headers = lines[0].split(",").map((h) => h.trim());
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    if (row.model === model && row.serial === serial) {
      return row.settings_path || null;
    }
  }
  return null;
}

function sanitizePath(input: string): string {
  return input.replace(/[<>:"/\\|?*]+/g, "_").trim();
}

