import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCaptureSchema } from "../src/captureContract.ts";

function sampleMap() {
  return {
    meta: {
      generatedAt: "2026-02-12T00:00:00.000Z",
      printerUrl: "http://192.168.0.107",
      schemaVersion: "1.1",
    },
    pages: [
      {
        id: "permissions",
        title: "Authentication and Accounting",
        url: "http://192.168.0.107/permissions/index.html#hash",
        breadcrumbs: ["Permissions", "Authentication and Accounting"],
        navPath: [
          {
            action: "goto",
            url: "http://192.168.0.107/permissions/index.html#hash",
          },
        ],
      },
    ],
    fields: [
      {
        id: "field-1",
        label: "Authentication/Accounting Type",
        type: "select",
        selectors: [{ kind: "css", value: "#loginLogoutMethodSetting" }],
        pageId: "permissions",
        groupTitle: "Authentication Settings",
        groupOrder: 1,
        options: [
          { value: "Off", label: "Off" },
          { value: "Local", label: "Local" },
        ],
        currentValue: "Off",
        defaultValue: "Off",
        controlType: "dropdown",
        valueType: "enum",
        valueQuality: "native-select",
      },
      {
        id: "field-radio",
        label: "Login Type",
        type: "radio",
        selectors: [
          { kind: "css", value: 'input[type=\"radio\"][name=\"loginType\"]' },
        ],
        pageId: "permissions",
        groupTitle: "Authentication Settings",
        groupOrder: 2,
        options: [
          { value: "Local", label: "Local" },
          { value: "Remote", label: "Remote" },
        ],
        currentValue: "Local",
        defaultValue: "Local",
        controlType: "radio_group",
        valueType: "enum",
      },
    ],
  };
}

test("field ids are deterministic across runs", () => {
  const first = buildCaptureSchema(sampleMap());
  const second = buildCaptureSchema(sampleMap());

  const firstIds = first.fieldRecords.map((item) => item.field_id).sort();
  const secondIds = second.fieldRecords.map((item) => item.field_id).sort();
  assert.deepEqual(secondIds, firstIds);
});

test("dropdown options are captured when present", () => {
  const schema = buildCaptureSchema(sampleMap());
  const dropdown = schema.fieldRecords.find((item) =>
    item.type.startsWith("dropdown"),
  );
  assert.ok(dropdown);
  assert.equal(dropdown.options.length > 0, true);
  assert.equal(dropdown.value.value_quality, "high");
});

test("empty dropdown options are marked unknown with reason", () => {
  const map = sampleMap();
  map.fields[0].options = [];
  map.fields[0].constraints = {};
  map.fields[0].valueQuality = "missing";
  const schema = buildCaptureSchema(map);
  const dropdown = schema.fieldRecords.find((item) =>
    item.type.startsWith("dropdown"),
  );
  assert.ok(dropdown);
  assert.equal(dropdown.options.length, 0);
  assert.equal(dropdown.value.value_quality, "unknown");
  assert.equal(typeof dropdown.value.value_quality_reason, "string");
});

test("snapshot overlay fills null current_value", () => {
  const map = sampleMap();
  map.fields[0].currentValue = null;
  const overlay = new Map();
  overlay.set("field-1", {
    current_value: "Local",
    current_label: "Local Label",
  });
  const schema = buildCaptureSchema(map, overlay);
  const dropdown = schema.fieldRecords.find(
    (item) => item.source_field_id === "field-1",
  );
  assert.ok(dropdown);
  assert.equal(dropdown.value.current_value, "Local");
  assert.equal(dropdown.value.current_label, "Local Label");
});

test("snapshot overlay fills null default_value", () => {
  const map = sampleMap();
  map.fields[0].defaultValue = null;
  const overlay = new Map();
  overlay.set("field-1", { current_value: "Off", default_value: "Off" });
  const schema = buildCaptureSchema(map, overlay);
  const dropdown = schema.fieldRecords.find(
    (item) => item.source_field_id === "field-1",
  );
  assert.ok(dropdown);
  assert.equal(dropdown.value.default_value, "Off");
});

test("snapshot overlay never overwrites non-null current_value with null", () => {
  const map = sampleMap();
  map.fields[0].currentValue = "Local";
  const overlay = new Map();
  overlay.set("field-1", { current_value: null });
  const schema = buildCaptureSchema(map, overlay);
  const dropdown = schema.fieldRecords.find(
    (item) => item.source_field_id === "field-1",
  );
  assert.ok(dropdown);
  assert.equal(dropdown.value.current_value, "Local");
});

test("snapshot overlay updates non-null current_value with newer non-null value (last-write-wins)", () => {
  const map = sampleMap();
  map.fields[0].currentValue = "Off";
  const overlay = new Map();
  overlay.set("field-1", { current_value: "Local" });
  const schema = buildCaptureSchema(map, overlay);
  const dropdown = schema.fieldRecords.find(
    (item) => item.source_field_id === "field-1",
  );
  assert.ok(dropdown);
  assert.equal(dropdown.value.current_value, "Local");
});

test("snapshot overlay never overwrites non-null default_value", () => {
  const map = sampleMap();
  map.fields[0].defaultValue = "Off";
  const overlay = new Map();
  overlay.set("field-1", { current_value: "Local", default_value: "Local" });
  const schema = buildCaptureSchema(map, overlay);
  const dropdown = schema.fieldRecords.find(
    (item) => item.source_field_id === "field-1",
  );
  assert.ok(dropdown);
  assert.equal(dropdown.value.default_value, "Off");
});

test("schema without overlay is unchanged", () => {
  const map = sampleMap();
  const withoutOverlay = buildCaptureSchema(map);
  const withEmptyOverlay = buildCaptureSchema(map, new Map());
  const idsWithout = withoutOverlay.fieldRecords.map((r) => r.field_id).sort();
  const idsWith = withEmptyOverlay.fieldRecords.map((r) => r.field_id).sort();
  assert.deepEqual(idsWith, idsWithout);
  for (const record of withoutOverlay.fieldRecords) {
    const matching = withEmptyOverlay.fieldRecords.find(
      (r) => r.field_id === record.field_id,
    );
    assert.ok(matching);
    assert.deepEqual(matching.value, record.value);
  }
});
