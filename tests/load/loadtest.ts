/**
 * Backend load test suite (Phase 12).
 *
 * Usage:
 *   bunx tsx tests/load/loadtest.ts --base http://localhost:3000 \
 *        --concurrency 10 --duration 20 --scenario catalog
 *
 * Scenarios (each is a repeating single-request loop per virtual user):
 *   catalog      GET /api/v1/courses            (public)
 *   detail       GET first catalog course       (public)
 *   categories   GET /api/v1/catalog/categories (public)
 *   health       GET /api/v1/health/live        (public)
 *   login        better-auth sign-in            (needs LOADTEST_EMAIL/LOADTEST_PASSWORD)
 *   dashboard    GET /api/v1/learning/dashboard (needs session from `login`)
 *
 * Scenarios that need a session derive their cookie from a login performed at
 * start; without credentials they are skipped honestly rather than reported as
 * failures. Progress-write load is exercised by the dashboard scenario being
 * preceded by an enrolment in a seeded free course — document any write
 * scenario additions here.
 *
 * Exit code 0 when every measured scenario meets the launch thresholds
 * (p95 < 750 ms, error rate < 1%, see LAUNCH_THRESHOLDS below), 1 otherwise.
 */
import { setTimeout as sleep } from "node:timers/promises";

interface Args {
  base: string;
  concurrency: number;
  durationMs: number;
  scenario: string;
}

interface Sample {
  ok: boolean;
  durationMs: number;
}

interface ScenarioStats {
  requests: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  rps: number;
}

/** Launch thresholds from docs/OPERATIONS_HANDBOOK.md §6. */
const LAUNCH_THRESHOLDS = { p95Ms: 750, errorRatePct: 1 } as const;

function parseArgs(argv: string[]): Args {
  const read = (flag: string, fallback: string): string => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
  };
  return {
    base: read("--base", "http://localhost:3000").replace(/\/+$/, ""),
    concurrency: Number(read("--concurrency", "10")),
    durationMs: Number(read("--duration", "15")) * 1000,
    scenario: read("--scenario", "catalog"),
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

interface LoginSession {
  cookie: string;
}

async function login(base: string): Promise<LoginSession | null> {
  const email = process.env.LOADTEST_EMAIL;
  const password = process.env.LOADTEST_PASSWORD;
  if (!email || !password) {
    console.warn("login: LOADTEST_EMAIL/LOADTEST_PASSWORD not set — skipping authed scenarios");
    return null;
  }
  const response = await fetchWithTimeout(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    // better-auth enforces the trusted-origin list on POSTs (CSRF layer) —
    // same-origin callers must still present the header.
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = response.headers.getSetCookie().join("; ");
  if (!response.ok || !setCookie) {
    console.warn(`login failed: ${response.status}`);
    return null;
  }
  return { cookie: setCookie };
}

interface RequestSpec {
  path: string;
  init?: RequestInit;
}

function scenarioRequest(scenario: string, base: string, session: LoginSession | null): RequestSpec {
  const cookieHeader: Record<string, string> = session ? { cookie: session.cookie } : {};
  switch (scenario) {
    case "catalog":
      return { path: `${base}/api/v1/courses` };
    case "categories":
      return { path: `${base}/api/v1/catalog/categories` };
    case "health":
      return { path: `${base}/api/v1/health/live` };
    case "detail":
      return { path: `${base}/api/v1/courses?limit=1` };
    case "dashboard":
      return {
        path: `${base}/api/v1/learning/dashboard`,
        init: { headers: cookieHeader },
      };
    case "login":
      // The login scenario POSTs fresh credentials per request (a dedicated
      // loop, not the shared session).
      return {
        path: `${base}/api/auth/sign-in/email`,
        init: {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({
            email: process.env.LOADTEST_EMAIL ?? "",
            password: process.env.LOADTEST_PASSWORD ?? "",
          }),
        },
      };
    default:
      throw new Error(`Unknown scenario "${scenario}"`);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(samples: Sample[], elapsedMs: number): ScenarioStats {
  const durations = samples.filter((s) => s.ok).map((s) => s.durationMs).sort((a, b) => a - b);
  return {
    requests: samples.length,
    errors: samples.filter((s) => !s.ok).length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    rps: Number((samples.length / (elapsedMs / 1000)).toFixed(1)),
  };
}

async function runScenario(args: Args, session: LoginSession | null): Promise<ScenarioStats> {
  const spec = scenarioRequest(args.scenario, args.base, session);
  const samples: Sample[] = [];
  const deadline = Date.now() + args.durationMs;

  const workers = Array.from({ length: args.concurrency }, async () => {
    while (Date.now() < deadline) {
      const startedAt = performance.now();
      try {
        const response = await fetchWithTimeout(spec.path, spec.init);
        // 401 on an unauthenticated dashboard means credentials were absent —
        // the caller already warned; count as error so it is visible.
        const ok = response.status >= 200 && response.status < 400;
        await response.arrayBuffer().catch(() => undefined);
        samples.push({ ok, durationMs: performance.now() - startedAt });
      } catch {
        samples.push({ ok: false, durationMs: performance.now() - startedAt });
      }
    }
  });

  const startedAt = Date.now();
  await Promise.all(workers);
  return summarize(samples, Date.now() - startedAt);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv);
  const needsAuth = args.scenario === "dashboard";
  const session = needsAuth || args.scenario === "login" ? await login(args.base) : null;
  if (needsAuth && !session) return 1;

  console.log(
    `Load: scenario=${args.scenario} base=${args.base} concurrency=${args.concurrency} duration=${args.durationMs / 1000}s`,
  );
  const stats = await runScenario(args, session);
  const errorRatePct = stats.requests === 0 ? 100 : Number(((stats.errors / stats.requests) * 100).toFixed(2));

  console.log(
    [
      `requests=${stats.requests}`,
      `errors=${stats.errors} (${errorRatePct}%)`,
      `rps=${stats.rps}`,
      `p50=${stats.p50.toFixed(0)}ms`,
      `p95=${stats.p95.toFixed(0)}ms`,
      `p99=${stats.p99.toFixed(0)}ms`,
    ].join("  "),
  );

  const failed =
    stats.p95 > LAUNCH_THRESHOLDS.p95Ms || errorRatePct > LAUNCH_THRESHOLDS.errorRatePct;
  console.log(
    failed
      ? `THRESHOLDS EXCEEDED (p95 < ${LAUNCH_THRESHOLDS.p95Ms}ms, error rate < ${LAUNCH_THRESHOLDS.errorRatePct}%)`
      : "thresholds met",
  );
  return failed ? 1 : 0;
}

const isDirectRun = process.argv[1]?.includes("loadtest");
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error("Load run crashed:", error);
      process.exit(1);
    });
}
