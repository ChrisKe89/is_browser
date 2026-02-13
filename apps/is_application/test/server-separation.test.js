import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { createFormServer } from "../../is_form/src/server/formServer.js";
import { createOperatorServer } from "../src/server/operatorServer.js";

async function makeTempDbPath() {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "printer-ui-server-split-"),
  );
  return { tempDir, dbPath: path.join(tempDir, "test.sqlite") };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to read test server address.");
  }
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(undefined);
    });
  });
}

test("operator product exposes operator API surface and excludes form API surface", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  const server = createOperatorServer({
    profileDbPath: dbPath,
    customerMapCsvPath: "../../tools/samples/devices/customer-map.csv",
    formPublicUrl: "http://localhost:5051/",
  });

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const operatorConfigResponse = await fetch(
      `${baseUrl}/api/operator/config`,
    );
    assert.equal(operatorConfigResponse.status, 200);
    const operatorConfig = await operatorConfigResponse.json();
    assert.equal(operatorConfig.formUrl, "http://localhost:5051/");

    const formApiResponse = await fetch(
      `${baseUrl}/api/profiles/list?accountNumber=${encodeURIComponent("10001")}`,
    );
    assert.equal(formApiResponse.status, 404);
  } finally {
    await close(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("form product exposes form API surface and excludes operator API surface", async () => {
  const { tempDir, dbPath } = await makeTempDbPath();
  const server = createFormServer({
    profileDbPath: dbPath,
    operatorPublicUrl: "http://localhost:5050/",
  });

  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;

    const formConfigResponse = await fetch(`${baseUrl}/api/form/config`);
    assert.equal(formConfigResponse.status, 200);
    const formConfig = await formConfigResponse.json();
    assert.equal(formConfig.operatorUrl, "http://localhost:5050/");

    const operatorApiResponse = await fetch(`${baseUrl}/api/discovery/config`);
    assert.equal(operatorApiResponse.status, 404);

    const applyApiResponse = await fetch(`${baseUrl}/api/start/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(applyApiResponse.status, 404);
  } finally {
    await close(server);
    await rm(tempDir, { recursive: true, force: true });
  }
});
