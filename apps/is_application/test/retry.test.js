import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApplyError, shouldRetryFailure } from "../src/runner/retry.js";

test("classifyApplyError marks timeout as transient", () => {
  const classified = classifyApplyError(new Error("locator.click: Timeout 30000ms exceeded"));
  assert.equal(classified.classification, "transient");
  assert.equal(classified.reason, "timeout");
});

test("classifyApplyError marks selector resolution as terminal", () => {
  const classified = classifyApplyError(
    new Error('Selector resolution failed for setting "network.host" on page "network"')
  );
  assert.equal(classified.classification, "terminal");
});

test("shouldRetryFailure only retries bounded transient failures", () => {
  assert.equal(
    shouldRetryFailure(
      { classification: "transient", reason: "timeout", message: "timeout" },
      1,
      3
    ),
    true
  );
  assert.equal(
    shouldRetryFailure(
      { classification: "transient", reason: "timeout", message: "timeout" },
      3,
      3
    ),
    false
  );
  assert.equal(
    shouldRetryFailure(
      { classification: "terminal", reason: "invalid-setting-state", message: "invalid" },
      1,
      3
    ),
    false
  );
});

