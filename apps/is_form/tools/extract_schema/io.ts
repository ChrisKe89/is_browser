import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item));
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort((a, b) => a.localeCompare(b))) {
      out[key] = sortObjectKeys(input[key]);
    }
    return out;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

export function stableYaml(value: unknown): string {
  return `${YAML.stringify(sortObjectKeys(value), { sortMapEntries: true, lineWidth: 0 })}`;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

export async function readYamlFile<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf8");
  return YAML.parse(content) as T;
}

export async function writeOutputFiles(params: {
  jsonPath: string;
  yamlPath: string;
  data: unknown;
}): Promise<void> {
  await mkdir(path.dirname(params.jsonPath), { recursive: true });
  await mkdir(path.dirname(params.yamlPath), { recursive: true });
  await writeFile(params.jsonPath, stableJson(params.data), "utf8");
  await writeFile(params.yamlPath, stableYaml(params.data), "utf8");
}
