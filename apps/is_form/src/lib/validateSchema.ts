import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UISchemaField } from "./types.js";

type ValidationResult = {
  warnings: string[];
  errors: string[];
};

export function validateSchema(fields: UISchemaField[]): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  fields.forEach((field, index) => {
    if (seen.has(field.field_id)) {
      errors.push(`Duplicate field_id at index ${index}: ${field.field_id}`);
    } else {
      seen.add(field.field_id);
    }

    if (!field.container_id?.trim()) {
      errors.push(`Missing container_id for field ${field.field_id}`);
    }

    if (
      (field.control_type === "dropdown" || field.control_type === "radio_group") &&
      (!field.options || field.options.length === 0)
    ) {
      warnings.push(`Field ${field.field_id} has no options`);
    }

    if (!field.locators?.selector && !field.locators?.dom_selector) {
      warnings.push(`Field ${field.field_id} has neither selector nor dom_selector`);
    }
  });

  return { warnings, errors };
}

async function runCli(): Promise<void> {
  const schemaPath = path.resolve(process.cwd(), process.argv[2] ?? "data/ui_schema_fields.json");
  const content = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(content) as UISchemaField[];
  const result = validateSchema(schema);
  console.log(`Validated ${schema.length} fields`);
  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (thisFile === invokedFile) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
