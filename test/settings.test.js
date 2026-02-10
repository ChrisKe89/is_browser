import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCustomerFolder, resolveSettingsFromCsv } from "../src/runner/settings.js";
import { splitProductCodeAndSerial } from "../src/runner/logging.js";

test("resolveCustomerFolder sanitizes names", () => {
  const folder = resolveCustomerFolder("Acme/Corp", "1000:1");
  assert.ok(folder.includes("Acme_Corp - 1000_1"));
});

test("resolveSettingsFromCsv finds matching settings path", async () => {
  const path = await resolveSettingsFromCsv("Apeos C3530", "043240");
  assert.equal(path, "customer_settings/Test_MFD - 10001/settings.json");
});

test("splitProductCodeAndSerial splits combined value", () => {
  const { productCode, serial } = splitProductCodeAndSerial("TC101894043240");
  assert.equal(productCode, "TC101894");
  assert.equal(serial, "043240");
});
