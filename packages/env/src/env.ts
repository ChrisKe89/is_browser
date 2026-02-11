import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_ENV_PATH = path.resolve(THIS_FILE_DIR, "../../../.env");

if (existsSync(REPO_ROOT_ENV_PATH)) {
  dotenv.config({ path: REPO_ROOT_ENV_PATH });
} else {
  dotenv.config();
}

export const PRINTER_URL = process.env.PRINTER_URL ?? "http://192.168.0.107";
export const PRINTER_USER = process.env.PRINTER_USER ?? "";
export const PRINTER_PASS = process.env.PRINTER_PASS ?? "";
export const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 30000);
export const HEADLESS = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
export const AUTH_STATE_PATH = process.env.AUTH_STATE_PATH ?? "state/auth-state.json";
export const USE_AUTH_STATE = (process.env.USE_AUTH_STATE ?? "false").toLowerCase() !== "false";
export const REMOTE_PANEL_URL = process.env.REMOTE_PANEL_URL ?? "";
export const REMOTE_PANEL_PROFILE = process.env.REMOTE_PANEL_PROFILE ?? "default";
export const DISCOVERY_SUBNET = process.env.DISCOVERY_SUBNET ?? "192.168.0";
export const DISCOVERY_RANGE_START = Number(process.env.DISCOVERY_RANGE_START ?? 1);
export const DISCOVERY_RANGE_END = Number(process.env.DISCOVERY_RANGE_END ?? 254);
export const DISCOVERY_TIMEOUT_MS = Number(process.env.DISCOVERY_TIMEOUT_MS ?? 250);
export const SNMP_COMMUNITY = process.env.SNMP_COMMUNITY ?? "public";
export const SNMP_VERSION = process.env.SNMP_VERSION ?? "2c";
export const SNMP_TIMEOUT_MS = Number(process.env.SNMP_TIMEOUT_MS ?? 2000);
export const OPERATOR_PORT = Number(process.env.OPERATOR_PORT ?? 5050);
export const FORM_PORT = Number(process.env.FORM_PORT ?? 5051);
export const OPERATOR_PUBLIC_URL =
  process.env.OPERATOR_PUBLIC_URL ?? `http://localhost:${OPERATOR_PORT}`;
export const FORM_PUBLIC_URL = process.env.FORM_PUBLIC_URL ?? `http://localhost:${FORM_PORT}`;
export const DEVICE_LOG_MODE = (process.env.DEVICE_LOG_MODE ?? "all-time") as
  | "all-time"
  | "daily";
export const CUSTOMER_MAP_CSV =
  process.env.CUSTOMER_MAP_CSV ?? "../../tools/samples/devices/customer-map.csv";
export const PROFILE_DB_PATH = process.env.PROFILE_DB_PATH ?? "state/profile-runner.sqlite";
export const CRAWL_MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES ?? 200);
export const CRAWL_INCLUDE_HASH =
  (process.env.CRAWL_INCLUDE_HASH ?? "true").toLowerCase() !== "false";
export const CRAWL_EXPAND_CHOICES =
  (process.env.CRAWL_EXPAND_CHOICES ?? "true").toLowerCase() !== "false";
export const CRAWL_FLOWS_PATH = process.env.CRAWL_FLOWS_PATH ?? "config/crawler-flows.json";
export const CRAWL_MENU_TRAVERSE =
  (process.env.CRAWL_MENU_TRAVERSE ?? "true").toLowerCase() !== "false";
export const CRAWL_SEED_PATHS = (process.env.CRAWL_SEED_PATHS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function requireCreds(): void {
  if (!PRINTER_USER || !PRINTER_PASS) {
    throw new Error("Missing PRINTER_USER or PRINTER_PASS in environment.");
  }
}
