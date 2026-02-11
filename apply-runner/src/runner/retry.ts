export type FailureClassification = "transient" | "terminal";

export type ClassifiedFailure = {
  classification: FailureClassification;
  reason: string;
  message: string;
};

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function classifyApplyError(error: unknown): ClassifiedFailure {
  const message = normalizeMessage(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("selector resolution failed") ||
    normalized.includes("no field match") ||
    normalized.includes("not in allowed enum") ||
    normalized.includes("invalid switch value") ||
    normalized.includes("is not numeric") ||
    normalized.includes("below min") ||
    normalized.includes("above max") ||
    normalized.includes("read-only")
  ) {
    return { classification: "terminal", reason: "invalid-setting-state", message };
  }

  if (
    normalized.includes("missing page entry") ||
    normalized.includes("navigation target mismatch") ||
    normalized.includes("navigation step") ||
    normalized.includes("missing selector")
  ) {
    return { classification: "terminal", reason: "navigation-configuration", message };
  }

  if (normalized.includes("timeout")) {
    return { classification: "transient", reason: "timeout", message };
  }

  if (
    normalized.includes("target closed") ||
    normalized.includes("browser has been closed") ||
    normalized.includes("execution context was destroyed") ||
    normalized.includes("connection reset") ||
    normalized.includes("econnreset") ||
    normalized.includes("temporarily unavailable")
  ) {
    return { classification: "transient", reason: "runtime-instability", message };
  }

  return { classification: "terminal", reason: "unknown-terminal", message };
}

export function shouldRetryFailure(
  classified: ClassifiedFailure,
  attempt: number,
  maxAttempts: number
): boolean {
  return classified.classification === "transient" && attempt < maxAttempts;
}

