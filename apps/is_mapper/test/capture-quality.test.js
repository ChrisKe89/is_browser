import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFieldLabel } from "../src/utils.ts";
import { readControlState } from "../src/mapping/fieldDiscovery.ts";
import { shouldContributeToBreadcrumb } from "../src/graph.ts";

function emptyLocatorResult() {
  return {
    count: async () => 0,
    innerText: async () => ""
  };
}

function emptyLocator() {
  return {
    first: () => emptyLocatorResult()
  };
}

function fakePage() {
  return {
    locator: () => emptyLocator()
  };
}

test("deriveFieldLabel prefers aria-label and marks it explicit", async () => {
  const element = {
    getAttribute: async (name) => (name === "aria-label" ? "Login Attempts" : null),
    evaluate: async () => "",
    locator: () => emptyLocator()
  };
  const result = await deriveFieldLabel(fakePage(), element);
  assert.equal(result.label, "Login Attempts");
  assert.equal(result.labelQuality, "explicit");
});

test("deriveFieldLabel falls back to derived id text", async () => {
  const element = {
    getAttribute: async (name) => (name === "id" ? "failedAttemptsInput" : null),
    evaluate: async () => {
      throw new Error("no-eval");
    },
    locator: () => emptyLocator()
  };
  const result = await deriveFieldLabel(fakePage(), element);
  assert.equal(result.label, "(Derived) Failed Attempts");
  assert.equal(result.labelQuality, "derived");
});

test("deriveFieldLabel emits unknown label when no signal exists", async () => {
  const element = {
    getAttribute: async () => null,
    evaluate: async () => {
      throw new Error("no-eval");
    },
    locator: () => emptyLocator()
  };
  const result = await deriveFieldLabel(fakePage(), element);
  assert.equal(result.label, "(Unknown Setting)");
  assert.equal(result.labelQuality, "missing");
});

test("readControlState parses checkbox via isChecked", async () => {
  const state = await readControlState(
    {
      isChecked: async () => true
    },
    { fieldType: "checkbox" }
  );
  assert.equal(state.valueType, "boolean");
  assert.equal(state.currentValue, true);
});

test("readControlState parses native select with selected-label fallback", async () => {
  const state = await readControlState(
    {
      inputValue: async () => "",
      locator: () => ({
        evaluateAll: async () => [
          { value: "none", label: "None", selected: true },
          { value: "allow", label: "Allow", selected: false }
        ]
      })
    },
    { fieldType: "select", tagName: "select" }
  );
  assert.equal(state.valueType, "enum");
  assert.equal(state.currentValue, "none");
  assert.equal(state.options?.length, 2);
});

test("readControlState parses custom combobox active option", async () => {
  const state = await readControlState(
    {
      evaluate: async () => ({
        activeOption: { value: "accounting", label: "Accounting" },
        selectedOption: undefined,
        expanded: false,
        controlText: "",
        options: [{ value: "accounting", label: "Accounting" }]
      })
    },
    { fieldType: "select", tagName: "div", roleAttr: "combobox" }
  );
  assert.equal(state.valueType, "enum");
  assert.equal(state.currentValue, "accounting");
});

test("shouldContributeToBreadcrumb keeps meaningful nav labels", () => {
  assert.equal(
    shouldContributeToBreadcrumb({
      action: "click",
      kind: "tab",
      label: "Access Control",
      selector: { kind: "role", role: "tab", name: "Access Control" }
    }),
    true
  );
  assert.equal(
    shouldContributeToBreadcrumb({
      action: "click",
      kind: "modal_open",
      label: "Device Details",
      selector: { kind: "role", role: "button", name: "Device Details" }
    }),
    true
  );
});

test("shouldContributeToBreadcrumb rejects option-like blobs and unknown steps", () => {
  assert.equal(
    shouldContributeToBreadcrumb({
      action: "click",
      kind: "unknown",
      label: "Access Control"
    }),
    false
  );
  assert.equal(
    shouldContributeToBreadcrumb({
      action: "click",
      kind: "button",
      label: "None | Numbers | Special | Characters | Uppercase | Lowercase"
    }),
    false
  );
});
