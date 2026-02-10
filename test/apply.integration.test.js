import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { importUiMapToDatabase } from "../src/db/importer.js";
import { applySettings } from "../src/runner/applySettings.js";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "printer-ui-apply-int-"));
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

async function removeWithRetry(targetPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 20));
    }
  }
  if (lastError && lastError.code === "EBUSY") {
    return;
  }
  throw lastError;
}

function createIntegrationMap() {
  return {
    meta: {
      generatedAt: "2026-02-10T00:00:00.000Z",
      printerUrl: "http://192.168.0.10",
      schemaVersion: "1.1"
    },
    pages: [
      {
        id: "main",
        title: "Main",
        url: "http://192.168.0.10/#/main",
        navPath: [{ action: "goto", url: "http://192.168.0.10/#/main" }]
      }
    ],
    fields: [
      {
        id: "main.host-name",
        label: "Host Name",
        type: "text",
        selectors: [
          { kind: "css", value: "#missing-host", priority: 1 },
          { kind: "label", value: "Host Name", priority: 2 }
        ],
        pageId: "main",
        actions: [{ selector: { kind: "css", value: "#save-main" }, label: "Save" }]
      },
      {
        id: "main.mode",
        label: "Mode",
        type: "select",
        selectors: [{ kind: "role", role: "combobox", name: "Mode", priority: 1 }],
        pageId: "main",
        constraints: { enum: ["Auto", "Manual"] }
      },
      {
        id: "main.enabled",
        label: "Enabled",
        type: "checkbox",
        selectors: [{ kind: "label", value: "Enabled", priority: 1 }],
        pageId: "main"
      },
      {
        id: "main.profile",
        label: "Profile",
        type: "radio",
        selectors: [{ kind: "role", role: "radio", name: "Office", priority: 1 }],
        pageId: "main",
        constraints: { enum: ["Office", "Night"] }
      }
    ]
  };
}

function createFakeLocator(pageState, key, options = {}) {
  const locatorState = {
    key,
    exists: options.exists ?? false,
    selectedValue: null,
    checked:
      options.checked === undefined
        ? undefined
        : Boolean(options.checked),
    fillFailures: [...(options.fillFailures ?? [])],
    clickFailures: [...(options.clickFailures ?? [])],
    selectFailures: [...(options.selectFailures ?? [])],
    selectAllowed: [...(options.selectAllowed ?? [])]
  };

  return {
    __state: locatorState,
    first() {
      return this;
    },
    async count() {
      return locatorState.exists ? 1 : 0;
    },
    async click() {
      pageState.calls.push(`click:${key}`);
      const failure = locatorState.clickFailures.shift();
      if (failure) throw new Error(failure);
      if (key.startsWith("role:radio:")) {
        locatorState.checked = true;
      }
    },
    async fill(value) {
      pageState.calls.push(`fill:${key}:${value}`);
      const failure = locatorState.fillFailures.shift();
      if (failure) throw new Error(failure);
      locatorState.selectedValue = String(value);
    },
    async selectOption(arg) {
      pageState.calls.push(`select:${key}:${JSON.stringify(arg)}`);
      const failure = locatorState.selectFailures.shift();
      if (failure) throw new Error(failure);
      const target =
        typeof arg === "string"
          ? arg
          : arg?.value ?? arg?.label ?? "";
      if (locatorState.selectAllowed.includes(String(target))) {
        locatorState.selectedValue = String(target);
        return [String(target)];
      }
      return [];
    },
    locator(childKey) {
      return createFakeLocator(pageState, `${key}|${childKey}`, { exists: false });
    },
    filter() {
      return createFakeLocator(pageState, `${key}|filter`, { exists: false });
    },
    async isChecked() {
      if (typeof locatorState.checked !== "boolean") {
        throw new Error("checked-state-unavailable");
      }
      return locatorState.checked;
    },
    async check() {
      pageState.calls.push(`check:${key}`);
      locatorState.checked = true;
    },
    async uncheck() {
      pageState.calls.push(`uncheck:${key}`);
      locatorState.checked = false;
    },
    async getAttribute(name) {
      if (name === "aria-checked") {
        if (typeof locatorState.checked === "boolean") {
          return locatorState.checked ? "true" : "false";
        }
      }
      return null;
    }
  };
}

function createFakeRuntime(map, config) {
  const pageState = {
    currentUrl: "about:blank",
    calls: []
  };

  const locators = new Map();
  const locatorConfig = config.locators ?? {};
  for (const [key, locatorOptions] of Object.entries(locatorConfig)) {
    locators.set(key, createFakeLocator(pageState, key, locatorOptions));
  }

  const getLocator = (key) => {
    if (!locators.has(key)) {
      locators.set(key, createFakeLocator(pageState, key, { exists: false }));
    }
    return locators.get(key);
  };

  const page = {
    async goto(url) {
      pageState.calls.push(`goto:${url}`);
      pageState.currentUrl = url;
    },
    async waitForLoadState(state) {
      pageState.calls.push(`wait:${state}`);
    },
    async screenshot() {},
    url() {
      return pageState.currentUrl;
    },
    getByLabel(value) {
      return getLocator(`label:${value}`);
    },
    getByRole(role, options = {}) {
      const name = options.name === undefined ? "" : String(options.name);
      return getLocator(`role:${role}:${name}`);
    },
    getByText(value) {
      return getLocator(`text:${value}`);
    },
    locator(value) {
      return getLocator(`css:${value}`);
    }
  };

  const browser = {
    async close() {
      pageState.calls.push("browser:close");
    }
  };

  return {
    pageState,
    runtime: {
      readMap: async () => map,
      openBrowser: async () => browser,
      newPage: async () => page,
      isLoginPage: async () => false,
      login: async () => {},
      runRemotePanel: async () => {},
      writeDeviceLog: async () => "artifacts/test-log.json",
      appendDeviceReport: async () => "devices/reports/test.csv"
    }
  };
}

