import { writeCaptureArtifactsFromMapPath } from "./writeCaptureArtifacts.js";

async function main(): Promise<void> {
  const mapPath = process.argv[2] ?? process.env.MAP_PATH ?? "state/printer-ui-map.json";
  const distDir = process.argv[3] ?? "dist";
  const result = await writeCaptureArtifactsFromMapPath(mapPath, distDir);
  console.log(`Wrote ${result.paths.schema} (${result.schema.containers.length} containers, ${result.schema.settings.length} settings)`);
  console.log(`Wrote ${result.paths.form}`);
  console.log(`Wrote ${result.paths.verify}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
