import { DatabaseSync } from "node:sqlite";
import {
  ProfileIdentitySchema,
  ProfileRecordSchema,
  ProfileSaveInputSchema,
  ProfileValueInputSchema,
  profileMapToApplySettings,
  profileValuesToMap,
  type ProfileIdentity as ContractProfileIdentity,
  type ProfileRecord as ContractProfileRecord,
  type ProfileSaveInput as ContractProfileSaveInput,
  type ProfileValueInput as ContractProfileValueInput
} from "@is-browser/contract";
import { migrateDatabase } from "./migrations.js";

export type ProfileValueInput = ContractProfileValueInput;
export type ProfileIdentity = ContractProfileIdentity;
export type ProfileSaveInput = ContractProfileSaveInput;

export type ProfileValidationError = {
  field: string;
  message: string;
};

export type ProfileEditorSetting = {
  id: string;
  label: string;
  controlType: string;
  options: string[];
  min?: number;
  max?: number;
  pattern?: string;
};

export type ProfileEditorPage = {
  id: string;
  title: string;
  url: string;
  groups: Array<{
    controlType: string;
    settings: ProfileEditorSetting[];
  }>;
};

export type ProfileRecord = ContractProfileRecord;

export class ProfileValidationFailure extends Error {
  readonly errors: ProfileValidationError[];

  constructor(errors: ProfileValidationError[]) {
    super("Profile validation failed");
    this.errors = errors;
  }
}

function normalizeIdentity(identity: ProfileIdentity): ProfileIdentity {
  return {
    accountNumber: String(identity.accountNumber ?? "").trim(),
    variation: String(identity.variation ?? "").trim()
  };
}

function uniqueValues(values: ProfileValueInput[]): ProfileValueInput[] {
  const map = new Map<string, { value: string; enabled: boolean }>();
  for (const item of values) {
    map.set(String(item.settingId ?? "").trim(), {
      value: String(item.value ?? ""),
      enabled: item.enabled !== false
    });
  }
  return Array.from(map.entries()).map(([settingId, entry]) => ({
    settingId,
    value: entry.value,
    enabled: entry.enabled
  }));
}

export async function validateProfileDraft(
  dbPath: string,
  draft: ProfileSaveInput
): Promise<ProfileValidationError[]> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  try {
    const errors: ProfileValidationError[] = [];
    const identity = normalizeIdentity(draft);

    if (!identity.accountNumber) {
      errors.push({ field: "accountNumber", message: "AccountNumber is required." });
    }
    if (!identity.variation) {
      errors.push({ field: "variation", message: "Variation is required." });
    }

    const values = uniqueValues(draft.values);
    for (const value of values) {
      if (!value.settingId.trim()) {
        errors.push({ field: "values.settingId", message: "Setting id is required." });
        continue;
      }

      const setting = db
        .prepare(
          `SELECT id, control_type, min_value, max_value, read_only
           FROM ui_setting
           WHERE id = ?`
        )
        .get(value.settingId) as
        | {
            id: string;
            control_type: string;
            min_value: number | null;
            max_value: number | null;
            read_only: number;
          }
        | undefined;

      if (!setting) {
        errors.push({
          field: `values.${value.settingId}`,
          message: `Setting "${value.settingId}" does not exist in UI map data.`
        });
        continue;
      }

      if (setting.read_only === 1) {
        errors.push({
          field: `values.${value.settingId}`,
          message: `Setting "${value.settingId}" is read-only and cannot be saved.`
        });
        continue;
      }

      if (value.enabled === false) {
        continue;
      }

      if (String(value.value ?? "").trim().length === 0) {
        continue;
      }

      if (setting.control_type === "select" || setting.control_type === "radio" || setting.control_type === "switch") {
        const allowed = db
          .prepare(
            `SELECT option_key
             FROM ui_setting_option
             WHERE setting_id = ?
             ORDER BY sort_order`
          )
          .all(value.settingId)
          .map((row) => String((row as { option_key: string }).option_key));
        if (!allowed.includes(value.value)) {
          errors.push({
            field: `values.${value.settingId}`,
            message: `Value "${value.value}" is invalid for "${value.settingId}". Allowed values: ${allowed.join(", ")}.`
          });
        }
        continue;
      }

      if (setting.control_type === "number") {
        const numeric = Number(value.value);
        if (Number.isNaN(numeric)) {
          errors.push({
            field: `values.${value.settingId}`,
            message: `Value "${value.value}" must be numeric for "${value.settingId}".`
          });
          continue;
        }
        if (setting.min_value !== null && numeric < setting.min_value) {
          errors.push({
            field: `values.${value.settingId}`,
            message: `Value "${numeric}" is below min "${setting.min_value}" for "${value.settingId}".`
          });
        }
        if (setting.max_value !== null && numeric > setting.max_value) {
          errors.push({
            field: `values.${value.settingId}`,
            message: `Value "${numeric}" is above max "${setting.max_value}" for "${value.settingId}".`
          });
        }
        continue;
      }

      if (setting.control_type === "text" || setting.control_type === "textarea") {
        if (typeof value.value !== "string") {
          errors.push({
            field: `values.${value.settingId}`,
            message: `Value for "${value.settingId}" must be a string.`
          });
        }
        continue;
      }

      if (setting.control_type === "button") {
        errors.push({
          field: `values.${value.settingId}`,
          message: `Setting "${value.settingId}" is an action control and cannot be saved as a profile value.`
        });
      }
    }

    return errors;
  } finally {
    db.close();
  }
}

