import { z } from "zod";

export const APPLY_RUN_SCHEMA_VERSION = "1.0";

export const ApplyRunStatusSchema = z.enum([
  "started",
  "completed",
  "partial",
  "failed",
]);
export const ApplyRunItemStatusSchema = z.enum(["ok", "error", "skipped"]);

export const ApplyRunStartInputSchema = z.object({
  accountNumber: z.string().trim().min(1),
  variation: z.string().trim().min(1),
  deviceIp: z.string().trim().min(1),
  mapPath: z.string().trim().min(1),
});

export const ApplyRunFinishInputSchema = z.object({
  status: ApplyRunStatusSchema.exclude(["started"]),
  message: z.string().optional(),
});

export const ApplyRunItemInputSchema = z.object({
  settingId: z.string().trim().min(1).optional(),
  attempt: z.number().int().positive(),
  status: ApplyRunItemStatusSchema,
  message: z.string().trim().min(1),
  attemptedAt: z.string().optional(),
});

export const ApplyRunArtifactSchema = z.object({
  schemaVersion: z
    .literal(APPLY_RUN_SCHEMA_VERSION)
    .default(APPLY_RUN_SCHEMA_VERSION),
  accountNumber: z.string().trim().min(1),
  variation: z.string().trim().min(1),
  deviceIp: z.string().trim().min(1),
  mapPath: z.string().trim().min(1),
  status: ApplyRunStatusSchema,
  message: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  items: z.array(ApplyRunItemInputSchema),
});

export type ApplyRunStatus = z.infer<typeof ApplyRunStatusSchema>;
export type ApplyRunItemStatus = z.infer<typeof ApplyRunItemStatusSchema>;
export type ApplyRunStartInput = z.infer<typeof ApplyRunStartInputSchema>;
export type ApplyRunFinishInput = z.infer<typeof ApplyRunFinishInputSchema>;
export type ApplyRunItemInput = z.infer<typeof ApplyRunItemInputSchema>;
export type ApplyRunArtifact = z.infer<typeof ApplyRunArtifactSchema>;
