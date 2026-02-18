export const VALUELESS_CONTROL_TYPES = new Set([
  "button_dialog",
  "action",
  "button",
  "link"
]);

export function isValuelessControl(controlType: string): boolean {
  return VALUELESS_CONTROL_TYPES.has(controlType);
}

export function canonicalizeUrlForIdentity(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.pathname}${u.hash ?? ""}`;
  } catch {
    return rawUrl;
  }
}
