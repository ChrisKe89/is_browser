import { z } from "zod";

export const UI_MAP_SCHEMA_VERSION = "1.1";

export const SelectorSchema = z.object({
  kind: z.enum(["role", "label", "css", "text"]),
  priority: z.number().int().positive().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
});

export const NavStepSchema = z.object({
  action: z.enum(["goto", "click"]),
  selector: SelectorSchema.optional(),
  url: z.string().optional(),
  label: z.string().optional(),
  kind: z
    .enum([
      "tab",
      "link",
      "button",
      "menu",
      "row",
      "icon",
      "radio_select",
      "dropdown_trigger",
      "combobox",
      "modal_open",
      "modal_close",
      "dismiss_alert",
      "system_alert",
      "unknown",
    ])
    .optional(),
  urlBefore: z.string().optional(),
  urlAfter: z.string().optional(),
  frameUrl: z.string().optional(),
  timestamp: z.string().optional(),
});

const DiscoverableActionSchema = z.object({
  selector: SelectorSchema,
  label: z.string().optional(),
});

export const PageSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  url: z.string(),
  breadcrumbs: z.array(z.string()).optional(),
  navPath: z.array(NavStepSchema).optional(),
  actions: z.array(DiscoverableActionSchema).optional(),
});

export const FieldSchema = z.object({
  id: z.string(),
  fieldId: z.string().optional(),
  label: z.string().optional(),
  labelQuality: z.enum(["explicit", "derived", "missing"]).optional(),
  type: z.enum([
    "text",
    "number",
    "checkbox",
    "radio",
    "select",
    "button",
    "textarea",
  ]),
  selectors: z.array(SelectorSchema),
  pageId: z.string(),
  selectorKey: z.string().optional(),
  groupKey: z.string().optional(),
  groupTitle: z.string().optional(),
  groupOrder: z.number().int().optional(),
  controlType: z
    .enum([
      "switch",
      "checkbox",
      "textbox",
      "number",
      "dropdown",
      "radio_group",
      "button",
      "staticTextButton",
      "unknown",
    ])
    .optional(),
  valueType: z
    .enum(["string", "number", "boolean", "enum", "unknown"])
    .optional(),
  defaultValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  currentValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  currentLabel: z.string().optional(),
  valueQuality: z
    .enum([
      "native-select",
      "trigger-text",
      "opened-options",
      "static-text",
      "missing",
      "unknown",
    ])
    .optional(),
  valueQualityReason: z.string().optional(),
  opensModal: z.boolean().optional(),
  modalRef: z.string().optional(),
  modalTitle: z.string().optional(),
  interaction: z.enum(["opensModal"]).optional(),
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  constraints: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().optional(),
      maxLength: z.number().int().optional(),
      pattern: z.string().optional(),
      inputMode: z.string().optional(),
      enum: z.array(z.string()).optional(),
      readOnly: z.boolean().optional(),
    })
    .optional(),
  hints: z.array(z.string()).optional(),
  rangeHint: z.string().optional(),
  readonly: z.boolean().optional(),
  visibility: z
    .object({
      visible: z.boolean(),
      enabled: z.boolean(),
    })
    .optional(),
  dependencies: z
    .array(
      z.object({
        when: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        reveals: z.array(z.string()).optional(),
        hides: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  source: z
    .object({
      discoveredFrom: z.enum(["scan", "variant", "click"]),
      runId: z.string(),
    })
    .optional(),
  actions: z.array(DiscoverableActionSchema).optional(),
});

export const GroupSchema = z.object({
  groupId: z.string(),
  title: z.string(),
  order: z.number().int(),
  fields: z.array(FieldSchema),
});

export const ActionSchema = z.object({
  label: z.string(),
  kind: z.enum(["save", "cancel", "apply", "close", "reset", "unknown"]),
  selector: SelectorSchema,
});

export const NodeSchema = z.object({
  nodeId: z.string(),
  kind: z.enum(["page", "modal", "drawer", "iframe"]),
  title: z.string(),
  url: z.string(),
  frameUrl: z.string().optional(),
  breadcrumbs: z.array(z.string()).optional(),
  navPath: z.array(NavStepSchema).optional(),
  groups: z.array(GroupSchema),
  actions: z.array(ActionSchema),
  fingerprint: z.string(),
  snapshots: z
    .object({
      screenshotPath: z.string().optional(),
      domHash: z.string().optional(),
    })
    .optional(),
});

export const EdgeSchema = z.object({
  fromNodeId: z.string(),
  toNodeId: z.string(),
  trigger: NavStepSchema,
  edgeType: z.enum([
    "navigate",
    "open_modal",
    "close_modal",
    "tab_switch",
    "dismiss_alert",
    "expand_section",
  ]),
});

export const MapSchema = z.object({
  meta: z.object({
    generatedAt: z.string(),
    printerUrl: z.string(),
    firmware: z.string().optional(),
    schemaVersion: z.string().default(UI_MAP_SCHEMA_VERSION),
    capturedAt: z.string().optional(),
    version: z.string().optional(),
    mapperVersion: z.string().optional(),
    gitSha: z.string().optional(),
    runId: z.string().optional(),
    deviceModel: z.string().optional(),
  }),
  pages: z.array(PageSchema),
  fields: z.array(FieldSchema),
  nodes: z.array(NodeSchema).optional(),
  edges: z.array(EdgeSchema).optional(),
});

export type Selector = z.infer<typeof SelectorSchema>;
export type NavStep = z.infer<typeof NavStepSchema>;
export type PageEntry = z.infer<typeof PageSchema>;
export type FieldEntry = z.infer<typeof FieldSchema>;
export type GroupEntry = z.infer<typeof GroupSchema>;
export type ActionEntry = z.infer<typeof ActionSchema>;
export type NodeEntry = z.infer<typeof NodeSchema>;
export type EdgeEntry = z.infer<typeof EdgeSchema>;
export type UiMap = z.infer<typeof MapSchema>;

export function assertUiMapCompatible(
  map: Pick<UiMap, "meta">,
  expectedSchemaVersion = UI_MAP_SCHEMA_VERSION,
): void {
  const actual = map.meta.schemaVersion;
  if (actual !== expectedSchemaVersion) {
    throw new Error(
      `Incompatible UI map schema version. Expected "${expectedSchemaVersion}" but got "${actual}".`,
    );
  }
}
