import { exec } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import {
  SNMP_COMMUNITY,
  SNMP_TIMEOUT_MS,
  SNMP_VERSION,
  DISCOVERY_TIMEOUT_MS
} from "../../../packages/platform/src/env.js";
import { resolveDeviceByModelAndSerial } from "../../../packages/storage/src/deviceResolution.js";

const execAsync = promisify(exec);

const SNMP_MODEL_OIDS = ["1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.25.3.2.1.3.1"];
const SNMP_SERIAL_OIDS = ["1.3.6.1.2.1.43.5.1.1.17.1"];

export type ScanSource = "scan" | "manual";

export type DeviceIdentity = {
  model?: string;
  serial?: string;
  productCode?: string;
  rawSerialCombined?: string;
};

export type DeviceResolution = {
  customerName: string;
  accountNumber: string;
  variation: string;
  resolved: boolean;
  requiresIntervention: boolean;
};

export type DiscoveredDevice = {
  ip: string;
  source: ScanSource;
  reachable: boolean;
  webUiReachable: boolean;
  model?: string;
  serial?: string;
  productCode?: string;
  rawSerialCombined?: string;
  customerName?: string;
  accountNumber?: string;
  variation?: string;
  resolved: boolean;
  requiresIntervention: boolean;
  status: "READY" | "UNREACHABLE" | "WEBUI_UNREACHABLE" | "USER_INTERVENTION_REQUIRED";
};

type IPv4Range = {
  start: number;
  end: number;
};

type DiscoveryRuntime = {
  pingHost: (ip: string) => Promise<boolean>;
  tcpProbe: (ip: string, port: number, timeoutMs?: number) => Promise<boolean>;
  fetchIdentity: (ip: string) => Promise<DeviceIdentity | null>;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isValidIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return false;
  }
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return false;
    }
  }
  return true;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((part) => Number(part));
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join(".");
}

function parseRangeToken(token: string): IPv4Range | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){2}$/.test(trimmed)) {
    const prefix = trimmed;
    const start = ipv4ToInt(`${prefix}.1`);
    const end = ipv4ToInt(`${prefix}.254`);
    return { start, end };
  }

  const rangeMatch = trimmed.match(
    /^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){3})$/
  );
  if (rangeMatch) {
    const startIp = rangeMatch[1];
    const endIp = rangeMatch[2];
    if (!isValidIpv4(startIp) || !isValidIpv4(endIp)) {
      throw new Error(`Invalid range token "${trimmed}".`);
    }
    const start = ipv4ToInt(startIp);
    const end = ipv4ToInt(endIp);
    if (end < start) {
      throw new Error(`Invalid range token "${trimmed}": end < start.`);
    }
    return { start, end };
  }

  const cidrMatch = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (cidrMatch) {
    const ip = cidrMatch[1];
    const prefixLength = Number(cidrMatch[2]);
    if (!isValidIpv4(ip)) {
      throw new Error(`Invalid CIDR token "${trimmed}".`);
    }
    if (!Number.isInteger(prefixLength) || prefixLength < 16 || prefixLength > 32) {
      throw new Error(`Unsupported CIDR token "${trimmed}". Use /16 to /32.`);
    }
    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    const start = ipv4ToInt(ip) & mask;
    const hostCount = 2 ** (32 - prefixLength);
    const end = start + hostCount - 1;
    if (prefixLength <= 30) {
      return { start: start + 1, end: end - 1 };
    }
    return { start, end };
  }

  throw new Error(`Unsupported subnet token "${trimmed}".`);
}

export function expandSubnetRanges(subnetRanges: string[]): string[] {
  const ranges = subnetRanges
    .map((value) => parseRangeToken(value))
    .filter((value): value is IPv4Range => value !== null);
  if (ranges.length === 0) {
    return [];
  }

  const ips = new Set<string>();
  for (const range of ranges) {
    const size = range.end - range.start + 1;
    if (size > 4096) {
      throw new Error("Range exceeds 4096 addresses. Split into smaller ranges.");
    }
    for (let value = range.start; value <= range.end; value += 1) {
      ips.add(intToIpv4(value));
    }
  }
  return Array.from(ips).sort((left, right) => ipv4ToInt(left) - ipv4ToInt(right));
}

async function pingHost(ip: string): Promise<boolean> {
  const timeout = Math.max(DISCOVERY_TIMEOUT_MS, 100);
  try {
    await execAsync(`ping -n 1 -w ${timeout} ${ip}`);
    return true;
  } catch {
    return false;
  }
}

async function tcpProbe(ip: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });
}

function parseSnmpValue(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const valueIndex = line.indexOf("=");
    if (valueIndex < 0) {
      continue;
    }
    const rawValue = line.slice(valueIndex + 1).replace(/^.*?:/, "").trim();
    if (rawValue) {
      return rawValue.replace(/^"(.*)"$/, "$1").trim();
    }
  }
  return "";
}

