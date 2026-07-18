import {
  logger,
  initializeLogger,
  debug,
  info,
  warn,
  error,
} from "@rasla/logify";
import { getDbClient } from "@/shared/database/client";
import type postgres from "postgres";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function setupLogger(level: LogLevel = "info") {
  initializeLogger({
    level,
    console: true,
    file: false,
  });
}

export async function saveLog(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  err?: Error
): Promise<void> {
  try {
    const db = getDbClient();
    await db`
      INSERT INTO logs (level, message, service, context, error_name, error_message, error_stack)
      VALUES (
        ${level},
        ${message},
        'lazyscan-api',
        ${context ? db.json(context as postgres.JSONValue) : null},
        ${err?.name ?? null},
        ${err?.message ?? null},
        ${err?.stack ?? null}
      )
    `;
  } catch {
    // Silently fail
  }
}

export function logInfo(message: string, context?: Record<string, unknown>) {
  const msg = context ? `${message} ${JSON.stringify(context)}` : message;
  info(msg);
  saveLog("info", message, context);
}

export function logWarn(message: string, context?: Record<string, unknown>) {
  const msg = context ? `${message} ${JSON.stringify(context)}` : message;
  warn(msg);
  saveLog("warn", message, context);
}

export function logError(
  message: string,
  err?: Error,
  context?: Record<string, unknown>
) {
  const fullContext = err ? { ...context, error: err.message } : context;
  const msg = fullContext
    ? `${message} ${JSON.stringify(fullContext)}`
    : message;
  error(msg);
  saveLog("error", message, context, err);
}

export function logDebug(message: string, context?: Record<string, unknown>) {
  const msg = context ? `${message} ${JSON.stringify(context)}` : message;
  debug(msg);
  saveLog("debug", message, context);
}

export { logger, debug, info, warn, error };
