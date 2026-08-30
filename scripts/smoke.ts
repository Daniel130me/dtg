/**
 * Production smoke test / post-deployment verification.
 *
 * Usage:
 *   bunx tsx scripts/smoke.ts [baseUrl]
 *   APP_URL=https://dtg.example bunx tsx scripts/smoke.ts
 *
 * Cookie-free, read-only, idempotent: safe to run against production right
 * after a deploy or a restore (docs/RECOVERY_RUNBOOK.md step 4.1.6). Exit code
 * 0 = all checks passed; 1 = at least one check failed (details printed).
 */
import { getServerEnv } from "@/server/config/env";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ok ? "" : `— ${detail}`}`);
}

async function checkJson(
  name: string,
  url: string,
  expectStatus: number,
  expectDataKey?: string,
): Promise<void> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "dtg-smoke/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== expectStatus) {
      record(name, false, `status ${response.status} (expected ${expectStatus})`);
      return;
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (expectDataKey && !(expectDataKey in body)) {
      record(name, false, `response JSON missing "${expectDataKey}" key`);
      return;
    }
    record(name, true, response.status.toString());
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

async function main(): Promise<number> {
  const argBaseUrl = process.argv[2];
  let baseUrl = argBaseUrl ?? "http://localhost:3000";
  if (!argBaseUrl) {
    try {
      baseUrl = getServerEnv().APP_URL;
    } catch {
      // .env missing in the calling shell is fine for a smoke run.
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, "");
  const api = `${baseUrl}/api/v1`;

  console.log(`Smoke checking ${baseUrl}\n`);

  await checkJson("health/live", `${api}/health/live`, 200, "data");
  await checkJson("health/ready", `${api}/health/ready`, 200, "data");
  await checkJson("course catalog list", `${api}/courses`, 200, "data");
  await checkJson("category list", `${api}/catalog/categories`, 200, "data");
  await checkJson("OpenAPI document", `${api}/openapi.json`, 200, "openapi");

  // Auth guards: unauthenticated callers must receive the stable 401 envelope.
  await checkJson("auth/me requires session", `${api}/auth/me`, 401);
  await checkJson("account/profile requires session", `${api}/account/profile`, 401);
  await checkJson("metrics is owner-gated", `${api}/metrics`, 401);
  await checkJson("health diagnostics is owner-gated", `${api}/health/diagnostics`, 401);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("Smoke run crashed:", error);
    process.exit(1);
  });
