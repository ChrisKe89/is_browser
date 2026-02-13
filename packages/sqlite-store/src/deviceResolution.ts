import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "./migrations.js";

export type DeviceResolutionRecord = {
  modelName: string;
  serial: string;
  customerName: string;
  accountNumber: string;
  variation: string;
  modelMatch?: string;
};

export type AccountVariation = {
  variation: string;
  modelRequirements: string[];
};

export type AccountSearchRecord = {
  accountNumber: string;
};

function parseCsvLine(line: string): string[] {
  const columns: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      columns.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  columns.push(current);
  return columns;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSerial(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length > 6
    ? trimmed.slice(-6).padStart(6, "0")
    : trimmed.padStart(6, "0");
}

function toLikePattern(query?: string): string {
  return `%${(query ?? "").trim()}%`;
}

function normalizeRequirement(value?: string): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function modelMatchesRequirement(
  modelName: string,
  requirement?: string,
): boolean {
  const model = modelName.trim().toLowerCase();
  const required = normalizeRequirement(requirement)?.toLowerCase();
  if (!required) {
    return true;
  }

  // Supports simple wildcard semantics with '*' for operator-maintained requirements.
  if (required.includes("*")) {
    const escaped = required
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    const expression = new RegExp(`^${escaped}$`, "i");
    return expression.test(modelName);
  }

  return model.includes(required);
}

export async function upsertDeviceResolutionRecords(
  dbPath: string,
  records: DeviceResolutionRecord[],
): Promise<{ insertedOrUpdated: number }> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();

  const upsert = db.prepare(
    `INSERT INTO device_resolution (
      model_name, serial, customer_name, account_number, variation, model_match, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model_name, serial) DO UPDATE SET
      customer_name = excluded.customer_name,
      account_number = excluded.account_number,
      variation = excluded.variation,
      model_match = excluded.model_match,
      updated_at = excluded.updated_at`,
  );

  let insertedOrUpdated = 0;
  let transactionOpen = false;
  try {
    db.exec("BEGIN");
    transactionOpen = true;
    for (const record of records) {
      const modelName = String(record.modelName ?? "").trim();
      const serial = normalizeSerial(record.serial);
      const customerName = String(record.customerName ?? "").trim();
      const accountNumber = String(record.accountNumber ?? "").trim();
      const variation = String(record.variation ?? "").trim() || "default";
      if (!modelName || !serial || !customerName || !accountNumber) {
        continue;
      }
      upsert.run(
        modelName,
        serial,
        customerName,
        accountNumber,
        variation,
        normalizeRequirement(record.modelMatch ?? modelName) ?? null,
        now,
      );
      insertedOrUpdated += 1;
    }
    db.exec("COMMIT");
    transactionOpen = false;
    return { insertedOrUpdated };
  } catch (error) {
    if (transactionOpen) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    db.close();
  }
}

export async function importDeviceResolutionFromCsv(
  dbPath: string,
  csvPath: string,
): Promise<{ rowsRead: number; rowsUpserted: number }> {
  const raw = await readFile(csvPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { rowsRead: 0, rowsUpserted: 0 };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const modelIndex = headers.indexOf("model");
  const serialIndex = headers.indexOf("serial");
  const customerIndex = headers.indexOf("customer_name");
  const accountIndex = headers.indexOf("account_number");
  const variationIndex = headers.indexOf("variation");
  const matchIndex = headers.indexOf("model_match");
  if (
    modelIndex < 0 ||
    serialIndex < 0 ||
    customerIndex < 0 ||
    accountIndex < 0
  ) {
    return { rowsRead: 0, rowsUpserted: 0 };
  }

  const records: DeviceResolutionRecord[] = [];
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
    const columns = parseCsvLine(lines[rowIndex]);
    records.push({
      modelName: columns[modelIndex] ?? "",
      serial: columns[serialIndex] ?? "",
      customerName: columns[customerIndex] ?? "",
      accountNumber: columns[accountIndex] ?? "",
      variation: columns[variationIndex] ?? "default",
      modelMatch: columns[matchIndex] ?? undefined,
    });
  }

  const result = await upsertDeviceResolutionRecords(dbPath, records);
  return { rowsRead: records.length, rowsUpserted: result.insertedOrUpdated };
}