function getRunRecord(dbPath) {
  const db = new DatabaseSync(dbPath);
  const run = db
    .prepare(
      `SELECT id, status, message, account_number, variation
       FROM apply_run
       ORDER BY id DESC
       LIMIT 1`
    )
    .get();
  const items = db
    .prepare(
      `SELECT setting_id, attempt, status, message
       FROM apply_run_item
       WHERE run_id = ?
       ORDER BY id`
    )
    .all(run.id);
  db.close();
  return { run, items };
}

test("integration: importer + runner produces completed run with selector-priority and control application", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    const map = createIntegrationMap();
    await importUiMapToDatabase(dbPath, map);

    const db = new DatabaseSync(dbPath);
    const counts = {
      pages: db.prepare("SELECT COUNT(*) AS c FROM ui_page").get().c,
      settings: db.prepare("SELECT COUNT(*) AS c FROM ui_setting").get().c,
      selectors: db.prepare("SELECT COUNT(*) AS c FROM ui_setting_selector").get().c,
      options: db.prepare("SELECT COUNT(*) AS c FROM ui_setting_option").get().c
    };
    db.close();
    assert.equal(counts.pages, 1);
    assert.equal(counts.settings, 4);
    assert.equal(counts.selectors, 5);
    assert.equal(counts.options, 6);

    const { runtime, pageState } = createFakeRuntime(map, {
      locators: {
        "label:Host Name": { exists: true },
        "role:combobox:Mode": { exists: true, selectAllowed: ["Auto", "Manual"] },
        "label:Enabled": { exists: true, checked: false },
        "role:radio:Office": { exists: true, checked: false },
        "css:#save-main": { exists: true }
      }
    });

    const result = await applySettings({
      deviceIp: "192.168.0.10",
      mapPath: "state/printer-ui-map.json",
      auditDbPath: dbPath,
      settings: {
        meta: {
          customerName: "Acme",
          accountNumber: "10001",
          variation: "base",
          scriptVariant: "base"
        },
        settings: [
          { id: "main.host-name", value: "Printer-A" },
          { id: "main.mode", value: "Auto" },
          { id: "main.enabled", value: "On" },
          { id: "main.profile", value: "Office" }
        ]
      },
      deviceLogMode: "daily",
      runtime
    });

    assert.equal(result.status, "COMPLETED");
    assert.ok(pageState.calls.some((line) => line.startsWith("fill:label:Host Name:Printer-A")));
    assert.ok(pageState.calls.some((line) => line.includes("select:role:combobox:Mode")));
    assert.ok(pageState.calls.some((line) => line === "check:label:Enabled"));
    assert.ok(pageState.calls.some((line) => line === "click:role:radio:Office"));
    assert.ok(pageState.calls.some((line) => line === "click:css:#save-main"));

    const { run, items } = getRunRecord(dbPath);
    assert.equal(run.status, "completed");
    assert.equal(run.account_number, "10001");
    assert.equal(run.variation, "base");
    assert.ok(items.length >= 5);
    assert.ok(items.filter((item) => item.status === "ok").length >= 5);
  } finally {
    await removeWithRetry(tempDir);
  }
});

test("integration: runner records partial run when prior items succeed before terminal failure", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    const map = createIntegrationMap();
    await importUiMapToDatabase(dbPath, map);

    const { runtime } = createFakeRuntime(map, {
      locators: {
        "label:Host Name": { exists: true },
        "role:combobox:Mode": { exists: true, selectAllowed: ["Auto", "Manual"] }
      }
    });

    const result = await applySettings({
      deviceIp: "192.168.0.10",
      mapPath: "state/printer-ui-map.json",
      auditDbPath: dbPath,
      settings: {
        meta: {
          customerName: "Acme",
          accountNumber: "10001",
          variation: "partial"
        },
        settings: [
          { id: "main.host-name", value: "Printer-B" },
          { id: "main.mode", value: "InvalidOption" }
        ]
      },
      deviceLogMode: "daily",
      runtime
    });

    assert.equal(result.status, "FAILED");
    const { run, items } = getRunRecord(dbPath);
    assert.equal(run.status, "partial");
    assert.ok(items.some((item) => item.setting_id === "main.host-name" && item.status === "ok"));
    assert.ok(items.some((item) => item.setting_id === "main.mode" && item.status === "error"));
  } finally {
    await removeWithRetry(tempDir);
  }
});

test("integration: runner records failed run when first setting terminally fails", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  try {
    const map = createIntegrationMap();
    await importUiMapToDatabase(dbPath, map);

    const { runtime } = createFakeRuntime(map, {
      locators: {
        "role:combobox:Mode": { exists: true, selectAllowed: ["Auto", "Manual"] }
      }
    });

    const result = await applySettings({
      deviceIp: "192.168.0.10",
      mapPath: "state/printer-ui-map.json",
      auditDbPath: dbPath,
      settings: {
        meta: {
          customerName: "Acme",
          accountNumber: "10001",
          variation: "failed"
        },
        settings: [{ id: "main.host-name", value: "Printer-C" }]
      },
      deviceLogMode: "daily",
      runtime
    });

    assert.equal(result.status, "FAILED");
    const { run, items } = getRunRecord(dbPath);
    assert.equal(run.status, "failed");
    assert.equal(items.length, 1);
    assert.equal(items[0].setting_id, "main.host-name");
    assert.equal(items[0].status, "error");
    assert.match(items[0].message, /selector resolution failed/i);
  } finally {
    await removeWithRetry(tempDir);
  }
});
