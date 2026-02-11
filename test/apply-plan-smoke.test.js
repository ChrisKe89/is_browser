import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApplyPlan } from "../apply-runner/src/runner/plan.js";

function sampleMap(schemaVersion = "1.1") {
  return {
    meta: {
      generatedAt: "2026-02-11T00:00:00.000Z",
      printerUrl: "http://192.168.0.10",
      schemaVersion
    },
    pages: [
      {
        id: "network",
        title: "Network",
        url: "http://192.168.0.10/#/network",
        navPath: [{ action: "goto", url: "http://192.168.0.10/#/network" }]
      },
      {
        id: "system",
        title: "System",
        url: "http://192.168.0.10/#/system",
        navPath: [{ action: "goto", url: "http://192.168.0.10/#/system" }]
      }
    ],
    fields: [
      {
        id: "system.mode",
        label: "Mode",
        type: "select",
        selectors: [{ kind: "css", value: "#mode" }],
        pageId: "system"
      },
      {
        id: "network.hostname",
        label: "Host Name",
        type: "text",
        selectors: [{ kind: "css", value: "#hostname" }],
        pageId: "network"
      }
    ]
  };
}

test("apply-runner smoke: dry-run plan is deterministic and skips unresolved settings", () => {
  const plan = buildApplyPlan(sampleMap(), {
    settings: [
      { id: "system.mode", value: "Auto" },
      { id: "missing.setting", value: "x" },
      { id: "network.hostname", value: "Printer-A" }
    ]
  });

  assert.equal(plan.items.length, 2);
  assert.deepEqual(
    plan.items.map((item) => item.settingId),
    ["network.hostname", "system.mode"]
  );
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, "field-not-found");
});

test("apply-runner smoke: schema incompatibility fails fast at plan stage", () => {
  assert.throws(() => {
    buildApplyPlan(sampleMap("9.9"), {
      settings: [{ id: "system.mode", value: "Auto" }]
    });
  }, /Incompatible UI map schema version/);
});
