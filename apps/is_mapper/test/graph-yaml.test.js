import { test } from "node:test";
import assert from "node:assert/strict";
import { attachCanonicalGraph } from "../src/graph.ts";
import { buildYamlViews } from "../src/yamlViews.ts";

function sampleMap() {
  return {
    meta: {
      generatedAt: "2026-02-12T00:00:00.000Z",
      printerUrl: "http://127.0.0.1",
      schemaVersion: "1.1"
    },
    pages: [
      {
        id: "permissions",
        title: "Permissions",
        url: "http://127.0.0.1/#/permissions",
        navPath: [{ action: "goto", url: "http://127.0.0.1/#/permissions" }]
      },
      {
        id: "failed-log-modal",
        title: "Failed Access Log",
        url: "http://127.0.0.1/#/permissions",
        actions: [
          { selector: { kind: "role", role: "button", name: "Save" }, label: "Save" },
          { selector: { kind: "role", role: "button", name: "Cancel" }, label: "Cancel" }
        ],
        navPath: [
          { action: "goto", url: "http://127.0.0.1/#/permissions" },
          {
            action: "click",
            selector: { kind: "role", role: "button", name: "Failed Access Log" },
            label: "Failed Access Log",
            kind: "button"
          }
        ]
      }
    ],
    fields: [
      {
        id: "permissions.enable",
        label: "Enable",
        type: "checkbox",
        selectors: [{ kind: "css", value: "#enable" }],
        pageId: "permissions",
        selectorKey: "key-enable",
        groupKey: "group:advanced-settings",
        groupTitle: "Advanced Settings",
        groupOrder: 1,
        defaultValue: true,
        currentValue: true
      },
      {
        id: "failed.failedAttempts",
        label: "Failed Attempts",
        type: "number",
        selectors: [{ kind: "css", value: "#attempts" }],
        pageId: "failed-log-modal",
        selectorKey: "key-attempts",
        groupKey: "group:failed-access-log",
        groupTitle: "Failed Access Log",
        groupOrder: 1,
        defaultValue: 10,
        currentValue: 10,
        constraints: { min: 1, max: 600 }
      }
    ]
  };
}

test("canonical graph: emits nodes and edges with grouped content", () => {
  const map = sampleMap();
  attachCanonicalGraph(map, {
    runId: "20260212-000000",
    capturedAt: "2026-02-12T00:00:00.000Z",
    clickLog: {
      clicks: [
        {
          target: "Security Alert",
          kind: "system_alert",
          selectors: [{ kind: "css", value: "#securityAlertConfirm" }],
          urlBefore: "http://127.0.0.1/#/permissions",
          urlAfter: "http://127.0.0.1/#/permissions",
          transitionType: "dismiss_alert",
          newFieldIds: []
        },
        {
          target: "Failed Access Log",
          kind: "button",
          selectors: [{ kind: "role", role: "button", name: "Failed Access Log" }],
          urlBefore: "http://127.0.0.1/#/permissions",
          urlAfter: "http://127.0.0.1/#/permissions",
          nodeIdBefore: "permissions",
          nodeIdAfter: "failed-log-modal",
          transitionType: "open_modal",
          newFieldIds: ["failed.failedAttempts"]
        }
      ]
    }
  });

  assert.ok(Array.isArray(map.nodes));
  assert.ok(Array.isArray(map.edges));
  assert.equal(map.nodes.length, 2);
  assert.equal(map.nodes[0].groups.length > 0, true);
  assert.equal(map.edges.length, 1);
  assert.equal(map.edges[0].edgeType, "open_modal");
  const modalNode = map.nodes.find((node) => node.title === "Failed Access Log");
  assert.equal(modalNode?.actions.some((action) => action.kind === "save"), true);
  assert.equal(modalNode?.actions.some((action) => action.kind === "cancel"), true);
  assert.equal(map.meta.runId, "20260212-000000");
});

test("yaml views: navigation and layout include grouped fields", () => {
  const map = sampleMap();
  attachCanonicalGraph(map, { runId: "20260212-000000" });
  const { navigationYaml, layoutYaml } = buildYamlViews(map);

  assert.match(navigationYaml, /Failed Access Log/);
  assert.match(navigationYaml, /Failed Attempts/);
  assert.match(layoutYaml, /Advanced Settings/);
  assert.match(layoutYaml, /default: 10/);
});
