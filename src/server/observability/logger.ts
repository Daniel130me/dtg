import { getServerEnv } from "@/server/config/env";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKeyPattern = /authorization|cookie|password|secret|token|access.?key|database.?url/i;

function redact(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, key, seen));
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey, seen)]),
  );
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const configuredLevel = getServerEnv().LOG_LEVEL;
  if (levelPriority[level] < levelPriority[configuredLevel]) return;

  const safeContext = redact(context) as LogContext;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...safeContext,
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
