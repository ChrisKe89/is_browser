import { z } from "zod";

export const SelectorSchema = z.object({
  kind: z.enum(["role", "label", "css", "text"]),
  priority: z.number().int().positive().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional()
});

export const NavStepSchema = z.object({
  action: z.enum(["goto", "click"]),
  selector: SelectorSchema.optional(),
  url: z.string().optional()
});

export const PageSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  url: z.string(),
  navPath: z.array(NavStepSchema).optional()
});

export const FieldSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  type: z.enum([
    "text",
    "number",
    "checkbox",
    "radio",
    "select",
    "button",
    "textarea"
  ]),
  selectors: z.array(SelectorSchema),
  pageId: z.string(),
  constraints: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      enum: z.array(z.string()).optional(),
      readOnly: z.boolean().optional()
    })
    .optional(),
  actions: z
    .array(
      z.object({
        selector: SelectorSchema,
        label: z.string().optional()
      })
    )
    .optional()
});

export const MapSchema = z.object({
  meta: z.object({
    generatedAt: z.string(),
    printerUrl: z.string(),
    firmware: z.string().optional(),
    schemaVersion: z.string().optional()
  }),
  pages: z.array(PageSchema),
  fields: z.array(FieldSchema)
});

export type Selector = z.infer<typeof SelectorSchema>;
export type NavStep = z.infer<typeof NavStepSchema>;
export type PageEntry = z.infer<typeof PageSchema>;
export type FieldEntry = z.infer<typeof FieldSchema>;
export type UiMap = z.infer<typeof MapSchema>;
