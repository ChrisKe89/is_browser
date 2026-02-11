import { NAV_TIMEOUT_MS, PRINTER_URL } from "@is-browser/env";

export type MapperCliOptions = {
  manual: boolean;
  location?: string;
  screenshot: boolean;
  url: string;
  maxClicks?: number;
  timeoutMs: number;
};

function readNumberArg(flag: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

export function parseMapperCliArgs(argv: string[]): MapperCliOptions {
  let manual = false;
  let location: string | undefined = process.env.IS_MAPPER_LOCATION;
  let screenshot =
    (process.env.IS_MAPPER_SCREENSHOT ?? "").toLowerCase() === "true" ||
    process.env.IS_MAPPER_SCREENSHOT === "1" ||
    process.env.npm_config_screenshot === "true";
  let url = PRINTER_URL;
  let maxClicks: number | undefined;
  let timeoutMs = NAV_TIMEOUT_MS;

  if (!location && process.env.npm_config_location) {
    const npmLocation = process.env.npm_config_location;
    if (!["global", "user", "project"].includes(npmLocation)) {
      location = npmLocation;
    }
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manual") {
      manual = true;
      continue;
    }
    if (arg === "--screenshot") {
      screenshot = true;
      continue;
    }
    if (arg === "--location") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --location");
      location = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--location=")) {
      location = arg.slice("--location=".length);
      continue;
    }
    if (arg === "--url") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --url");
      url = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--max-clicks") {
      maxClicks = readNumberArg(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--max-clicks=")) {
      maxClicks = readNumberArg("--max-clicks", arg.slice("--max-clicks=".length));
      continue;
    }
    if (arg === "--timeout-ms") {
      timeoutMs = readNumberArg(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = readNumberArg("--timeout-ms", arg.slice("--timeout-ms=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { manual, location, screenshot, url, maxClicks, timeoutMs };
}