export async function saveProfile(dbPath: string, draft: ProfileSaveInput): Promise<ProfileRecord> {
  const errors = await validateProfileDraft(dbPath, draft);
  if (errors.length > 0) {
    throw new ProfileValidationFailure(errors);
  }
  const normalizedDraft = ProfileSaveInputSchema.parse(draft);

  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  const identity = normalizeIdentity(normalizedDraft);
  const values = uniqueValues(normalizedDraft.values);
  const now = new Date().toISOString();

  const upsertProfile = db.prepare(
    `INSERT INTO config_profile (account_number, variation, display_name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_number, variation) DO UPDATE SET
       display_name = excluded.display_name,
       updated_at = excluded.updated_at`
  );

  const selectProfile = db.prepare(
    `SELECT id, account_number, variation, display_name
     FROM config_profile
     WHERE account_number = ? AND variation = ?`
  );

  const clearValues = db.prepare("DELETE FROM config_profile_value WHERE profile_id = ?");
  const insertValue = db.prepare(
    `INSERT INTO config_profile_value (profile_id, setting_id, value_text, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  let transactionOpen = false;
  try {
    db.exec("BEGIN");
    transactionOpen = true;

    upsertProfile.run(identity.accountNumber, identity.variation, normalizedDraft.displayName ?? null, now);
    const profile = selectProfile.get(identity.accountNumber, identity.variation) as
      | { id: number }
      | undefined;
    if (!profile) {
      throw new Error("Failed to read profile row after upsert.");
    }

    clearValues.run(profile.id);
    for (const value of values) {
      insertValue.run(profile.id, value.settingId, value.value, value.enabled === false ? 0 : 1, now);
    }

    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    db.close();
  }

  const loaded = await getProfile(dbPath, identity);
  if (!loaded) {
    throw new Error("Failed to load saved profile.");
  }
  return loaded;
}

export async function getProfile(
  dbPath: string,
  identityInput: ProfileIdentity
): Promise<ProfileRecord | null> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const identity = normalizeIdentity(identityInput);

  try {
    const profile = db
      .prepare(
        `SELECT id, account_number, variation, display_name
         FROM config_profile
         WHERE account_number = ? AND variation = ?`
      )
      .get(identity.accountNumber, identity.variation) as
      | { id: number; account_number: string; variation: string; display_name: string | null }
      | undefined;

    if (!profile) {
      return null;
    }

    const values = db
      .prepare(
        `SELECT setting_id, value_text, enabled
         FROM config_profile_value
         WHERE profile_id = ?
         ORDER BY setting_id`
      )
      .all(profile.id)
      .map((row) => {
        const typed = row as { setting_id: string; value_text: string; enabled: number };
        return {
          settingId: typed.setting_id,
          value: typed.value_text,
          enabled: typed.enabled !== 0
        };
      });

    return ProfileRecordSchema.parse({
      accountNumber: profile.account_number,
      variation: profile.variation,
      displayName: profile.display_name,
      values
    });
  } finally {
    db.close();
  }
}

export async function listProfiles(
  dbPath: string,
  accountNumber?: string
): Promise<Array<{ accountNumber: string; variation: string; displayName: string | null }>> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    const rows = accountNumber
      ? db
          .prepare(
            `SELECT account_number, variation, display_name
             FROM config_profile
             WHERE account_number = ?
             ORDER BY variation`
          )
          .all(accountNumber)
      : db
          .prepare(
            `SELECT account_number, variation, display_name
             FROM config_profile
             ORDER BY account_number, variation`
          )
          .all();

    return rows.map((row) => {
      const typed = row as {
        account_number: string;
        variation: string;
        display_name: string | null;
      };
      return {
        accountNumber: typed.account_number,
        variation: typed.variation,
        displayName: typed.display_name
      };
    });
  } finally {
    db.close();
  }
}

export async function deleteProfile(dbPath: string, identityInput: ProfileIdentity): Promise<boolean> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const identity = normalizeIdentity(identityInput);
  try {
    const result = db
      .prepare(
        `DELETE FROM config_profile
         WHERE account_number = ? AND variation = ?`
      )
      .run(identity.accountNumber, identity.variation);
    return result.changes > 0;
  } finally {
    db.close();
  }
}

export async function getProfileEditorPages(dbPath: string): Promise<ProfileEditorPage[]> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    const rows = db
      .prepare(
        `SELECT
           p.id AS page_id,
           COALESCE(p.title, p.id) AS page_title,
           p.url AS page_url,
           s.id AS setting_id,
           COALESCE(s.label, s.id) AS setting_label,
           s.control_type AS control_type,
           s.min_value AS min_value,
           s.max_value AS max_value,
           s.pattern AS pattern
         FROM ui_page p
         JOIN ui_setting s ON s.page_id = p.id
         WHERE s.control_type IN ('text', 'number', 'textarea', 'select', 'radio', 'switch')
         ORDER BY p.id, s.control_type, s.id`
      )
      .all();

    const optionRows = db
      .prepare(
        `SELECT setting_id, option_key
         FROM ui_setting_option
         ORDER BY setting_id, sort_order`
      )
      .all();

    const optionsBySetting = new Map<string, string[]>();
    for (const row of optionRows) {
      const typed = row as { setting_id: string; option_key: string };
      const existing = optionsBySetting.get(typed.setting_id) ?? [];
      existing.push(typed.option_key);
      optionsBySetting.set(typed.setting_id, existing);
    }

    const pages = new Map<string, ProfileEditorPage>();
    for (const row of rows) {
      const typed = row as {
        page_id: string;
        page_title: string;
        page_url: string;
        setting_id: string;
        setting_label: string;
        control_type: string;
        min_value: number | null;
        max_value: number | null;
        pattern: string | null;
      };

      const page = pages.get(typed.page_id) ?? {
        id: typed.page_id,
        title: typed.page_title,
        url: typed.page_url,
        groups: []
      };

      let group = page.groups.find((item) => item.controlType === typed.control_type);
      if (!group) {
        group = { controlType: typed.control_type, settings: [] };
        page.groups.push(group);
      }

      group.settings.push({
        id: typed.setting_id,
        label: typed.setting_label,
        controlType: typed.control_type,
        options: optionsBySetting.get(typed.setting_id) ?? [],
        min: typed.min_value ?? undefined,
        max: typed.max_value ?? undefined,
        pattern: typed.pattern ?? undefined
      });

      pages.set(typed.page_id, page);
    }

    return Array.from(pages.values());
  } finally {
    db.close();
  }
}

export async function buildSettingsFromProfile(
  dbPath: string,
  identity: ProfileIdentity
): Promise<Array<{ id: string; value: string }>> {
  const profile = await getProfile(dbPath, identity);
  if (!profile) {
    throw new Error(`Profile ${identity.accountNumber}/${identity.variation} not found.`);
  }

  const enabledValues = profile.values.filter((item) => item.enabled !== false);
  const valuesMap = profileValuesToMap(enabledValues);
  const eligibleValues = Object.entries(valuesMap).map(([settingId, value]) => ({
    settingId,
    value,
    enabled: true
  }));

  const errors = await validateProfileDraft(dbPath, {
    accountNumber: profile.accountNumber,
    variation: profile.variation,
    displayName: profile.displayName ?? undefined,
    values: eligibleValues
  });
  if (errors.length > 0) {
    throw new ProfileValidationFailure(errors);
  }

  return profileMapToApplySettings(valuesMap);
}

