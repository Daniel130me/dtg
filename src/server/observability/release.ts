import packageJson from "../../../package.json";

// ---------------------------------------------------------------------------
// Release identity for error/metric enrichment.
//
// Pure and unit-testable BY DESIGN: this module deliberately reads process.env
// directly instead of going through config/env.ts, so test files (and the
// error monitor) never pull the validated-server-env dependency chain — the
// sandbox/test DATABASE_URL would fail env validation and throw inside every
// log write.
//
// RELEASE_ID is declared in config/env.ts as the operator-facing knob; here it
// is read once from the process environment and cached, falling back to the
// Render's immutable commit SHA and then package.json, so every deployment has
// a stable release identifier without requiring another copied secret.
// ---------------------------------------------------------------------------

export interface ReleaseInfo {
  releaseId: string;
  environment: string;
  nodeVersion: string;
  /** Monotonic process-start approximation: the instant this module loaded. */
  startedAtMs: number;
  uptimeSeconds: number;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

const MODULE_STARTED_AT_MS = Date.now();
let cachedReleaseId: string | undefined;

function resolveReleaseId(env: EnvSource): string {
  const explicit = env.RELEASE_ID?.trim();
  const renderCommit = env.RENDER_GIT_COMMIT?.trim();
  return explicit || renderCommit || packageJson.version;
}

/**
 * Returns the release identity. Without options the result is cached for the
 * process lifetime (release ids never change mid-process). Passing `env`
 * (tests / per-call override) bypasses the cache without polluting it, and
 * `now` makes uptime deterministic in tests.
 */
export function getReleaseInfo(options?: { env?: EnvSource; now?: number }): ReleaseInfo {
  const env = options?.env ?? process.env;
  const now = options?.now ?? Date.now();
  const releaseId = options?.env ? resolveReleaseId(env) : (cachedReleaseId ??= resolveReleaseId(env));

  return {
    releaseId,
    environment: env.NODE_ENV ?? "development",
    nodeVersion: process.version,
    startedAtMs: MODULE_STARTED_AT_MS,
    uptimeSeconds: Math.max(0, (now - MODULE_STARTED_AT_MS) / 1000),
  };
}
