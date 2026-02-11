import { z } from "zod";

export const PROFILE_SCHEMA_VERSION = "1.0";

export const ProfileIdentitySchema = z.object({
  accountNumber: z.string().trim().min(1),
  variation: z.string().trim().min(1)
});

export const ProfileValueInputSchema = z.object({
  settingId: z.string().trim().min(1),
  value: z.string(),
  enabled: z.boolean().optional()
});

export const ProfileSaveInputSchema = ProfileIdentitySchema.extend({
  displayName: z.string().trim().min(1).optional(),
  values: z.array(ProfileValueInputSchema)
});

export const ProfileRecordSchema = ProfileIdentitySchema.extend({
  displayName: z.string().nullable(),
  values: z.array(ProfileValueInputSchema)
});

export const ProfileValuesMapSchema = z.record(z.string().trim().min(1), z.string());

export const ProfileArtifactSchema = ProfileIdentitySchema.extend({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION).default(PROFILE_SCHEMA_VERSION),
  values: ProfileValuesMapSchema
});

export const ApplyProfileSettingsSchema = z.array(
  z.object({
    id: z.string().trim().min(1),
    value: z.string()
  })
);

export type ProfileIdentity = z.infer<typeof ProfileIdentitySchema>;
export type ProfileValueInput = z.infer<typeof ProfileValueInputSchema>;
export type ProfileSaveInput = z.infer<typeof ProfileSaveInputSchema>;
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;
export type ProfileArtifact = z.infer<typeof ProfileArtifactSchema>;
export type ApplyProfileSetting = z.infer<typeof ApplyProfileSettingsSchema>[number];

export function profileValuesToMap(
  values: Array<Pick<ProfileValueInput, "settingId" | "value" | "enabled">>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const value of values) {
    if (value.enabled === false) {
      continue;
    }
    const settingId = value.settingId.trim();
    if (!settingId) {
      continue;
    }
    if (String(value.value).trim().length === 0) {
      continue;
    }
    map[settingId] = value.value;
  }
  return map;
}

export function profileMapToApplySettings(values: Record<string, string>): ApplyProfileSetting[] {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => ({ id, value }));
}
