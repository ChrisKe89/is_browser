import {
  DISCOVERY_RANGE_END,
  DISCOVERY_RANGE_START,
  DISCOVERY_SUBNET,
  PROFILE_DB_PATH
} from "../../../packages/platform/src/env.js";
import { discoverDevicesFromSubnets } from "./service.js";

function defaultSubnetRange(): string {
  if (DISCOVERY_RANGE_START === 1 && DISCOVERY_RANGE_END === 254) {
    return `${DISCOVERY_SUBNET}.0/24`;
  }
  return `${DISCOVERY_SUBNET}.${DISCOVERY_RANGE_START}-${DISCOVERY_SUBNET}.${DISCOVERY_RANGE_END}`;
}

export type DiscoveredDevice = {
  ip: string;
  reachable: boolean;
  source: "scan" | "manual";
  webUiReachable: boolean;
};

export async function discoverDevices(): Promise<DiscoveredDevice[]> {
  const devices = await discoverDevicesFromSubnets(PROFILE_DB_PATH, [defaultSubnetRange()]);
  return devices.map((device) => ({
    ip: device.ip,
    reachable: device.reachable,
    source: device.source,
    webUiReachable: device.webUiReachable
  }));
}

