import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type FieldRecordV4 = {
  field_id: string;
  type: string;
  value: {
    value_type: string;
    current_value: string | number | boolean | null;
    default_value: string | number | boolean | null;
  };
};

type FieldRecordV3 = {
  settingKey: string;
  type: string;
  currentValue: string | number | boolean | null;
  defaultValue: string | number | boolean | null;
};

type FieldRecordAny = FieldRecordV4 | FieldRecordV3;

type CaptureSchema = {
  meta?: { schemaVersion?: string };
  fieldRecords?: FieldRecordAny[];
  settings?: FieldRecordAny[];
};

function getFieldId(record: FieldRecordAny): string {
  return (record as FieldRecordV4).field_id ?? (record as FieldRecordV3).settingKey ?? "unknown";
}

function getCurrentValue(record: FieldRecordAny): string | number | boolean | null | undefined {
  if ("value" in record && record.value && typeof record.value === "object") {
    return (record as FieldRecordV4).value.current_value;
  }
  return (record as FieldRecordV3).currentValue;
}

function getDefaultValue(record: FieldRecordAny): string | number | boolean | null | undefined {
  if ("value" in record && record.value && typeof record.value === "object") {
    return (record as FieldRecordV4).value.default_value;
  }
  return (record as FieldRecordV3).defaultValue;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const schemaPath = resolve(args[0] ?? "dist/ui_schema.json");
  const thresholdArg = args.indexOf("--threshold");
  const threshold = thresholdArg >= 0 ? Number(args[thresholdArg + 1]) : 0.20;

  const raw = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(raw) as CaptureSchema;
  const records = schema.fieldRecords ?? schema.settings ?? [];

  if (records.length === 0) {
    process.stdout.write("No field records found.\n");
    process.exit(1);
  }

  const byType = new Map<string, { total: number; currentNull: number; defaultNull: number }>();
  const nullCurrentFields: Array<{ field_id: string; type: string }> = [];

  for (const record of records) {
    const type = record.type ?? "unknown";
    const entry = byType.get(type) ?? { total: 0, currentNull: 0, defaultNull: 0 };
    entry.total += 1;
    const currentValue = getCurrentValue(record);
    if (currentValue === null || currentValue === undefined) {
      entry.currentNull += 1;
      nullCurrentFields.push({ field_id: getFieldId(record), type });
    }
    const defaultValue = getDefaultValue(record);
    if (defaultValue === null || defaultValue === undefined) {
      entry.defaultNull += 1;
    }
    byType.set(type, entry);
  }

  let totalFields = 0;
  let totalCurrentNull = 0;
  let totalDefaultNull = 0;

  process.stdout.write("\n");
  process.stdout.write(
    padRight("Type", 22) +
    padRight("Total", 8) +
    padRight("cur_null", 10) +
    padRight("cur_rate", 10) +
    padRight("def_null", 10) +
    padRight("def_rate", 10) +
    "\n"
  );
  process.stdout.write("-".repeat(70) + "\n");

  const sortedTypes = Array.from(byType.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [type, entry] of sortedTypes) {
    totalFields += entry.total;
    totalCurrentNull += entry.currentNull;
    totalDefaultNull += entry.defaultNull;

    process.stdout.write(
      padRight(type, 22) +
      padRight(String(entry.total), 8) +
      padRight(String(entry.currentNull), 10) +
      padRight(pct(entry.currentNull, entry.total), 10) +
      padRight(String(entry.defaultNull), 10) +
      padRight(pct(entry.defaultNull, entry.total), 10) +
      "\n"
    );
  }

  process.stdout.write("-".repeat(70) + "\n");
  process.stdout.write(
    padRight("TOTAL", 22) +
    padRight(String(totalFields), 8) +
    padRight(String(totalCurrentNull), 10) +
    padRight(pct(totalCurrentNull, totalFields), 10) +
    padRight(String(totalDefaultNull), 10) +
    padRight(pct(totalDefaultNull, totalFields), 10) +
    "\n"
  );

  if (nullCurrentFields.length > 0) {
    process.stdout.write(`\nTop ${Math.min(20, nullCurrentFields.length)} fields with null current_value:\n`);
    for (const item of nullCurrentFields.slice(0, 20)) {
      process.stdout.write(`  - ${item.field_id} (${item.type})\n`);
    }
  }

  const currentNullRate = totalFields > 0 ? totalCurrentNull / totalFields : 0;
  process.stdout.write(`\ncurrent_value null rate: ${pct(totalCurrentNull, totalFields)} (threshold: ${(threshold * 100).toFixed(1)}%)\n`);

  if (currentNullRate > threshold) {
    process.stdout.write(`FAIL: current_value null rate ${pct(totalCurrentNull, totalFields)} exceeds threshold ${(threshold * 100).toFixed(1)}%\n`);
    process.exit(1);
  } else {
    process.stdout.write(`PASS: current_value null rate is within threshold.\n`);
  }
}

function pct(count: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
