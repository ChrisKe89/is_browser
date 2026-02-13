import { DatabaseSync } from "node:sqlite";
import {
  ApplyRunFinishInputSchema,
  ApplyRunItemInputSchema,
  ApplyRunStartInputSchema,
  ApplyRunStatusSchema,
  type ApplyRunFinishInput as ContractRunAuditFinishInput,
  type ApplyRunItemInput as ContractRunAuditItemInput,
  type ApplyRunStartInput as ContractRunAuditStartInput,
  type ApplyRunStatus as ContractApplyRunStatus,
  type ApplyRunItemStatus as ContractApplyRunItemStatus,
} from "@is-browser/contract";
import { migrateDatabase } from "./migrations.js";

export type ApplyRunStatus = ContractApplyRunStatus;
export type ApplyRunItemStatus = ContractApplyRunItemStatus;

export type RunAuditStartInput = ContractRunAuditStartInput;

type RunAuditFinishInput = ContractRunAuditFinishInput;

export type RunAuditItemInput = ContractRunAuditItemInput;

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
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.finishStatement = db.prepare(
      `UPDATE apply_run
       SET status = ?, message = ?, finished_at = ?
       WHERE id = ?`,
    );
  }

  recordItem(input: RunAuditItemInput): void {
    const parsed = ApplyRunItemInputSchema.parse(input);
    this.insertItemStatement.run(
      this.runId,
      parsed.settingId ?? null,
      parsed.attempt,
      parsed.status,
      parsed.message,
      parsed.attemptedAt ?? new Date().toISOString(),
    );
  }

  finish(input: RunAuditFinishInput): void {
    const parsed = ApplyRunFinishInputSchema.parse(input);
    this.finishStatement.run(
      parsed.status,
      parsed.message ?? null,
      new Date().toISOString(),
      this.runId,
    );
  }

  close(): void {
    this.db.close();
  }
}

export async function startRunAudit(
  dbPath: string,
  input: RunAuditStartInput,
): Promise<RunAuditSession> {
  const parsedInput = ApplyRunStartInputSchema.parse(input);
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
     ) VALUES (?, ?, ?, ?, 'started', ?, ?)`,
  );

  const normalizedAccount = parsedInput.accountNumber.trim();
  const normalizedVariation = parsedInput.variation.trim();
  const startedAt = new Date().toISOString();

  const result = insertRunStatement.run(
    normalizedAccount,
    normalizedVariation,
    parsedInput.deviceIp,
    parsedInput.mapPath,
    "Run started",
    startedAt,
  );

  const runId = Number(result.lastInsertRowid);
  if (!Number.isInteger(runId) || runId <= 0) {
    db.close();
    throw new Error("Failed to create apply_run record.");
  }

  return new RunAuditSession(runId, db);
}
