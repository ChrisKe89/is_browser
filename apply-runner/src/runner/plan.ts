import { assertUiMapCompatible, type FieldEntry, type UiMap } from "../../../packages/contracts/src/uiMap.js";
import { type SettingsFile } from "./settings.js";

export type ApplyPlanItem = {
  settingId: string;
  pageId: string;
  fieldType: FieldEntry["type"];
  value: unknown;
};

export type ApplyPlanSkipped = {
  settingId?: string;
  label?: string;
  reason: string;
};

export type ApplyPlan = {
  schemaVersion: string;
  items: ApplyPlanItem[];
  skipped: ApplyPlanSkipped[];
};

export type ResolvedApplyPlanItem = ApplyPlanItem & {
  field: FieldEntry;
};

export type ResolvedApplyPlan = ApplyPlan & {
  items: ResolvedApplyPlanItem[];
};

function resolveField(
  map: UiMap,
  setting: { id?: string; label?: string }
): FieldEntry | undefined {
  if (setting.id) {
    const exact = map.fields.find((field) => field.id === setting.id);
    if (exact) return exact;
  }
  if (setting.label) {
    const normalized = setting.label.toLowerCase();
    return map.fields.find((field) => (field.label ?? "").toLowerCase() === normalized);
  }
  return undefined;
}

function comparePlanItems(left: ApplyPlanItem, right: ApplyPlanItem): number {
  const byPage = left.pageId.localeCompare(right.pageId);
  if (byPage !== 0) return byPage;
  return left.settingId.localeCompare(right.settingId);
}

export function buildResolvedApplyPlan(map: UiMap, settings: SettingsFile): ResolvedApplyPlan {
  assertUiMapCompatible(map);

  const skipped: ApplyPlanSkipped[] = [];
  const resolvedItems: ResolvedApplyPlanItem[] = [];

  for (const setting of settings.settings ?? []) {
    const field = resolveField(map, setting);
    if (!field) {
      skipped.push({
        settingId: setting.id,
        label: setting.label,
        reason: "field-not-found"
      });
      continue;
    }
    if (field.constraints?.readOnly) {
      skipped.push({
        settingId: field.id,
        label: field.label,
        reason: "read-only"
      });
      continue;
    }
    resolvedItems.push({
      settingId: field.id,
      pageId: field.pageId,
      fieldType: field.type,
      value: setting.value,
      field
    });
  }

  resolvedItems.sort(comparePlanItems);

  return {
    schemaVersion: map.meta.schemaVersion,
    items: resolvedItems,
    skipped
  };
}

export function buildApplyPlan(map: UiMap, settings: SettingsFile): ApplyPlan {
  const resolved = buildResolvedApplyPlan(map, settings);
  return {
    schemaVersion: resolved.schemaVersion,
    skipped: resolved.skipped,
    items: resolved.items.map((item) => ({
      settingId: item.settingId,
      pageId: item.pageId,
      fieldType: item.fieldType,
      value: item.value
    }))
  };
}
