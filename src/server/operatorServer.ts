import http from "node:http";
import path from "node:path";
import {
  CUSTOMER_MAP_CSV,
  DEVICE_LOG_MODE,
  FORM_PUBLIC_URL,
  OPERATOR_PORT,
  PROFILE_DB_PATH
} from "../config/env.js";
import { migrateDatabase } from "../db/migrations.js";
import { applySettings } from "../runner/applySettings.js";
import { type SettingsFile } from "../runner/settings.js";
import { buildSettingsFromProfile, ProfileValidationFailure } from "../db/profiles.js";
import {
  ensureDeviceResolutionSeededFromCsv,
  listVariationsForAccount,
  searchAccounts,
  variationMatchesModelRequirement
} from "../db/deviceResolution.js";
import { getOperatorDiscoveryConfig, saveOperatorDiscoveryConfig } from "../db/operatorConfig.js";
import {
  addManualDevice,
  discoverDevicesFromSubnets,
  type DiscoveredDevice,
  isValidIpv4
} from "../discovery/service.js";
import { parseBody, json, text, resolveMapPath, serveFile } from "./httpUtils.js";

type JobState = "IDLE" | "WORKING" | "COMPLETED" | "FAILED" | "USER INTERVENTION REQUIRED";

type ApplyContext = {
  ip: string;
  customerName?: string;
  accountNumber: string;
  variation: string;
  model?: string;
  serial?: string;
  productCode?: string;
  rawSerialCombined?: string;
};

type OperatorServerOptions = {
  profileDbPath?: string;
  customerMapCsvPath?: string;
  deviceLogMode?: "all-time" | "daily";
  formPublicUrl?: string;
  port?: number;
};

function mergeDevices(existing: DiscoveredDevice[], incoming: DiscoveredDevice[]): DiscoveredDevice[] {
  const merged = new Map<string, DiscoveredDevice>();
  for (const item of existing) {
    merged.set(item.ip, item);
  }
  for (const item of incoming) {
    const previous = merged.get(item.ip);
    merged.set(item.ip, previous ? { ...previous, ...item } : item);
  }
  return Array.from(merged.values()).sort((left, right) => left.ip.localeCompare(right.ip));
}

function ensureDeviceResolvableStatus(device: DiscoveredDevice): DiscoveredDevice {
  if (!device.reachable) {
    return { ...device, status: "UNREACHABLE", requiresIntervention: false, resolved: false };
  }
  if (!device.webUiReachable) {
    return { ...device, status: "WEBUI_UNREACHABLE" };
  }
  if (device.requiresIntervention) {
    return { ...device, status: "USER_INTERVENTION_REQUIRED", resolved: false };
  }
  return { ...device, status: "READY", resolved: true };
}

