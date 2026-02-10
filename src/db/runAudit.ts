import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "./migrations.js";

export type ApplyRunStatus = "started" | "completed" | "partial" | "failed";
export type ApplyRunItemStatus = "ok" | "error" | "skipped";

export type RunAuditStartInput = {
  accountNumber: string;
  variation: string;
  deviceIp: string;
  mapPath: string;
};

type RunAuditFinishInput = {
  status: Exclude<ApplyRunStatus, "started">;
  message?: string;
};

export type RunAuditItemInput = {
  settingId?: string;
  attempt: number;
  status: ApplyRunItemStatus;
  message: string;
  attemptedAt?: string;
};

export class RunAuditSession {
  readonly runId: number;

  private readonly db: DatabaseSync;
  private readonly insertItemStatement;
  private readonly finishStatement;

  constructor(runId: number, db: DatabaseSync) {
    this.runId = runId;
    this.db = db;
    this.insertItemStatement = db.prepare(
      `INSERT INTO apply_run_item (run_id, setting_id, attempt, status, message, attempted_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    this.finishStatement = db.prepare(
      `UPDATE apply_run
       SET status = ?, message = ?, finished_at = ?
       WHERE id = ?`
    );
  }

  recordItem(input: RunAuditItemInput): void {
    this.insertItemStatement.run(
      this.runId,
      input.settingId ?? null,
      input.attempt,
      input.status,
      input.message,
      input.attemptedAt ?? new Date().toISOString()
    );
  }

  finish(input: RunAuditFinishInput): void {
    this.finishStatement.run(
      input.status,
      input.message ?? null,
      new Date().toISOString(),
      this.runId
    );
  }

  close(): void {
    this.db.close();
  }
}

export async function startRunAudit(
  dbPath: string,
  input: RunAuditStartInput
): Promise<RunAuditSession> {
  await migrateDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");

  const insertRunStatement = db.prepare(
    `INSERT INTO apply_run (
       account_number,
       variation,
       device_ip,
       map_path,
       status,
       message,
       started_at
     ) VALUES (?, ?, ?, ?, 'started', ?, ?)`
  );

  const normalizedAccount = input.accountNumber.trim() || "unknown";
  const normalizedVariation = input.variation.trim() || "default";
  const startedAt = new Date().toISOString();

  const result = insertRunStatement.run(
    normalizedAccount,
    normalizedVariation,
    input.deviceIp,
    input.mapPath,
    "Run started",
    startedAt
  );

  const runId = Number(result.lastInsertRowid);
  if (!Number.isInteger(runId) || runId <= 0) {
    db.close();
    throw new Error("Failed to create apply_run record.");
  }

  return new RunAuditSession(runId, db);
}
