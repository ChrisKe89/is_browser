import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Selector = {
  kind: "role" | "label" | "css" | "text";
  role?: string;
  name?: string;
  value?: string;
};

type PageEntry = {
  id: string;
  title?: string;
  url: string;
};

type FieldEntry = {
  id: string;
  label?: string;
  type: "text" | "number" | "checkbox" | "radio" | "select" | "button" | "textarea";
  selectors: Selector[];
  pageId: string;
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
    readOnly?: boolean;
  };
};

type UiMap = {
  meta: {
    generatedAt: string;
    printerUrl: string;
    schemaVersion?: string;
  };
  pages: PageEntry[];
  fields: FieldEntry[];
};

const mapPath = process.env.MAP_INPUT_PATH ?? "state/printer-ui-map.clicks.json";
const graphPath = process.env.MAP_GRAPH_PATH ?? "state/printer-ui-map.clicks.relationships.mmd";
const reportPath = process.env.MAP_REL_REPORT_PATH ?? "state/printer-ui-map.clicks.relationships.md";
const fieldCsvPath = process.env.MAP_FIELD_CSV_PATH ?? "state/printer-ui-map.clicks.fields.csv";
const pageCsvPath = process.env.MAP_PAGE_CSV_PATH ?? "state/printer-ui-map.clicks.pages.csv";

function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function nodeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, "_");
}

function sectionForUrl(pageUrl: string): string {
  try {
    const pathname = new URL(pageUrl).pathname.toLowerCase();
    if (pathname.includes("/connectivity/")) return "Connectivity";
    if (pathname.includes("/system/")) return "System";
    if (pathname.includes("/permissions/")) return "Permissions";
    if (pathname.includes("/apps/")) return "Apps";
    if (pathname.includes("/home/")) return "Home";
    return "Other";
  } catch {
    return "Other";
  }
}

function shortLabel(text: string, max = 60): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