export function createOperatorServer(options?: OperatorServerOptions): http.Server {
  const profileDbPath = options?.profileDbPath ?? PROFILE_DB_PATH;
  const customerMapCsvPath = options?.customerMapCsvPath ?? CUSTOMER_MAP_CSV;
  const defaultDeviceLogMode = options?.deviceLogMode ?? DEVICE_LOG_MODE;
  const formPublicUrl = options?.formPublicUrl ?? FORM_PUBLIC_URL;

  const state = {
    devices: [] as DiscoveredDevice[],
    job: {
      state: "IDLE" as JobState,
      console: [] as string[],
      retryResolver: null as null | ((value: boolean) => void)
    }
  };

  function pushConsole(message: string): void {
    state.job.console.push(message);
    if (state.job.console.length > 400) {
      state.job.console.shift();
    }
    console.log(message);
  }

  function getDeviceByIp(ip: string): DiscoveredDevice | undefined {
    return state.devices.find((device) => device.ip === ip);
  }

  function startApplyJob(input: {
    context: ApplyContext;
    settings: SettingsFile;
    mapPath: string;
    deviceLogMode: "all-time" | "daily";
  }): void {
    state.job.state = "WORKING";
    state.job.console = [];
    pushConsole(`Starting job for ${input.context.ip}`);

    const settings = input.settings;
    const consoleVisible = settings.options?.consoleVisible ?? true;
    const headless = settings.options?.headless ?? false;

    applySettings({
      deviceIp: input.context.ip,
      settings,
      mapPath: input.mapPath,
      consoleVisible,
      headless,
      deviceLogMode: input.deviceLogMode,
      onConsole: (line) => pushConsole(line),
      onRetryPrompt: async () => {
        state.job.state = "USER INTERVENTION REQUIRED";
        pushConsole("Retry required. Waiting for /api/retry");
        return new Promise((resolve) => {
          state.job.retryResolver = resolve;
        });
      }
    })
      .then((result) => {
        state.job.state = result.status === "COMPLETED" ? "COMPLETED" : "FAILED";
        pushConsole(`Job finished: ${result.status}`);
      })
      .catch((error) => {
        state.job.state = "FAILED";
        pushConsole(`Job error: ${String(error)}`);
      });
  }

  async function bootstrapState(): Promise<void> {
    await migrateDatabase(profileDbPath);
    await ensureDeviceResolutionSeededFromCsv(profileDbPath, customerMapCsvPath);
  }

  const startupPromise = bootstrapState();

  return http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      text(res, 400, "Bad request");
      return;
    }

    try {
      await startupPromise;
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      if (pathname === "/api/operator/config" && req.method === "GET") {
        json(res, 200, { formUrl: formPublicUrl });
        return;
      }

      if (pathname === "/api/discovery/config" && req.method === "GET") {
        const config = await getOperatorDiscoveryConfig(profileDbPath);
        json(res, 200, { config });
        return;
      }

      if (pathname === "/api/discovery/config" && req.method === "POST") {
        const body = await parseBody(req);
        const subnetRanges = Array.isArray(body.subnetRanges)
          ? body.subnetRanges.map((value) => String(value))
          : undefined;
        const manualIps = Array.isArray(body.manualIps)
          ? body.manualIps.map((value) => String(value))
          : undefined;
        const csvMode = body.csvMode === "daily" || body.csvMode === "all-time" ? body.csvMode : undefined;
        const config = await saveOperatorDiscoveryConfig(profileDbPath, {
          subnetRanges,
          manualIps,
          csvMode
        });
        json(res, 200, { config });
        return;
      }

      if (pathname === "/api/discover" && req.method === "POST") {
        const body = await parseBody(req);
        const config = await getOperatorDiscoveryConfig(profileDbPath);
        const subnetRanges = Array.isArray(body.subnetRanges)
          ? body.subnetRanges.map((value) => String(value).trim()).filter(Boolean)
          : config.subnetRanges;

        state.job.state = "WORKING";
        pushConsole(`Starting discovery across ${subnetRanges.join(", ")}`);

        const scanned = await discoverDevicesFromSubnets(profileDbPath, subnetRanges);
        const manualSeed: DiscoveredDevice[] = [];
        for (const ip of config.manualIps) {
          if (!isValidIpv4(ip)) {
            pushConsole(`Skipping invalid saved manual IP: ${ip}`);
            continue;
          }
          try {
            manualSeed.push(await addManualDevice(profileDbPath, ip));
          } catch (error) {
            pushConsole(`Skipping unreachable saved manual IP ${ip}: ${String(error)}`);
          }
        }

        state.devices = mergeDevices([], mergeDevices(scanned, manualSeed).map(ensureDeviceResolvableStatus));
        state.job.state = "IDLE";
        pushConsole(`Discovery completed. ${state.devices.length} reachable devices.`);
        const interventionCount = state.devices.filter((device) => device.requiresIntervention).length;
        if (interventionCount > 0) {
          pushConsole(`USER INTERVENTION REQUIRED: ${interventionCount} unmatched device(s).`);
        }
        json(res, 200, { devices: state.devices, subnetRanges });
        return;
      }

      if (pathname === "/api/devices" && req.method === "GET") {
        json(res, 200, { devices: state.devices });
        return;
      }

      if (pathname === "/api/devices/manual" && req.method === "POST") {
        const body = await parseBody(req);
        const ip = String(body.ip ?? "").trim();
        if (!isValidIpv4(ip)) {
          json(res, 400, { error: "Manual device input must be a valid IPv4 address." });
          return;
        }

        const manual = ensureDeviceResolvableStatus(await addManualDevice(profileDbPath, ip));
        state.devices = mergeDevices(state.devices, [manual]);
        if (manual.requiresIntervention) {
          pushConsole(`USER INTERVENTION REQUIRED: manual device ${ip} is unmatched.`);
        }

        const config = await getOperatorDiscoveryConfig(profileDbPath);
        const manualIps = Array.from(new Set([...config.manualIps, ip])).sort((left, right) =>
          left.localeCompare(right)
        );
        await saveOperatorDiscoveryConfig(profileDbPath, { manualIps });
        json(res, 200, { device: manual, devices: state.devices });
        return;
      }

      if (pathname === "/api/devices/manual/delete" && req.method === "POST") {
        const body = await parseBody(req);
        const ip = String(body.ip ?? "").trim();
        if (!isValidIpv4(ip)) {
          json(res, 400, { error: "Manual device input must be a valid IPv4 address." });
          return;
        }

        const config = await getOperatorDiscoveryConfig(profileDbPath);
        const manualIps = config.manualIps.filter((item) => item !== ip);
        await saveOperatorDiscoveryConfig(profileDbPath, { manualIps });
        state.devices = state.devices.filter((device) => device.ip !== ip || device.source !== "manual");
        json(res, 200, { removed: true, devices: state.devices });
        return;
      }

      if (pathname === "/api/accounts" && req.method === "GET") {
        const query = url.searchParams.get("q") ?? "";
        const accounts = await searchAccounts(profileDbPath, query);
        json(res, 200, { accounts });
        return;
      }

      if (pathname === "/api/accounts/variations" && req.method === "GET") {
        const accountNumber = String(url.searchParams.get("accountNumber") ?? "").trim();
        if (!accountNumber) {
          json(res, 400, { error: "Missing accountNumber query value." });
          return;
        }
        const variations = await listVariationsForAccount(profileDbPath, accountNumber);
        json(res, 200, { accountNumber, variations });
        return;
      }

      if (pathname === "/api/devices/resolve" && req.method === "POST") {
        const body = await parseBody(req);
        const ip = String(body.ip ?? "").trim();
        const accountNumber = String(body.accountNumber ?? "").trim();
        const variation = String(body.variation ?? "").trim();
        const customerName = String(body.customerName ?? "").trim();
        if (!ip || !accountNumber || !variation) {
          json(res, 400, { error: "Missing ip, accountNumber, or variation." });
          return;
        }

        const current = getDeviceByIp(ip);
        if (!current) {
          json(res, 404, { error: "Device not found." });
          return;
        }

        if (current.model) {
          const allowed = await variationMatchesModelRequirement(profileDbPath, {
            accountNumber,
            variation,
            modelName: current.model
          });
          if (!allowed) {
            json(res, 400, {
              error: `Variation ${variation} does not satisfy model requirement for "${current.model}".`
            });
            return;
          }
        }

        const updated = ensureDeviceResolvableStatus({
          ...current,
          accountNumber,
          variation,
          customerName: customerName || current.customerName || "unknown",
          resolved: true,
          requiresIntervention: false
        });
        state.devices = mergeDevices(state.devices, [updated]);
        pushConsole(`Device ${ip} resolved to ${accountNumber}/${variation}.`);
        json(res, 200, { device: updated });
        return;
      }

      if (pathname === "/api/start" && req.method === "POST") {
        json(res, 410, {
          error:
            "File-based settings apply is disabled. Use /api/start/profile and a DB-backed profile from the form product."
        });
        return;
      }

      if (pathname === "/api/start/profile" && req.method === "POST") {
        const body = await parseBody(req);
        const ip = String(body.ip ?? "").trim();
        const accountNumber = String(body.accountNumber ?? "").trim();
        const variation = String(body.variation ?? "").trim();
        if (!isValidIpv4(ip) || !accountNumber || !variation) {
          json(res, 400, { error: "Missing or invalid ip, accountNumber, or variation." });
          return;
        }

        const device = getDeviceByIp(ip);
        if (device?.model) {
          const allowed = await variationMatchesModelRequirement(profileDbPath, {
            accountNumber,
            variation,
            modelName: device.model
          });
          if (!allowed) {
            json(res, 400, {
              error: `Variation ${variation} does not satisfy model requirement for "${device.model}".`
            });
            return;
          }
        }

        try {
          const mapPath = body.mapPath
            ? String(body.mapPath)
            : (await resolveMapPath()) ?? "state/printer-ui-map.json";
          const profileSettings = await buildSettingsFromProfile(profileDbPath, {
            accountNumber,
            variation
          });
          const config = await getOperatorDiscoveryConfig(profileDbPath);
          const deviceLogMode =
            body.deviceLogMode === "daily" || body.deviceLogMode === "all-time"
              ? body.deviceLogMode
              : config.csvMode || defaultDeviceLogMode;
          const customerName =
            body.customerName
              ? String(body.customerName)
              : device?.customerName
                ? String(device.customerName)
                : "unknown";

          const settings: SettingsFile = {
            meta: {
              customerName,
              accountNumber,
              variation,
              scriptVariant: String(body.scriptVariant ?? variation),
              model: device?.model,
              serial: device?.serial,
              productCode: device?.productCode,
              rawSerialCombined: device?.rawSerialCombined
            },
            options: {
              consoleVisible: body.consoleVisible === undefined ? true : Boolean(body.consoleVisible),
              headless: body.headless === undefined ? false : Boolean(body.headless),
              deviceLogMode
            },
            settings: profileSettings
          };

          startApplyJob({
            context: {
              ip,
              customerName,
              accountNumber,
              variation,
              model: device?.model,
              serial: device?.serial,
              productCode: device?.productCode,
              rawSerialCombined: device?.rawSerialCombined
            },
            mapPath,
            settings,
            deviceLogMode
          });
          json(res, 200, { status: "started" });
          return;
        } catch (error) {
          if (error instanceof ProfileValidationFailure) {
            json(res, 400, { error: error.message, fieldErrors: error.errors });
            return;
          }
          throw error;
        }
      }

      if (pathname === "/api/retry" && req.method === "POST") {
        if (state.job.retryResolver) {
          state.job.retryResolver(true);
          state.job.retryResolver = null;
          state.job.state = "WORKING";
          json(res, 200, { status: "resumed" });
          return;
        }
        json(res, 400, { error: "No retry pending" });
        return;
      }

      if (pathname === "/api/status" && req.method === "GET") {
        json(res, 200, { state: state.job.state, console: state.job.console });
        return;
      }

      if (pathname === "/" || pathname === "/operator.html") {
        await serveFile(res, path.join("ui", "operator.html"));
        return;
      }

      text(res, 404, "Not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    }
  });
}

export function startOperatorServer(options?: OperatorServerOptions): http.Server {
  const port = options?.port ?? OPERATOR_PORT;
  const server = createOperatorServer(options);
  server.listen(port, () => {
    console.log(`Operator server running on http://localhost:${port}`);
  });
  return server;
}
