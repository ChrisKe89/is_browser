import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRadioValue,
  applySelectValue,
  applySwitchValue,
  buildPageCommitActionMap,
  executePageNavigation,
  isNavigationTargetReached,
  parseSwitchTarget,
  rankSelectors,
  resolveLocatorByPriority
} from "../src/runner/engine.js";

function createMockLocator({
  count = 0,
  onClick,
  onSelectOption,
  checkedState,
  ariaChecked,
  children = {}
} = {}) {
  return {
    _count: count,
    _checkedState: checkedState,
    _ariaChecked: ariaChecked,
    first() {
      return this;
    },
    async count() {
      return this._count;
    },
    async click() {
      if (onClick) onClick();
    },
    async fill() {},
    async selectOption(arg) {
      if (onSelectOption) {
        return onSelectOption(arg);
      }
      return [];
    },
    locator(query) {
      return children[query] ?? createMockLocator();
    },
    filter({ hasText }) {
      const filtered = children.__filter;
      if (typeof filtered === "function") {
        return filtered(hasText);
      }
      return createMockLocator();
    },
    async isChecked() {
      if (typeof this._checkedState !== "boolean") {
        throw new Error("checked-state-unavailable");
      }
      return this._checkedState;
    },
    async check() {
      this._checkedState = true;
    },
    async uncheck() {
      this._checkedState = false;
    },
    async getAttribute(name) {
      if (name === "aria-checked") {
        return this._ariaChecked ?? null;
      }
      return null;
    }
  };
}

function createMockPage({ counts = {}, clickHandlers = {}, initialUrl = "http://printer/#/home" } = {}) {
  const page = {
    currentUrl: initialUrl,
    actions: [],
    async goto(url) {
      page.actions.push(`goto:${url}`);
      page.currentUrl = url;
    },
    async waitForLoadState(state) {
      page.actions.push(`wait:${state}`);
    },
    url() {
      return page.currentUrl;
    },
    getByLabel(value) {
      return buildLocator(`label:${value}`);
    },
    getByRole(role, options = {}) {
      const roleName = options.name === undefined ? "" : String(options.name);
      return buildLocator(`role:${role}:${roleName}`);
    },
    getByText(value) {
      return buildLocator(`text:${value}`);
    },
    locator(value) {
      return buildLocator(`css:${value}`);
    }
  };

  function buildLocator(key) {
    return createMockLocator({
      count: counts[key] ?? 0,
      onClick: () => {
        page.actions.push(`click:${key}`);
        const handler = clickHandlers[key];
        if (handler) {
          handler(page);
        }
      }
    });
  }

  return page;
}

test("rankSelectors prefers lower numeric priority", () => {
  const ranked = rankSelectors([
    { kind: "css", value: "#third", priority: 3 },
    { kind: "label", value: "First", priority: 1 },
    { kind: "text", value: "Second", priority: 2 }
  ]);
  assert.deepEqual(
    ranked.map((item) => item.priority),
    [1, 2, 3]
  );
  assert.equal(ranked[0].selector.kind, "label");
});

test("resolveLocatorByPriority tries selectors in priority order", async () => {
  const page = createMockPage({
    counts: {
      "css:#missing": 0,
      "label:Hostname": 1
    }
  });
  const resolved = await resolveLocatorByPriority(
    page,
    [
      { kind: "label", value: "Hostname", priority: 2 },
      { kind: "css", value: "#missing", priority: 1 }
    ],
    'setting "network.host" on page "network"'
  );
  assert.equal(resolved.priority, 2);
  assert.equal(resolved.selector.kind, "label");
});

test("resolveLocatorByPriority failure includes context", async () => {
  const page = createMockPage();
  await assert.rejects(
    async () => {
      await resolveLocatorByPriority(
        page,
        [{ kind: "css", value: "#missing", priority: 1 }],
        'setting "network.host" on page "network"'
      );
    },
    /Selector resolution failed for setting "network\.host" on page "network"/
  );
});