async function main(): Promise<void> {
  const raw = await readFile(mapPath, "utf8");
  const map = JSON.parse(raw) as UiMap;
  const pageById = new Map(map.pages.map((p) => [p.id, p]));

  const fieldsByPage = new Map<string, FieldEntry[]>();
  for (const field of map.fields) {
    const list = fieldsByPage.get(field.pageId) ?? [];
    list.push(field);
    fieldsByPage.set(field.pageId, list);
  }

  const sectionBuckets = new Map<string, PageEntry[]>();
  for (const page of map.pages) {
    const section = sectionForUrl(page.url);
    const list = sectionBuckets.get(section) ?? [];
    list.push(page);
    sectionBuckets.set(section, list);
  }

  const sections = ["Home", "Apps", "Connectivity", "Permissions", "System", "Other"];

  const mermaidLines: string[] = [];
  mermaidLines.push("flowchart LR");
  mermaidLines.push(`root["Printer UI Click Map\\nPages: ${map.pages.length} | Fields: ${map.fields.length}"]`);
  mermaidLines.push("classDef root fill:#1f2937,stroke:#111827,color:#fff;");
  mermaidLines.push("classDef section fill:#dbeafe,stroke:#1d4ed8,color:#111827;");
  mermaidLines.push("classDef page fill:#ecfeff,stroke:#0f766e,color:#0f172a;");
  mermaidLines.push("class root root;");

  for (const section of sections) {
    const pages = sectionBuckets.get(section) ?? [];
    if (pages.length === 0) continue;
    const sectionNode = nodeId(`section_${section}`);
    mermaidLines.push(`${sectionNode}["${section}\\n${pages.length} pages"]`);
    mermaidLines.push(`class ${sectionNode} section;`);
    mermaidLines.push(`root --> ${sectionNode}`);

    for (const page of pages) {
      const pageFields = fieldsByPage.get(page.id) ?? [];
      const counts = new Map<string, number>();
      for (const f of pageFields) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
      const typeSummary = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k}:${v}`)
        .join(" | ");
      const labelBase = page.title ?? page.id;
      const label = `${shortLabel(labelBase, 40)}\\n${shortLabel(page.id, 48)}\\nfields:${pageFields.length}${typeSummary ? ` | ${typeSummary}` : ""}`;
      const pageNode = nodeId(`page_${page.id}`);
      mermaidLines.push(`${pageNode}["${label.replace(/"/g, '\\"')}"]`);
      mermaidLines.push(`class ${pageNode} page;`);
      mermaidLines.push(`${sectionNode} --> ${pageNode}`);
    }
  }

  const fieldCsvLines: string[] = [];
  fieldCsvLines.push(
    [
      "field_id",
      "page_id",
      "page_title",
      "label",
      "type",
      "selector_count",
      "selectors",
      "enum_count",
      "enum_values",
      "min",
      "max",
      "pattern",
      "read_only"
    ].join(",")
  );
  for (const field of map.fields) {
    const page = pageById.get(field.pageId);
    const enumValues = field.constraints?.enum ?? [];
    fieldCsvLines.push(
      [
        escapeCsv(field.id),
        escapeCsv(field.pageId),
        escapeCsv(page?.title ?? ""),
        escapeCsv(field.label ?? ""),
        escapeCsv(field.type),
        escapeCsv(field.selectors.length),
        escapeCsv(
          field.selectors
            .map((s) => `${s.kind}:${s.role ?? ""}:${s.name ?? s.value ?? ""}`)
            .join(" || ")
        ),
        escapeCsv(enumValues.length),
        escapeCsv(enumValues.join(" | ")),
        escapeCsv(field.constraints?.min ?? ""),
        escapeCsv(field.constraints?.max ?? ""),
        escapeCsv(field.constraints?.pattern ?? ""),
        escapeCsv(field.constraints?.readOnly ?? "")
      ].join(",")
    );
  }

  const pageCsvLines: string[] = [];
  pageCsvLines.push(["page_id", "title", "url", "section", "field_count"].join(","));
  for (const page of map.pages) {
    pageCsvLines.push(
      [
        escapeCsv(page.id),
        escapeCsv(page.title ?? ""),
        escapeCsv(page.url),
        escapeCsv(sectionForUrl(page.url)),
        escapeCsv((fieldsByPage.get(page.id) ?? []).length)
      ].join(",")
    );
  }

  const topPages = [...map.pages]
    .map((p) => ({ page: p, count: (fieldsByPage.get(p.id) ?? []).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const reportLines: string[] = [];
  reportLines.push("# Printer UI Relationships (Click Capture)");
  reportLines.push("");
  reportLines.push(`- Source map: \`${mapPath}\``);
  reportLines.push(`- Generated: ${new Date().toISOString()}`);
  reportLines.push(`- Pages: ${map.pages.length}`);
  reportLines.push(`- Fields: ${map.fields.length}`);
  reportLines.push("");
  reportLines.push("## Overview Graph");
  reportLines.push("");
  reportLines.push("```mermaid");
  reportLines.push(...mermaidLines);
  reportLines.push("```");
  reportLines.push("");
  reportLines.push("## Top Pages By Field Count");
  reportLines.push("");
  reportLines.push("| Page ID | Title | Section | Fields |");
  reportLines.push("|---|---|---:|---:|");
  for (const item of topPages) {
    reportLines.push(
      `| ${item.page.id} | ${item.page.title ?? ""} | ${sectionForUrl(item.page.url)} | ${item.count} |`
    );
  }
  reportLines.push("");
  reportLines.push("## Data Files");
  reportLines.push("");
  reportLines.push(`- Mermaid graph: \`${graphPath}\``);
  reportLines.push(`- Page relationships CSV: \`${pageCsvPath}\``);
  reportLines.push(`- Field relationships CSV: \`${fieldCsvPath}\``);

  await writeFile(graphPath, `${mermaidLines.join("\n")}\n`, "utf8");
  await writeFile(fieldCsvPath, `${fieldCsvLines.join("\n")}\n`, "utf8");
  await writeFile(pageCsvPath, `${pageCsvLines.join("\n")}\n`, "utf8");
  await writeFile(reportPath, `${reportLines.join("\n")}\n`, "utf8");

  const reportDir = path.dirname(reportPath);
  process.stdout.write(
    `Generated relationship outputs in ${reportDir}\n` +
      `- ${reportPath}\n- ${graphPath}\n- ${pageCsvPath}\n- ${fieldCsvPath}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
