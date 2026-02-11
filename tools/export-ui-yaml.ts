import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readMap, writeMap } from "@is-browser/contract";
import { attachCanonicalGraph } from "../apps/is_mapper/src/graph.js";
import { buildYamlViews, validateMapForYaml } from "../apps/is_mapper/src/yamlViews.js";

type Args = {
  mapPath: string;
  outDir: string;
};

function parseArgs(argv: string[]): Args {
  let mapPath = process.env.MAP_PATH ?? process.env.npm_config_map ?? "state/printer-ui-map.json";
  let outDir = process.env.YAML_OUT_DIR ?? process.env.npm_config_out_dir ?? "docs";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      if (!mapPath || mapPath === "state/printer-ui-map.json") {
        mapPath = arg;
        continue;
      }
      if (!outDir || outDir === "docs") {
        outDir = arg;
        continue;
      }
    }
    if (arg === "--map") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --map");
      mapPath = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--map=")) {
      mapPath = arg.slice("--map=".length);
      continue;
    }
    if (arg === "--out-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --out-dir");
      outDir = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--out-dir=")) {
      outDir = arg.slice("--out-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { mapPath, outDir };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const map = await readMap(args.mapPath);
  if (!map.nodes || !map.edges) {
    attachCanonicalGraph(map, {
      runId: path.basename(path.dirname(args.mapPath)) || "manual",
      capturedAt: new Date().toISOString(),
      mapperVersion: process.env.npm_package_version
    });
    await writeMap(args.mapPath, map);
  }

  validateMapForYaml(map, (warning) => console.warn(`[yaml-validation] ${warning}`));
  const { navigationYaml, layoutYaml } = buildYamlViews(map);
  await mkdir(args.outDir, { recursive: true });

  const navigationPath = path.join(args.outDir, "ui-tree.navigation.yaml");
  const layoutPath = path.join(args.outDir, "ui-tree.layout.yaml");
  await writeFile(navigationPath, navigationYaml, "utf8");
  await writeFile(layoutPath, layoutYaml, "utf8");

  console.log(`Wrote ${navigationPath}`);
  console.log(`Wrote ${layoutPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
