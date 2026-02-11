import { PROFILE_DB_PATH } from "../../../packages/platform/src/env.js";
import { migrateDatabase } from "../../../packages/storage/src/migrations.js";

async function run(): Promise<void> {
  const dbPath = process.argv[2] ?? PROFILE_DB_PATH;
  await migrateDatabase(dbPath);
  console.log(`Applied database migrations to ${dbPath}`);
}

run().catch((error) => {
  console.error(`Failed to apply migrations: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