function normalizeCombinedIdentity(rawValue: string): DeviceIdentity {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.length > 6) {
    const serial = trimmed.slice(-6).padStart(6, "0");
    const productCode = trimmed.slice(0, -6).trim();
    return {
      serial,
      productCode: productCode || undefined,
      rawSerialCombined: trimmed
    };
  }
  return { serial: trimmed.padStart(6, "0") };
}

async function fetchIdentity(ip: string): Promise<DeviceIdentity | null> {
  const version = SNMP_VERSION === "1" ? "1" : "2c";
  const timeoutSeconds = Math.max(Math.ceil(SNMP_TIMEOUT_MS / 1000), 1);
  const modelArgs = SNMP_MODEL_OIDS.join(" ");
  const serialArgs = SNMP_SERIAL_OIDS.join(" ");

  try {
    const modelResult = await execAsync(
      `snmpget -v ${version} -c ${SNMP_COMMUNITY} -t ${timeoutSeconds} -r 0 ${ip} ${modelArgs}`
    ).catch(() => ({ stdout: "" }));
    const serialResult = await execAsync(
      `snmpget -v ${version} -c ${SNMP_COMMUNITY} -t ${timeoutSeconds} -r 0 ${ip} ${serialArgs}`
    ).catch(() => ({ stdout: "" }));
    const model = parseSnmpValue(modelResult.stdout);
    const serialRaw = parseSnmpValue(serialResult.stdout);
    const combined = normalizeCombinedIdentity(serialRaw);

    if (!model && !combined.serial) {
      return null;
    }
    return {
      model: model || undefined,
      serial: combined.serial,
      productCode: combined.productCode,
      rawSerialCombined: combined.rawSerialCombined
    };
  } catch (error) {
    // Runtime can operate without SNMP tooling.
    console.warn(`SNMP identity lookup failed for ${ip}: ${toErrorMessage(error)}`);
    return null;
  }
}

async function evaluateDevice(
  dbPath: string,
  ip: string,
  source: ScanSource,
  runtime: DiscoveryRuntime
): Promise<DiscoveredDevice> {
  const pingOk = await runtime.pingHost(ip);
  const httpOk = await runtime.tcpProbe(ip, 80);
  const httpsOk = await runtime.tcpProbe(ip, 443);
  const webUiReachable = httpOk || httpsOk;
  const reachable = pingOk || webUiReachable;

  if (!reachable) {
    return {
      ip,
      source,
      reachable: false,
      webUiReachable: false,
      resolved: false,
      requiresIntervention: false,
      status: "UNREACHABLE"
    };
  }

  const identity = await runtime.fetchIdentity(ip);
  let resolved = false;
  let requiresIntervention = false;
  let resolution: DeviceResolution | null = null;
  if (identity?.model && identity?.serial) {
    const matched = await resolveDeviceByModelAndSerial(dbPath, {
      modelName: identity.model,
      serial: identity.serial
    });
    if (matched) {
      resolution = {
        customerName: matched.customerName,
        accountNumber: matched.accountNumber,
        variation: matched.variation,
        resolved: true,
        requiresIntervention: false
      };
      resolved = true;
    } else {
      resolution = null;
      requiresIntervention = true;
    }
  }

  return {
    ip,
    source,
    reachable,
    webUiReachable,
    model: identity?.model,
    serial: identity?.serial,
    productCode: identity?.productCode,
    rawSerialCombined: identity?.rawSerialCombined,
    customerName: resolution?.customerName,
    accountNumber: resolution?.accountNumber,
    variation: resolution?.variation,
    resolved,
    requiresIntervention,
    status: !webUiReachable
      ? "WEBUI_UNREACHABLE"
      : requiresIntervention
        ? "USER_INTERVENTION_REQUIRED"
        : "READY"
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  callback: (item: TInput) => Promise<TOutput>
): Promise<TOutput[]> {
  const results: TOutput[] = [];
  let index = 0;
  const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await callback(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function discoverDevicesFromSubnets(
  dbPath: string,
  subnetRanges: string[],
  runtimeOverrides?: Partial<DiscoveryRuntime>
): Promise<DiscoveredDevice[]> {
  const runtime: DiscoveryRuntime = {
    pingHost,
    tcpProbe,
    fetchIdentity,
    ...runtimeOverrides
  };
  const ips = expandSubnetRanges(subnetRanges);
  const evaluated = await mapWithConcurrency(ips, 20, (ip) => evaluateDevice(dbPath, ip, "scan", runtime));
  return evaluated.filter((device) => device.reachable);
}

export async function addManualDevice(
  dbPath: string,
  ip: string,
  runtimeOverrides?: Partial<DiscoveryRuntime>
): Promise<DiscoveredDevice> {
  if (!isValidIpv4(ip)) {
    throw new Error("Manual device input must be a valid IPv4 address.");
  }
  const runtime: DiscoveryRuntime = {
    pingHost,
    tcpProbe,
    fetchIdentity,
    ...runtimeOverrides
  };
  const device = await evaluateDevice(dbPath, ip, "manual", runtime);
  if (!device.reachable) {
    throw new Error(`Device ${ip} is not reachable.`);
  }
  return device;
}

