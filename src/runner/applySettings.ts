import { openBrowser, newPage } from "../mcp/browser.js";
import {
  NAV_TIMEOUT_MS,
  PRINTER_URL,
  PROFILE_DB_PATH,
  REMOTE_PANEL_URL
} from "../config/env.js";
import { readMap } from "../schema/io.js";
import { type FieldEntry, type UiMap } from "../schema/types.js";
import { isLoginPage, login } from "../crawler/login.js";
import { mkdir } from "node:fs/promises";
import { appendDeviceReport, type DeviceLogContext, type LogEntry, writeDeviceLog } from "./logging.js";
import { type SettingsFile } from "./settings.js";
import { runRemotePanel } from "./remotePanel.js";
import {
  applyFieldValue,
  buildPageCommitActionMap,
  executePageNavigation,
  resolveLocatorByPriority
} from "./engine.js";
import { classifyApplyError, shouldRetryFailure } from "./retry.js";
import { startRunAudit } from "../db/runAudit.js";

const MAX_SETTING_ATTEMPTS = 3;
const MAX_COMMIT_ATTEMPTS = 3;

type BrowserLike = Awaited<ReturnType<typeof openBrowser>>;
type PageLike = Awaited<ReturnType<typeof newPage>>;

export type ApplyRuntime = {
  readMap: typeof readMap;
  openBrowser: typeof openBrowser;
  newPage: typeof newPage;
  isLoginPage: typeof isLoginPage;
  login: typeof login;
  runRemotePanel: typeof runRemotePanel;
  startRunAudit: typeof startRunAudit;
  writeDeviceLog: typeof writeDeviceLog;
  appendDeviceReport: typeof appendDeviceReport;
};

type ApplyOptions = {
  deviceIp: string;
  settings: SettingsFile;
  mapPath: string;
  auditDbPath?: string;
  headless?: boolean;
  consoleVisible?: boolean;
  deviceLogMode: "all-time" | "daily";
  onRetryPrompt?: (error: unknown, attempt: number) => Promise<boolean>;
  onConsole?: (line: string) => void;
  runtime?: Partial<ApplyRuntime>;
};

type RunItemStatus = "ok" | "error" | "skipped";

function buildDeviceUrl(ip: string): string {
  const protocol = PRINTER_URL.startsWith("https") ? "https" : "http";
  return `${protocol}://${ip}`;
}

function toErrorString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function finalRunStatus(
  hasFatalError: boolean,
  successCount: number,
  errorCount: number
): "completed" | "partial" | "failed" {
  if (hasFatalError) {
    return successCount > 0 ? "partial" : "failed";
  }
  if (errorCount > 0) {
    return "partial";
  }
  return "completed";
}

async function findField(
  map: UiMap,
  setting: { id?: string; label?: string }
): Promise<FieldEntry | undefined> {
  if (setting.id) {
    const exact = map.fields.find((field) => field.id === setting.id);
    if (exact) return exact;
  }
  if (setting.label) {
    const labelLower = setting.label.toLowerCase();
    return map.fields.find((field) => (field.label ?? "").toLowerCase() === labelLower);
  }
  return undefined;
}

async function navigateToSettingPage(
  page: import("playwright").Page,
  map: UiMap,
  field: FieldEntry,
  baseUrl: string
): Promise<void> {
  const pageEntry = map.pages.find((entry) => entry.id === field.pageId);
  if (!pageEntry) {
    throw new Error(`Missing page entry for ${field.pageId}`);
  }
  await executePageNavigation(page, pageEntry, baseUrl);
}

async function applySettingValue(
  page: import("playwright").Page,
  field: FieldEntry,
  value: unknown
): Promise<void> {
  if (field.constraints?.readOnly) {
    return;
  }

  if (field.constraints?.enum && field.constraints.enum.length > 0) {
    const allowed = field.constraints.enum;
    if (!allowed.includes(String(value))) {
      throw new Error(`Value "${value}" not in allowed enum for ${field.id}`);
    }
  }

  if (field.type === "number" && field.constraints) {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      throw new Error(`Value "${value}" is not numeric for ${field.id}`);
    }
    if (field.constraints.min !== undefined && numeric < field.constraints.min) {
      throw new Error(`Value ${numeric} below min for ${field.id}`);
    }
    if (field.constraints.max !== undefined && numeric > field.constraints.max) {
      throw new Error(`Value ${numeric} above max for ${field.id}`);
    }
  }

  const resolved = await resolveLocatorByPriority(
    page,
    field.selectors,
    `setting "${field.id}" on page "${field.pageId}"`
  );
  await applyFieldValue(page, resolved.locator, field, value);
}