test("executePageNavigation follows steps and confirms target", async () => {
  const page = createMockPage({
    counts: { "css:#open-network": 1 },
    clickHandlers: {
      "css:#open-network": (context) => {
        context.currentUrl = "http://printer/#/network";
      }
    }
  });

  await executePageNavigation(
    page,
    {
      id: "network",
      url: "http://printer/#/network",
      navPath: [
        { action: "goto", url: "http://printer/#/home" },
        { action: "click", selector: { kind: "css", value: "#open-network" } }
      ]
    },
    "http://printer"
  );

  assert.deepEqual(page.actions, [
    "goto:http://printer/#/home",
    "click:css:#open-network",
    "wait:networkidle"
  ]);
});

test("executePageNavigation fails when click target is missing", async () => {
  const page = createMockPage();
  await assert.rejects(
    async () => {
      await executePageNavigation(
        page,
        {
          id: "system",
          url: "http://printer/#/system",
          navPath: [{ action: "click", selector: { kind: "css", value: "#missing" } }]
        },
        "http://printer"
      );
    },
    /navigation step 1 on page "system"/
  );
});

test("parseSwitchTarget handles On and Off variants", () => {
  assert.equal(parseSwitchTarget("On", "network.ipv6"), true);
  assert.equal(parseSwitchTarget("off", "network.ipv6"), false);
  assert.throws(() => parseSwitchTarget("invalid", "network.ipv6"), /Invalid switch value/);
});

test("applySwitchValue converges to requested state", async () => {
  const locator = createMockLocator({ checkedState: false });
  await applySwitchValue(locator, "On", "network.ipv6");
  assert.equal(await locator.isChecked(), true);
});

test("applySelectValue uses option-text fallback when direct selection fails", async () => {
  let optionTextClicked = false;
  const optionByValue = createMockLocator({ count: 0 });
  const optionByText = createMockLocator({
    count: 1,
    onClick: () => {
      optionTextClicked = true;
    }
  });
  const optionCollection = {
    first() {
      return this;
    },
    async count() {
      return 0;
    },
    filter({ hasText }) {
      return hasText === "Office" ? optionByText : createMockLocator({ count: 0 });
    }
  };
  const selectLocator = createMockLocator({
    count: 1,
    onSelectOption: () => [],
    children: {
      'option[value="Office"]': optionByValue,
      option: optionCollection
    }
  });
  const page = createMockPage();

  await applySelectValue(page, selectLocator, "Office", "system.mode");
  assert.equal(optionTextClicked, true);
});

test("applyRadioValue selects by target option label first", async () => {
  let targetRadioClicked = false;
  const page = createMockPage({
    counts: {
      "role:radio:Night": 1
    },
    clickHandlers: {
      "role:radio:Night": () => {
        targetRadioClicked = true;
      }
    }
  });
  const fallbackLocator = createMockLocator({ count: 1, checkedState: false });
  await applyRadioValue(page, fallbackLocator, "Night", "system.profile");
  assert.equal(targetRadioClicked, true);
});

test("isNavigationTargetReached requires hash when expected contains hash", () => {
  assert.equal(
    isNavigationTargetReached("http://printer/#/network", "http://printer/#/network"),
    true
  );
  assert.equal(
    isNavigationTargetReached("http://printer/#/network", "http://printer/#/home"),
    false
  );
});

test("buildPageCommitActionMap prefers Save-like actions per page", () => {
  const actions = buildPageCommitActionMap([
    {
      id: "system.hostname",
      pageId: "system",
      label: "Host Name",
      type: "text",
      selectors: [{ kind: "css", value: "#host" }],
      actions: [{ selector: { kind: "css", value: "#applyButton" }, label: "Apply" }]
    },
    {
      id: "system.location",
      pageId: "system",
      label: "Location",
      type: "text",
      selectors: [{ kind: "css", value: "#location" }],
      actions: [{ selector: { kind: "css", value: "#saveButton" }, label: "Save" }]
    }
  ]);

  const chosen = actions.get("system");
  assert.ok(chosen);
  assert.equal(chosen?.label, "Save");
});
