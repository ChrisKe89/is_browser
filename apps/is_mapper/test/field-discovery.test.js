import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldFingerprint } from "../src/mapping/fingerprint.ts";
import { mergeEnums } from "../src/mapping/fieldDiscovery.ts";

test("fingerprint dedupe: same selector and type dedupes", () => {
  const selectors = [{ kind: "css", value: "#hostname" }];
  const a = fieldFingerprint("text", selectors, "Host Name");
  const b = fieldFingerprint("text", selectors, "Host Name");
  assert.equal(a, b);
});

test("fingerprint dedupe: different selector stays unique", () => {
  const one = fieldFingerprint(
    "text",
    [{ kind: "css", value: "#hostA" }],
    "Host Name",
  );
  const two = fieldFingerprint(
    "text",
    [{ kind: "css", value: "#hostB" }],
    "Host Name",
  );
  assert.notEqual(one, two);
});

test("enum merge: unions and sorts options", () => {
  const merged = mergeEnums(["B", "A"], ["A", "C"]);
  assert.deepEqual(merged, ["A", "B", "C"]);
});
