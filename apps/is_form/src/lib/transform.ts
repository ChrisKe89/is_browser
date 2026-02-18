import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UISchemaField, UIControlType, UIValueType } from "./types.js";
import { validateSchema } from "./validateSchema.js";

type RawCaptureSetting = {
  order?: number;
  key?: string;
  type?: string;
  label?: string;
  context?: string;
  dependency?: string | null;
  selector?: string;
  dom_selector?: string;
  disabled?: boolean;
  current_value?: unknown;
  options?: string[];
};

type RawCapturePage = {
  url: string;
  settings: RawCaptureSetting[];
};

type RawCapture = {
  pages: RawCapturePage[];
};

type WorkingField = UISchemaField & {
  source_type: string;
  dependency?: string;
};

type ControlMapping = {
  control_type: UIControlType;
  value_type: UIValueType;
};

const DEFAULT_INPUT = path.resolve(
  process.cwd(),
  "data/settings-deterministic-manual-live.json",
);
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "data/ui_schema_fields.json");

const TYPE_MAP: Record<string, ControlMapping> = {
  combobox: { control_type: "dropdown", value_type: "enum" },
  checkbox: { control_type: "checkbox", value_type: "boolean" },
  textbox: { control_type: "text", value_type: "string" },
  spinbutton: { control_type: "number", value_type: "number" },
  radio: { control_type: "radio_group", value_type: "enum" },
  text: { control_type: "text_display", value_type: "none" },
  button_dialog: { control_type: "action_button", value_type: "none" },
};

export function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.pathname || "/"}${parsed.hash || ""}`;
  } catch {
    return rawUrl.trim();
  }
}

export function normalizeContext(context: string | undefined): string {
  const value = (context ?? "main").trim();
  return value.length > 0 ? value : "main";
}

export function computeFieldId(
  pagePath: string,
  context: string,
  domSelector: string,
): string {
  return `${pagePath}::${context}::${domSelector}`;
}

function parseRoleAndName(selector: string | undefined): {
  role?: string;
  name?: string;
} {
  if (!selector?.startsWith("role=")) {
    return {};
  }

  const role = selector.match(/^role=([^\[]+)/)?.[1];
  const name = selector.match(/name='([^']+)'/)?.[1];
  return {
    role,
    name,
  };
}

function toWorkingField(pageUrl: string, setting: RawCaptureSetting): WorkingField {
  const sourceType = setting.type ?? "text";
  const mapping = TYPE_MAP[sourceType] ?? TYPE_MAP.text;
  const pagePath = normalizeUrl(pageUrl);
  const context = normalizeContext(setting.context);
  const domSelector =
    setting.dom_selector?.trim() ||
    setting.selector?.trim() ||
    setting.key?.trim() ||
    "unknown";
  const containerId = `${pagePath}::${context}`;
  const { role, name } = parseRoleAndName(setting.selector);

  return {
    field_id: computeFieldId(pagePath, context, domSelector),
    container_id: containerId,
    page_path: pagePath,
    context,
    label: (setting.label ?? setting.key ?? domSelector).trim(),
    control_type: mapping.control_type,
    value_type: mapping.value_type,
    current_value: setting.current_value ?? null,
    default_value: setting.current_value ?? null,
    options: setting.options,
    locators: {
      role,
      name,
      selector: setting.selector,
      dom_selector: setting.dom_selector,
      dependency: setting.dependency ?? undefined,
    },
    disabled: setting.disabled,
    is_action_only: sourceType === "button_dialog",
    order: setting.order ?? 0,
    source_type: sourceType,
    dependency: setting.dependency ?? undefined,
  };
}

function groupRadioFields(fields: WorkingField[]): UISchemaField[] {
  const nonRadio = fields.filter((field) => field.source_type !== "radio");
  const radios = fields.filter((field) => field.source_type === "radio");
  const grouped = new Map<string, WorkingField[]>();

  for (const radio of radios) {
    const key = `${radio.container_id}::${radio.locators.dependency ?? ""}`;
    const existing = grouped.get(key) ?? [];
    existing.push(radio);
    grouped.set(key, existing);
  }

  const radioGroups: UISchemaField[] = [];
  for (const members of grouped.values()) {
    members.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const first = members[0];
    const options = members.map((member) => member.label);
    const selected = members.find((member) => member.current_value === true)?.label ?? null;
    const groupField: UISchemaField = {
      field_id: first.field_id,
      container_id: first.container_id,
      page_path: first.page_path,
      context: first.context,
      label: `Selection (${first.locators.dependency ?? "radio"})`,
      control_type: "radio_group",
      value_type: "enum",
      current_value: selected,
      default_value: selected,
      options,
      locators: {
        selector: first.locators.selector,
        dom_selector: first.locators.dom_selector,
        dependency: first.locators.dependency,
      },
      disabled: members.every((member) => member.disabled === true),
      radio_members: members.map((member) => ({
        option: member.label,
        selector: member.locators.selector,
        dom_selector: member.locators.dom_selector,
      })),
      order: first.order,
    };
    radioGroups.push(groupField);
  }

  const merged: UISchemaField[] = [...nonRadio, ...radioGroups];
  merged.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return merged.map((field) => ({
    field_id: field.field_id,
    container_id: field.container_id,
    page_path: field.page_path,
    context: field.context,
    label: field.label,
    control_type: field.control_type,
    value_type: field.value_type,
    current_value: field.current_value,
    default_value: field.default_value,
    options: field.options,
    locators: field.locators,
    disabled: field.disabled,
    is_action_only: field.is_action_only,
    radio_members: field.radio_members,
  }));
}

export function transformCaptureToSchema(capture: RawCapture): UISchemaField[] {
  const flattened: WorkingField[] = [];

  for (const page of capture.pages ?? []) {
    for (const setting of page.settings ?? []) {
      flattened.push(toWorkingField(page.url, setting));
    }
  }

  return groupRadioFields(flattened);
}

export async function transformCaptureToSchemaFile(
  inputPath = DEFAULT_INPUT,
  outputPath = DEFAULT_OUTPUT,
): Promise<{ count: number; warnings: string[] }> {
  const sourceText = await readFile(inputPath, "utf8");
  const capture = JSON.parse(sourceText) as RawCapture;
  const schema = transformCaptureToSchema(capture);
  const { warnings, errors } = validateSchema(schema);
  if (errors.length > 0) {
    throw new Error(`Schema validation failed:\n${errors.map((x) => `- ${x}`).join("\n")}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  return { count: schema.length, warnings };
}

async function runCli(): Promise<void> {
  const inputPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_INPUT);
  const outputPath = path.resolve(process.cwd(), process.argv[3] ?? DEFAULT_OUTPUT);
  const result = await transformCaptureToSchemaFile(inputPath, outputPath);
  console.log(`Transformed ${result.count} fields -> ${outputPath}`);
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (thisFile === invokedFile) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
