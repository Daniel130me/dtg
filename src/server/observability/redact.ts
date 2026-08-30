// Shared log-value redaction. Extracted from logger.ts so the error monitor
// applies the EXACT same key-pattern redaction to captured errors (one
// pattern, one place). The pattern covers the classic header/credential leak
// surfaces: authorization, cookies, passwords, secrets, tokens, access keys
// and database URLs.
const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|secret|token|access.?key|database.?url/i;

/**
 * Deeply redacts any values whose object key matches SENSITIVE_KEY_PATTERN.
 * Errors are reduced to {name, message, stack}; circular references become
 * "[CIRCULAR]". Exported for logger.ts (byte-identical behaviour) and the
 * error monitor.
 */
export function redactLogValue(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, key, seen));
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryValue, entryKey, seen)]),
  );
}

/** Test/inspection seam: does a key name trip the redaction pattern? */
export function isSensitiveLogKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}