export async function ensureDeviceResolutionSeededFromCsv(
  dbPath: string,
  csvPath: string,
): Promise<{ seeded: boolean; rowsUpserted: number }> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM device_resolution")
      .get() as { count: number };
    if (Number(row.count ?? 0) > 0) {
      return { seeded: false, rowsUpserted: 0 };
    }
  } finally {
    db.close();
  }

  const imported = await importDeviceResolutionFromCsv(dbPath, csvPath).catch(
    () => ({
      rowsRead: 0,
      rowsUpserted: 0,
    }),
  );
  return {
    seeded: imported.rowsUpserted > 0,
    rowsUpserted: imported.rowsUpserted,
  };
}

export async function resolveDeviceByModelAndSerial(
  dbPath: string,
  input: { modelName: string; serial: string },
): Promise<DeviceResolutionRecord | null> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const serial = normalizeSerial(input.serial);
    if (!serial) {
      return null;
    }
    const rows = db
      .prepare(
        `SELECT model_name, serial, customer_name, account_number, variation, model_match
         FROM device_resolution
         WHERE serial = ?
         ORDER BY CASE WHEN LOWER(model_name) = LOWER(?) THEN 0 ELSE 1 END, id ASC`,
      )
      .all(serial, input.modelName)
      .map(
        (row) =>
          row as {
            model_name: string;
            serial: string;
            customer_name: string;
            account_number: string;
            variation: string;
            model_match: string | null;
          },
      );

    for (const row of rows) {
      if (row.model_name.toLowerCase() !== input.modelName.toLowerCase()) {
        continue;
      }
      if (
        !modelMatchesRequirement(input.modelName, row.model_match ?? undefined)
      ) {
        continue;
      }
      return {
        modelName: row.model_name,
        serial: row.serial,
        customerName: row.customer_name,
        accountNumber: row.account_number,
        variation: row.variation,
        modelMatch: row.model_match ?? undefined,
      };
    }
    return null;
  } finally {
    db.close();
  }
}

export async function searchAccounts(
  dbPath: string,
  query?: string,
): Promise<AccountSearchRecord[]> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const like = toLikePattern(query);
    const rows = db
      .prepare(
        `SELECT DISTINCT account_number
         FROM (
           SELECT account_number FROM config_profile
           UNION
           SELECT account_number FROM device_resolution
         )
         WHERE account_number LIKE ?
         ORDER BY account_number ASC
         LIMIT 50`,
      )
      .all(like)
      .map((row) => row as { account_number: string });

    return rows.map((row) => ({ accountNumber: row.account_number }));
  } finally {
    db.close();
  }
}

export async function listVariationsForAccount(
  dbPath: string,
  accountNumber: string,
): Promise<AccountVariation[]> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const profileVariations = db
      .prepare(
        `SELECT variation
         FROM config_profile
         WHERE account_number = ?
         ORDER BY variation`,
      )
      .all(accountNumber)
      .map((row) => (row as { variation: string }).variation);

    const requirements = db
      .prepare(
        `SELECT variation, model_match
         FROM device_resolution
         WHERE account_number = ?
         ORDER BY variation`,
      )
      .all(accountNumber)
      .map((row) => row as { variation: string; model_match: string | null });

    const variationSet = new Set<string>();
    const requirementsByVariation = new Map<string, Set<string>>();

    for (const variation of profileVariations) {
      variationSet.add(variation);
      if (!requirementsByVariation.has(variation)) {
        requirementsByVariation.set(variation, new Set<string>());
      }
    }
    for (const row of requirements) {
      const variation = row.variation || "default";
      variationSet.add(variation);
      const set = requirementsByVariation.get(variation) ?? new Set<string>();
      const requirement = normalizeRequirement(row.model_match ?? undefined);
      if (requirement) {
        set.add(requirement);
      }
      requirementsByVariation.set(variation, set);
    }

    return Array.from(variationSet)
      .sort((left, right) => left.localeCompare(right))
      .map((variation) => ({
        variation,
        modelRequirements: Array.from(
          requirementsByVariation.get(variation) ?? [],
        ).sort((left, right) => left.localeCompare(right)),
      }));
  } finally {
    db.close();
  }
}

export async function variationMatchesModelRequirement(
  dbPath: string,
  input: { accountNumber: string; variation: string; modelName: string },
): Promise<boolean> {
  const variations = await listVariationsForAccount(
    dbPath,
    input.accountNumber,
  );
  const variation = variations.find(
    (item) => item.variation === input.variation,
  );
  if (!variation) {
    return false;
  }
  if (variation.modelRequirements.length === 0) {
    return true;
  }
  return variation.modelRequirements.some((requirement) =>
    modelMatchesRequirement(input.modelName, requirement),
  );
}
