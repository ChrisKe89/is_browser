import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type Selector = {
  kind?: string;
  value?: string;
  role?: string;
  name?: string;
};

type Field = {
  id: string;
  label?: string;
  type?: string;
  controlType?: string;
  currentValue?: string | number | boolean | null;
  selectors?: Selector[];
};

type UiMap = {
  fields?: Field[];
};

type Summary = {
  totalDropdowns: number;
  nullCurrentValue: number;
  remaining: Array<{ label: string; selector: string }>;
};

function selectorText(selectors: Selector[] = []): string {
  return (
    selectors.find((selector) => selector.kind === "css")?.value ??
    selectors.find((selector) => selector.kind === "role")?.name ??
    selectors.find((selector) => selector.kind === "label")?.value ??
    "(no selector)"
  );
}

function summarize(map: UiMap): Summary {
  const fields = map.fields ?? [];
  const dropdowns = fields.filter(
    (field) => field.controlType === "dropdown" || field.type === "select",
  );
  const remaining = dropdowns
    .filter(
      (field) =>
        field.currentValue === null || field.currentValue === undefined,
    )
    .map((field) => ({
      label: field.label ?? field.id,
      selector: selectorText(field.selectors),
    }));
  return {
    totalDropdowns: dropdowns.length,
    nullCurrentValue: remaining.length,
    remaining,
  };
}

async function resolveMapPath(input: string): Promise<string> {
  const direct = path.resolve(input);
  if (
    await stat(direct)
      .then(() => true)
      .catch(() => false)
  ) {
    return direct;
  }
  const repoRelative = path.resolve(process.cwd(), "..", "..", input);
  if (
    await stat(repoRelative)
      .then(() => true)
      .catch(() => false)
  ) {
    return repoRelative;
  }
  return direct;
}

async function readMap(mapPath: string): Promise<UiMap> {
  const resolvedPath = await resolveMapPath(mapPath);
  const raw = await readFile(resolvedPath, "utf8");
  return JSON.parse(raw) as UiMap;
}

function printSummary(title: string, summary: Summary): void {
  console.log(`${title}:`);
  console.log(`  total dropdowns: ${summary.totalDropdowns}`);
  console.log(
    `  dropdowns with null currentValue: ${summary.nullCurrentValue}`,
  );
  if (summary.remaining.length === 0) {
    console.log("  remaining null dropdowns: none");
    return;
  }
  console.log("  remaining null dropdowns:");
  for (const field of summary.remaining) {
    console.log(`    - ${field.label} :: ${field.selector}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv
    .slice(2)
    .map((arg) => arg.trim())
    .filter(Boolean);
  if (args.length === 0 || args.length > 2) {
    throw new Error(
      "Usage: tsx src/verifyDropdownValues.ts <after-map.json> [before-map.json]",
    );
  }

  const afterPath = await resolveMapPath(args[0]);
  const after = summarize(await readMap(args[0]));
  if (args.length === 1) {
    printSummary(`map ${afterPath}`, after);
    return;
  }

  const beforePath = await resolveMapPath(args[1]);
  const before = summarize(await readMap(args[1]));
  printSummary(`before ${beforePath}`, before);
  printSummary(`after ${afterPath}`, after);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
