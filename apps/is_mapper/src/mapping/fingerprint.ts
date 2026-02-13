import { createHash } from "node:crypto";
import { type FieldEntry, type Selector } from "@is-browser/contract";

function selectorToKey(selector: Selector): string {
  if (selector.kind === "role") {
    return `role:${selector.role ?? ""}:${selector.name ?? ""}`;
  }
  if (selector.kind === "label") {
    return `label:${selector.value ?? ""}`;
  }
  if (selector.kind === "css") {
    return `css:${selector.value ?? ""}`;
  }
  return `text:${selector.value ?? ""}`;
}

function hashValue(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

export function canonicalSelectorKey(selectors: Selector[]): string {
  const role = selectors.find((selector) => selector.kind === "role");
  if (role) return selectorToKey(role);
  const label = selectors.find((selector) => selector.kind === "label");
  if (label) return selectorToKey(label);
  const css = selectors.find((selector) => selector.kind === "css");
  if (css) return selectorToKey(css);
  return selectors[0] ? selectorToKey(selectors[0]) : "unknown";
}

export function fieldFingerprint(
  type: FieldEntry["type"],
  selectors: Selector[],
  label?: string,
): string {
  const normalizedLabel = (label ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return hashValue(
    `${type}|${canonicalSelectorKey(selectors)}|${normalizedLabel}`,
  );
}
