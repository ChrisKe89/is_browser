import { MapSchema, type UiMap, assertUiMapCompatible } from "./uiMap.js";
import { readFile, writeFile } from "node:fs/promises";

export async function writeMap(path: string, map: UiMap): Promise<void> {
  const parsed = MapSchema.parse(map);
  assertUiMapCompatible(parsed);
  await writeFile(path, JSON.stringify(parsed, null, 2), "utf8");
}

export async function readMap(path: string): Promise<UiMap> {
  const raw = await readFile(path, "utf8");
  const parsed = MapSchema.parse(JSON.parse(raw));
  assertUiMapCompatible(parsed);
  return parsed;
}
