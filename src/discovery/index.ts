import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  DISCOVERY_RANGE_END,
  DISCOVERY_RANGE_START,
  DISCOVERY_SUBNET,
  DISCOVERY_TIMEOUT_MS
} from "../config/env.js";
import net from "node:net";

const execAsync = promisify(exec);

export type DiscoveredDevice = {
  ip: string;
  mac?: string;
  reachable: boolean;
  source: "arp" | "ping" | "manual";
};

function parseArpTable(output: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(
      /(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F:-]{11,17})\s+(dynamic|static)?/i
    );
    if (match) {
      const ip = match[1];
      const mac = match[2];
      map.set(ip, mac);
    }
  }
  return map;
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

async function tcpProbe(ip: string, port: number, timeoutMs = 400): Promise<boolean> {
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

async function checkReachable(ip: string): Promise<boolean> {
  const pingOk = await pingHost(ip);
  if (!pingOk) return false;
  const httpOk = await tcpProbe(ip, 80);
  if (httpOk) return true;
  const httpsOk = await tcpProbe(ip, 443);
  return httpsOk;
}

async function pingSweep(subnet: string, start: number, end: number): Promise<string[]> {
  const ips: string[] = [];
  const concurrency = 20;
  const queue: string[] = [];
  for (let i = start; i <= end; i += 1) {
    queue.push(`${subnet}.${i}`);
  }

  let index = 0;
  const workers = new Array(concurrency).fill(null).map(async () => {
    while (index < queue.length) {
      const ip = queue[index];
      index += 1;
      const reachable = await checkReachable(ip);
      if (reachable) ips.push(ip);
    }
  });

  await Promise.all(workers);
  return ips;
}

export async function discoverDevices(): Promise<DiscoveredDevice[]> {
  const devices: DiscoveredDevice[] = [];
  let arpMap = new Map<string, string>();
  try {
    const { stdout } = await execAsync("arp -a");
    arpMap = parseArpTable(stdout);
  } catch {
    arpMap = new Map<string, string>();
  }

  const pinged = await pingSweep(DISCOVERY_SUBNET, DISCOVERY_RANGE_START, DISCOVERY_RANGE_END);
  for (const ip of pinged) {
    devices.push({
      ip,
      mac: arpMap.get(ip),
      reachable: true,
      source: "ping"
    });
  }

  for (const [ip, mac] of arpMap.entries()) {
    if (devices.find((d) => d.ip === ip)) continue;
    devices.push({
      ip,
      mac,
      reachable: false,
      source: "arp"
    });
  }

  return devices.sort((a, b) => a.ip.localeCompare(b.ip));
}