export async function applySettings(
  options: ApplyOptions
): Promise<{ status: "COMPLETED" | "FAILED"; logPath: string }> {
  const runtime: ApplyRuntime = {
    readMap,
    openBrowser,
    newPage,
    isLoginPage,
    login,
    runRemotePanel,
    startRunAudit,
    writeDeviceLog,
    appendDeviceReport,
    ...options.runtime
  };

  const map = await runtime.readMap(options.mapPath);
  const baseUrl = buildDeviceUrl(options.deviceIp);
  await mkdir("artifacts", { recursive: true });
  const logEntries: LogEntry[] = [];
  const pageCommitActions = buildPageCommitActionMap(map.fields);

  const runAudit = await runtime.startRunAudit(options.auditDbPath ?? PROFILE_DB_PATH, {
    accountNumber: options.settings.meta?.accountNumber ?? "unknown",
    variation: options.settings.meta?.variation ?? "default",
    deviceIp: options.deviceIp,
    mapPath: options.mapPath
  });

  let successRunItems = 0;
  let errorRunItems = 0;
  const recordRunItem = (item: {
    settingId?: string;
    attempt: number;
    status: RunItemStatus;
    message: string;
  }) => {
    runAudit.recordItem(item);
    if (item.status === "ok") {
      successRunItems += 1;
    } else if (item.status === "error") {
      errorRunItems += 1;
    }
  };

  const log = (entry: LogEntry) => {
    logEntries.push(entry);
    const line = `${entry.timestamp} ${entry.status.toUpperCase()} ${entry.step} ${entry.message}`;
    if (options.consoleVisible !== false) {
      console.log(line);
    }
    options.onConsole?.(line);
  };

  const context: DeviceLogContext = {
    customerName: options.settings.meta?.customerName ?? "unknown",
    accountNumber: options.settings.meta?.accountNumber ?? "unknown",
    serial: options.settings.meta?.serial ?? "unknown",
    model: options.settings.meta?.model ?? "unknown",
    productCode: options.settings.meta?.productCode,
    rawSerialCombined: options.settings.meta?.rawSerialCombined,
    deviceIp: options.deviceIp,
    scriptApplied: options.settings.meta?.scriptVariant ?? "default",
    scriptLocation: options.mapPath
  };

  let browser: BrowserLike | null = null;
  let page: PageLike | null = null;
  let fatalError: unknown = null;

  let activePageId: string | null = null;
  let activePageLastFieldId: string | undefined;
  let activePageHasPendingChanges = false;

  const commitActivePageIfNeeded = async (): Promise<void> => {
    if (!page) {
      throw new Error("Browser page is unavailable for page commit.");
    }
    if (!activePageId || !activePageHasPendingChanges) {
      return;
    }

    const action = pageCommitActions.get(activePageId);
    if (!action) {
      activePageHasPendingChanges = false;
      return;
    }

    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
      try {
        const resolvedAction = await resolveLocatorByPriority(
          page,
          [action.selector],
          `page commit for "${activePageId}" via "${action.label ?? "unnamed"}"`
        );
        await resolvedAction.locator.click();
        await page.waitForLoadState("networkidle");

        const successMessage = `Committed page ${activePageId} via ${action.label ?? "action"}`;
        log({
          timestamp: new Date().toISOString(),
          step: "commit",
          status: "ok",
          fieldId: activePageLastFieldId,
          message: successMessage
        });
        recordRunItem({
          settingId: activePageLastFieldId,
          attempt,
          status: "ok",
          message: successMessage
        });
        activePageHasPendingChanges = false;
        return;
      } catch (error) {
        const classified = classifyApplyError(error);
        const failMessage = [
          `Page commit failed for ${activePageId}`,
          `classification=${classified.classification}`,
          `reason=${classified.reason}`,
          `attempt=${attempt}`,
          `error=${classified.message}`
        ].join(" | ");
        log({
          timestamp: new Date().toISOString(),
          step: "commit",
          status: "error",
          fieldId: activePageLastFieldId,
          message: failMessage,
          error: toErrorString(error)
        });
        recordRunItem({
          settingId: activePageLastFieldId,
          attempt,
          status: "error",
          message: failMessage
        });

        if (!shouldRetryFailure(classified, attempt, MAX_COMMIT_ATTEMPTS)) {
          throw new Error(failMessage);
        }

        if (options.onRetryPrompt) {
          const shouldRetry = await options.onRetryPrompt(error, attempt);
          if (!shouldRetry) {
            throw new Error(`Retry cancelled during page commit for ${activePageId}`);
          }
        }
      }
    }
  };

  try {
    browser = await runtime.openBrowser({ headless: options.headless });
    page = await runtime.newPage(browser);
    if (!page) {
      throw new Error("Failed to initialize browser page.");
    }

    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    if (await runtime.isLoginPage(page)) {
      await runtime.login(page);
    }

    for (const setting of options.settings.settings) {
      const field = await findField(map, setting);
      if (!field) {
        const message = `No field match for setting ${setting.id ?? setting.label ?? "unknown"}`;
        log({
          timestamp: new Date().toISOString(),
          step: "map",
          status: "error",
          message
        });
        recordRunItem({
          settingId: setting.id,
          attempt: 1,
          status: "error",
          message
        });
        continue;
      }

      if (activePageId && activePageId !== field.pageId) {
        await commitActivePageIfNeeded();
      }

      activePageId = field.pageId;
      activePageLastFieldId = field.id;

      for (let attempt = 1; attempt <= MAX_SETTING_ATTEMPTS; attempt += 1) {
        try {
          await navigateToSettingPage(page, map, field, baseUrl);
          await applySettingValue(page, field, setting.value);

          const successMessage = `Applied ${field.id}`;
          log({
            timestamp: new Date().toISOString(),
            step: "apply",
            status: "ok",
            fieldId: field.id,
            message: successMessage
          });
          recordRunItem({
            settingId: field.id,
            attempt,
            status: "ok",
            message: successMessage
          });
          activePageHasPendingChanges = true;
          break;
        } catch (error) {
          const classified = classifyApplyError(error);
          const failMessage = [
            `Failed to apply ${field.id}`,
            `classification=${classified.classification}`,
            `reason=${classified.reason}`,
            `attempt=${attempt}`,
            `error=${classified.message}`
          ].join(" | ");
          log({
            timestamp: new Date().toISOString(),
            step: "apply",
            status: "error",
            fieldId: field.id,
            message: failMessage,
            error: toErrorString(error)
          });
          recordRunItem({
            settingId: field.id,
            attempt,
            status: "error",
            message: failMessage
          });

          if (!shouldRetryFailure(classified, attempt, MAX_SETTING_ATTEMPTS)) {
            throw new Error(failMessage);
          }

          if (options.onRetryPrompt) {
            const shouldRetry = await options.onRetryPrompt(error, attempt);
            if (!shouldRetry) {
              throw new Error(`Retry cancelled while applying ${field.id}`);
            }
          }
        }
      }
    }

    await commitActivePageIfNeeded();

    if (options.settings.remotePanel) {
      const panelUrl = REMOTE_PANEL_URL || baseUrl;
      await runtime.runRemotePanel(page, panelUrl, options.settings.remotePanel);
      log({
        timestamp: new Date().toISOString(),
        step: "remote-panel",
        status: "ok",
        message: "Remote panel actions completed"
      });
    }
  } catch (error) {
    fatalError = error;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    if (page) {
      await page.screenshot({ path: `artifacts/apply-error-${ts}.png`, fullPage: true }).catch(() => null);
    }
    log({
      timestamp: new Date().toISOString(),
      step: "run",
      status: "error",
      message: "Run failed",
      error: toErrorString(error)
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const runStatus = finalRunStatus(fatalError !== null, successRunItems, errorRunItems);
  const deviceStatus: "COMPLETED" | "FAILED" = runStatus === "completed" ? "COMPLETED" : "FAILED";
  const runMessage = fatalError
    ? `Run ended with fatal error: ${toErrorString(fatalError)}`
    : runStatus === "partial"
      ? "Run completed with partial failures."
      : "Run completed.";
  runAudit.finish({
    status: runStatus,
    message: runMessage
  });
  runAudit.close();

  const logPath = await runtime.writeDeviceLog(context, logEntries, deviceStatus);
  await runtime.appendDeviceReport(context, deviceStatus, options.deviceLogMode);
  return { status: deviceStatus, logPath };
}
