import { requireCreds, DEVICE_LOG_MODE, PROFILE_DB_PATH, HEADLESS } from "../../../packages/platform/src/env.js";
import { applySettings } from "./applySettings.js";
import { buildSettingsFromProfile } from "../../../packages/storage/src/profiles.js";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

async function run(): Promise<void> {
  requireCreds();

  const accountNumber = process.env.APPLY_ACCOUNT_NUMBER?.trim();
  const variation = process.env.APPLY_VARIATION?.trim() ?? "default";
  if (!accountNumber) {
    throw new Error("Missing APPLY_ACCOUNT_NUMBER. Settings are now loaded from DB profiles only.");
  }

  const mapPath = process.env.MAP_PATH ?? "state/printer-ui-map.json";
  const ip = process.env.PRINTER_IP ?? new URL(process.env.PRINTER_URL ?? "http://192.168.0.107").hostname;
  const profileSettings = await buildSettingsFromProfile(PROFILE_DB_PATH, { accountNumber, variation });

  const settings = {
    meta: {
      customerName: process.env.APPLY_CUSTOMER_NAME?.trim() || "unknown",
      accountNumber,
      variation,
      scriptVariant: process.env.APPLY_SCRIPT_VARIANT?.trim() || variation
    },
    options: {
      headless: parseBoolean(process.env.APPLY_HEADLESS, HEADLESS),
      consoleVisible: parseBoolean(process.env.APPLY_CONSOLE_VISIBLE, true),
      deviceLogMode:
        process.env.APPLY_DEVICE_LOG_MODE === "daily" || process.env.APPLY_DEVICE_LOG_MODE === "all-time"
          ? process.env.APPLY_DEVICE_LOG_MODE
          : DEVICE_LOG_MODE
    },
    settings: profileSettings
  };

  await applySettings({
    deviceIp: ip,
    settings,
    mapPath,
    headless: settings.options?.headless,
    consoleVisible: settings.options?.consoleVisible,
    deviceLogMode: settings.options?.deviceLogMode ?? DEVICE_LOG_MODE
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

