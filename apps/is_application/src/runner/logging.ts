import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LogEntry = {
  timestamp: string;
  step: string;
  status: "ok" | "error";
  message: string;
  fieldId?: string;
  error?: string;
};

export type DeviceLogContext = {
  customerName: string;
  accountNumber: string;
  serial: string;
  model: string;
  productCode?: string;
  deviceIp: string;
  scriptApplied: string;
  scriptLocation: string;
  rawSerialCombined?: string;
};

export async function writeDeviceLog(
  context: DeviceLogContext,
  entries: LogEntry[],
  status: "COMPLETED" | "FAILED"
): Promise<string> {
  const identity = normalizeIdentity(context);
  const safeCustomer = sanitizePath(`${context.customerName} - ${context.accountNumber}`);
  const safeDevice = sanitizePath(`${identity.serial}_${context.model}`);
  const dir = path.join("devices", "logs", "customers", safeCustomer);
  await mkdir(dir, { recursive: true });
  const logPath = path.join(dir, `${safeDevice}.json`);
  const payload = {
    meta: {
      createdAt: new Date().toISOString(),
      status,
      deviceIp: context.deviceIp,
      serial: identity.serial,
      model: context.model,
      productCode: identity.productCode,
      customerName: context.customerName,
      accountNumber: context.accountNumber,
      scriptApplied: context.scriptApplied,
      scriptLocation: context.scriptLocation
    },
    entries
  };
  await writeFile(logPath, JSON.stringify(payload, null, 2), "utf8");
  return logPath;
}

export async function appendDeviceReport(
  context: DeviceLogContext,
  status: "COMPLETED" | "FAILED",
  mode: "all-time" | "daily"
): Promise<string> {
  const identity = normalizeIdentity(context);
  const dir = path.join("devices", "reports");
  await mkdir(dir, { recursive: true });
  const date = new Date();
  const dateStamp = date.toISOString().slice(0, 10);
  const fileName = mode === "daily" ? `${dateStamp}-device_log.csv` : "device_log.csv";
  const filePath = path.join(dir, fileName);

  const headers =
    "date,device,product_code,serial,customer_name,account,script_applied,script_location,status";
  const line = [
    dateStamp,
    context.deviceIp,
    identity.productCode ?? "",
    identity.serial,
    context.customerName,
    context.accountNumber,
    context.scriptApplied,
    context.scriptLocation,
    status
  ]
    .map((value) => `"${String(value).replace(/\"/g, '""')}"`)
    .join(",");

  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    existing = "";
  }

  const content = existing.trim().length > 0 ? `${existing.trim()}\n${line}\n` : `${headers}\n${line}\n`;
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function normalizeIdentity(context: DeviceLogContext): { serial: string; productCode?: string } {
  if (context.rawSerialCombined) {
    const { productCode, serial } = splitProductCodeAndSerial(context.rawSerialCombined);
    return { serial, productCode };
  }
  if (context.productCode || context.serial) {
    return { serial: context.serial, productCode: context.productCode };
  }
  return { serial: "unknown", productCode: undefined };
}

export function splitProductCodeAndSerial(raw: string): { productCode: string; serial: string } {
  const trimmed = String(raw ?? "").trim();
  if (trimmed.length <= 6) {
    return { productCode: "", serial: trimmed.padStart(6, "0") };
  }
  const serial = trimmed.slice(-6).padStart(6, "0");
  const productCode = trimmed.slice(0, -6);
  return { productCode, serial };
}

function sanitizePath(input: string): string {
  return input.replace(/[<>:"/\\|?*]+/g, "_").trim();
}

