import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverFieldCandidates } from "../src/mapping/fieldDiscovery.ts";
import { buildSelectorCandidates } from "../src/utils.ts";

function emptyList() {
  return {
    count: async () => 0,
    nth: () => ({})
  };
}

function fakeRootWithDetachedControl() {
  const detachedControl = {
    isVisible: async () => true,
    evaluate: async () => {
      throw new Error("detached");
    },
    getAttribute: async () => {
      throw new Error("detached");
    },
    locator: () => emptyList(),
    isEnabled: async () => true
  };

  return {
    locator: (selector) => {
      if (selector.includes("input:not([type='radio'])")) {
        return {
          count: async () => 1,
          nth: () => detachedControl
        };
      }
      if (selector === "input[type='radio']") {
        return emptyList();
      }
      return emptyList();
    },
    getByRole: () => emptyList()
  };
}

test("field discovery: detached controls are skipped without throwing", async () => {
  const root = fakeRootWithDetachedControl();
  const fakePage = {
    locator: () => root,
    getByRole: () => emptyList(),
    evaluate: async () => ""
  };

  const result = await discoverFieldCandidates(fakePage, root);
  assert.equal(Array.isArray(result.candidates), true);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.actions, undefined);
});

test("selector candidates: locator read errors return empty selector set", async () => {
  const fakeElement = {
    getAttribute: async () => {
      throw new Error("detached");
    },
    evaluate: async () => {
      throw new Error("detached");
    },
    locator: () => ({
      first: () => ({
        count: async () => 0,
        innerText: async () => ""
      })
    })
  };

  const fakePage = {
    evaluate: async () => "",
    locator: () => ({
      first: () => ({
        count: async () => 0,
        innerText: async () => ""
      })
    })
  };

  const result = await buildSelectorCandidates(fakePage, fakeElement);
  assert.equal(result.label, undefined);
  assert.deepEqual(result.selectors, []);
});
