import { openBrowser, newPage } from "../mcp/browser.js";
import { AUTH_STATE_PATH, PRINTER_URL } from "../config/env.js";
import { mkdir } from "node:fs/promises";

async function run(): Promise<void> {
  await mkdir("artifacts", { recursive: true });
  await mkdir("state", { recursive: true });
  const browser = await openBrowser({ headless: false });
  const page = await newPage(browser, { storageStatePath: undefined });
  await page.goto(PRINTER_URL, { waitUntil: "domcontentloaded" });

  console.log("Log in manually in the opened browser.");
  console.log("When done, return here and press Enter to save auth state.");

  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  await page.context().storageState({ path: AUTH_STATE_PATH });
  console.log(`Saved auth state to ${AUTH_STATE_PATH}`);
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
