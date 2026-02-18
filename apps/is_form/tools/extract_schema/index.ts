import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSchema } from "./extractor.js";
import { readJsonFile, readYamlFile, writeOutputFiles } from "./io.js";
import type {
  CaptureInput,
  DeterministicInput,
  ExtractorInput,
  LayoutInput,
  NavigationInput,
} from "./types.js";

type CliOptions = {
  deterministic: string[];
  capture: string[];
  navigation: string[];
  layout: string[];
  outJson: string;
  outYaml: string;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(moduleDir, "..", "..");
const repoRoot = path.resolve(appRoot, "..", "..");

async function listPermissionSnapshots(): Promise<string[]> {
  const base = path.resolve(repoRoot, "permissions");
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.resolve(base, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function findDefaults(): Promise<CliOptions> {
  const snapshots = await listPermissionSnapshots();
  const deterministicDefaults = [
    path.resolve(appRoot, "data", "settings-deterministic-manual-live.json"),
  ];

  const captureDefaults = snapshots.map((dir) =>
    path.resolve(dir, "settings-capture-manual-live.json"),
  );

  const navigationDefaults = snapshots.map((dir) =>
    path.resolve(dir, "ui-tree.navigation.yaml"),
  );

  const layoutDefaults = snapshots.map((dir) => path.resolve(dir, "ui-tree.layout.yaml"));

  return {
    deterministic: deterministicDefaults,
    capture: captureDefaults,
    navigation: navigationDefaults,
    layout: layoutDefaults,
    outJson: path.resolve(appRoot, "schema", "extracted-schema.json"),
    outYaml: path.resolve(appRoot, "schema", "extracted-schema.yaml"),
  };
}

function normalizePaths(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(process.cwd(), value));
}

function parseArgMap(argv: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      result.set(key, [...(result.get(key) ?? []), "true"]);
      continue;
    }
    result.set(key, [...(result.get(key) ?? []), value]);
    i += 1;
  }
  return result;
}

function mergePaths(defaults: string[], overrides?: string[]): string[] {
  const values = overrides && overrides.length > 0 ? normalizePaths(overrides) : defaults;
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

async function loadInputs<T>(paths: string[], read: (filePath: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (const filePath of paths) {
    try {
      out.push(await read(filePath));
    } catch {
      // Missing files are ignored to support incremental growth.
    }
  }
  return out;
}

async function run(): Promise<void> {
  const defaults = await findDefaults();
  const args = parseArgMap(process.argv.slice(2));

  const deterministicPaths = mergePaths(defaults.deterministic, args.get("deterministic"));
  const capturePaths = mergePaths(defaults.capture, args.get("capture"));
  const navigationPaths = mergePaths(defaults.navigation, args.get("navigation"));
  const layoutPaths = mergePaths(defaults.layout, args.get("layout"));

  const outJson = args.get("out-json")?.[0]
    ? path.resolve(process.cwd(), args.get("out-json")?.[0] ?? defaults.outJson)
    : defaults.outJson;
  const outYaml = args.get("out-yaml")?.[0]
    ? path.resolve(process.cwd(), args.get("out-yaml")?.[0] ?? defaults.outYaml)
    : defaults.outYaml;

  const deterministicInputs = await loadInputs<DeterministicInput>(deterministicPaths, readJsonFile);
  const captureInputs = await loadInputs<CaptureInput>(capturePaths, readJsonFile);
  const navigationInputs = await loadInputs<NavigationInput>(navigationPaths, readYamlFile);
  const layoutInputs = await loadInputs<LayoutInput>(layoutPaths, readYamlFile);

  const input: ExtractorInput = {
    deterministicInputs,
    captureInputs,
    navigationInputs,
    layoutInputs,
    sourceFiles: {
      deterministic: deterministicPaths,
      capture: capturePaths,
      navigation: navigationPaths,
      layout: layoutPaths,
    },
  };

  const result = extractSchema(input);
  await writeOutputFiles({ jsonPath: outJson, yamlPath: outYaml, data: result.schema });

  console.log(`schema:extract wrote ${outJson}`);
  console.log(`schema:extract wrote ${outYaml}`);
  console.log(`schema:extract summary ${result.summaryLine}`);
  if (result.schema.warnings.length > 0) {
    for (const warning of result.schema.warnings) {
      console.log(`schema:extract warning ${warning}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
