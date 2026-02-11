import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { PROFILE_DB_PATH } from "../../../packages/platform/src/env.js";
import { importUiMapFile } from "../../../packages/storage/src/importer.js";
import { importFieldOptionsFromCsvFile } from "../../../packages/storage/src/csvOptions.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const mapPath = process.argv[2] ?? process.env.MAP_PATH ?? "state/printer-ui-map.json";
  const dbPath = process.argv[3] ?? PROFILE_DB_PATH;
  const csvPath =
    process.argv[4] ??
    process.env.MAP_FIELD_CSV_PATH ??
    (mapPath.endsWith(".json") ? mapPath.replace(/\.json$/i, ".fields.csv") : "");
  const summary = await importUiMapFile(dbPath, mapPath);
  const csvSummary =
    csvPath && (await pathExists(csvPath))
      ? await importFieldOptionsFromCsvFile(dbPath, csvPath)
      : null;

  console.log(
    [
      `Imported UI map from ${mapPath} into ${dbPath}`,
      `pages=${summary.pages}`,
      `settings=${summary.settings}`,
      `selectors=${summary.selectors}`,
      `options=${summary.options}`,
      `navSteps=${summary.navSteps}`,
      csvSummary
        ? `csv=${csvPath} (updated=${csvSummary.settingsUpdated}, unchanged=${csvSummary.settingsUnchanged}, optionsWritten=${csvSummary.optionsWritten})`
        : "csv=none"
    ].join(" | ")
  );
}

run().catch((error) => {
  console.error(`Failed to import UI map: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

