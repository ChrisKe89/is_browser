import { test } from "node:test";
import assert from "node:assert/strict";

test("click log: screenshot path is optional", () => {
  const log = {
    meta: {
      generatedAt: "2026-02-11T00:00:00.000Z",
      baseUrl: "http://127.0.0.1",
      runPath: "permissions/20260211-120000",
      clickCount: 2
    },
    clicks: [
      {
        index: 1,
        timestamp: "2026-02-11T00:00:01.000Z",
        target: "Advanced",
        selectors: [{ kind: "css", value: "button.advanced" }],
        urlBefore: "http://127.0.0.1",
        urlAfter: "http://127.0.0.1",
        newFieldIds: ["page.advanced"],
        screenshotPath: "permissions/20260211-120000/screenshots/click-0001.png"
      },
      {
        index: 2,
        timestamp: "2026-02-11T00:00:02.000Z",
        target: "Apply",
        selectors: [{ kind: "css", value: "button.apply" }],
        urlBefore: "http://127.0.0.1",
        urlAfter: "http://127.0.0.1",
        newFieldIds: []
      }
    ]
  };

  const serialized = JSON.parse(JSON.stringify(log));
  assert.equal(serialized.clicks[0].screenshotPath.includes("click-0001.png"), true);
  assert.equal(Object.hasOwn(serialized.clicks[1], "screenshotPath"), false);
});
