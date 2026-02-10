import { MapSchema, type UiMap } from "./types.js";
import { readFile, writeFile } from "node:fs/promises";

export async function writeMap(path: string, map: UiMap): Promise<void> {
  const parsed = MapSchema.parse(map);
  await writeFile(path, JSON.stringify(parsed, null, 2), "utf8");
}

export async function readMap(path: string): Promise<UiMap> {
  const raw = await readFile(path, "utf8");
  return MapSchema.parse(JSON.parse(raw));
}
