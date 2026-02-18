export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeUrlPath(rawUrl: string): string {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) {
    return "/";
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.pathname || "/"}${parsed.hash || ""}`;
  } catch {
    return trimmed.replace(/^https?:\/\/[^/]+/i, "") || "/";
  }
}

export function normalizeContext(input: string | undefined): string {
  const value = (input ?? "main").trim();
  return value || "main";
}

export function normalizeSection(input: string | null | undefined): string {
  const value = (input ?? "").trim();
  if (!value) {
    return "_unsectioned";
  }
  return value;
}

export function sectionTitleFromKey(sectionKey: string): string {
  if (sectionKey === "_unsectioned") {
    return "General";
  }
  return sectionKey.replace(/^#/, "");
}

export function parseRoleSelector(selector: string | undefined): {
  role?: string;
  name?: string;
} {
  if (!selector || !selector.startsWith("role=")) {
    return {};
  }
  const role = selector.match(/^role=([^\[]+)/)?.[1];
  const name = selector.match(/name='([^']+)'/)?.[1];
  return { role, name };
}

export function deriveContainerKey(pageId: string, context: string): string {
  return slugify(`${pageId}::${normalizeContext(context)}`);
}

export function deriveFieldKey(params: {
  pageId: string;
  context: string;
  section: string;
  sourceId: string;
  label: string;
  controlType: string;
}): string {
  const candidateId = params.sourceId || params.label || params.controlType;
  return slugify(
    `${normalizeUrlPath(params.pageId)}::${normalizeContext(params.context)}::${normalizeSection(
      params.section,
    )}::${candidateId}::${params.controlType}`,
  );
}

export function radioClusterHint(
  dependency: string,
  section: string,
  id: string,
  name: string,
): string {
  if (dependency) {
    return slugify(dependency);
  }
  if (name) {
    return slugify(name);
  }
  if (id) {
    return slugify(id.replace(/[0-9]+$/g, ""));
  }
  return slugify(section);
}
