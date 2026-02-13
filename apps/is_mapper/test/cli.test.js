import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapperCliArgs } from "../src/cli.ts";

test("cli parser: parses manual mapper flags", () => {
  const parsed = parseMapperCliArgs([
    "--manual",
    "--location",
    "permissions",
    "--screenshot",
    "--url",
    "http://127.0.0.1",
    "--max-clicks",
    "25",
    "--timeout-ms",
    "12000",
  ]);

  assert.equal(parsed.manual, true);
  assert.equal(parsed.location, "permissions");
  assert.equal(parsed.screenshot, true);
  assert.equal(parsed.url, "http://127.0.0.1");
  assert.equal(parsed.maxClicks, 25);
  assert.equal(parsed.timeoutMs, 12000);
});

test("cli parser: defaults to crawler mode", () => {
  const originalLocation = process.env.npm_config_location;
  const originalScreenshot = process.env.npm_config_screenshot;
  const originalMapperLocation = process.env.IS_MAPPER_LOCATION;
  const originalMapperScreenshot = process.env.IS_MAPPER_SCREENSHOT;
  delete process.env.npm_config_location;
  delete process.env.npm_config_screenshot;
  delete process.env.IS_MAPPER_LOCATION;
  delete process.env.IS_MAPPER_SCREENSHOT;
  try {
    const parsed = parseMapperCliArgs([]);
    assert.equal(parsed.manual, false);
    assert.equal(parsed.screenshot, false);
  } finally {
    if (typeof originalLocation === "string")
      process.env.npm_config_location = originalLocation;
    if (typeof originalScreenshot === "string")
      process.env.npm_config_screenshot = originalScreenshot;
    if (typeof originalMapperLocation === "string")
      process.env.IS_MAPPER_LOCATION = originalMapperLocation;
    if (typeof originalMapperScreenshot === "string")
      process.env.IS_MAPPER_SCREENSHOT = originalMapperScreenshot;
  }
});

test("cli parser: supports npm-config fallback for swallowed flags", () => {
  const originalLocation = process.env.npm_config_location;
  const originalScreenshot = process.env.npm_config_screenshot;
  process.env.npm_config_location = "permissions";
  process.env.npm_config_screenshot = "true";
  try {
    const parsed = parseMapperCliArgs(["--manual"]);
    assert.equal(parsed.location, "permissions");
    assert.equal(parsed.screenshot, true);
  } finally {
    if (typeof originalLocation === "string")
      process.env.npm_config_location = originalLocation;
    else delete process.env.npm_config_location;
    if (typeof originalScreenshot === "string")
      process.env.npm_config_screenshot = originalScreenshot;
    else delete process.env.npm_config_screenshot;
  }
});
