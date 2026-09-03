import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getServerEnv } from "@/server/config/env";

const databaseUrl = "postgresql://user:password@localhost:5432/dtg";

describe("server environment", () => {
  it("parses safe defaults and comma-separated CORS origins", () => {
    const env = getServerEnv({
      DATABASE_URL: databaseUrl,
      APP_URL: "https://dtg.test/",
      CORS_ORIGINS: "https://dtg.test/, https://admin.dtg.test/settings",
    });

    assert.equal(env.PORT, 3000);
    assert.equal(env.DB_READINESS_TIMEOUT_MS, 10_000);
    assert.equal(env.TRUSTED_PROXY_PROVIDER, undefined);
    assert.deepEqual(env.corsOrigins, new Set(["https://dtg.test", "https://admin.dtg.test"]));
  });

  it("rejects invalid and non-HTTP CORS origins", () => {
    assert.throws(
      () => getServerEnv({ DATABASE_URL: databaseUrl, CORS_ORIGINS: "not-a-url" }),
      /invalid HTTP\(S\) origin/,
    );
    assert.throws(
      () => getServerEnv({ DATABASE_URL: databaseUrl, CORS_ORIGINS: "javascript:alert(1)" }),
      /invalid HTTP\(S\) origin/,
    );
  });

  it("accepts only the supported trusted proxy providers", () => {
    assert.equal(
      getServerEnv({ DATABASE_URL: databaseUrl, TRUSTED_PROXY_PROVIDER: "cloud-run" }).TRUSTED_PROXY_PROVIDER,
      "cloud-run",
    );
    assert.equal(
      getServerEnv({ DATABASE_URL: databaseUrl, TRUSTED_PROXY_PROVIDER: "render" }).TRUSTED_PROXY_PROVIDER,
      "render",
    );
    assert.throws(() =>
      getServerEnv({ DATABASE_URL: databaseUrl, TRUSTED_PROXY_PROVIDER: "untrusted-proxy" }),
    );
  });

  it("rejects non-PostgreSQL database URLs", () => {
    assert.throws(
      () => getServerEnv({ DATABASE_URL: "file:./unsafe.db" }),
      /must be a PostgreSQL connection URL/,
    );
  });

  it("requires a non-default rate-limit salt in production", () => {
    assert.throws(
      () => getServerEnv({ NODE_ENV: "production", DATABASE_URL: databaseUrl }),
      /RATE_LIMIT_SALT/,
    );
  });

  it("requires a non-default authentication secret in production", () => {
    assert.throws(
      () => getServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: databaseUrl,
        RATE_LIMIT_SALT: "this-is-a-valid-production-rate-limit-salt",
      }),
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects partial SMTP configuration", () => {
    assert.throws(
      () => getServerEnv({ DATABASE_URL: databaseUrl, SMTP_HOST: "smtp.example.test" }),
      /must be configured together/,
    );
  });

  it("normalizes a valid owner email and rejects malformed values", () => {
    const env = getServerEnv({
      DATABASE_URL: databaseUrl,
      OWNER_EMAIL: "Owner@Example.COM",
    });
    assert.equal(env.OWNER_EMAIL, "owner@example.com");

    assert.throws(
      () => getServerEnv({ DATABASE_URL: databaseUrl, OWNER_EMAIL: "not-an-email" }),
      /OWNER_EMAIL/,
    );
  });

  it("rejects partial Flutterwave configuration", () => {
    assert.throws(
      () => getServerEnv({ DATABASE_URL: databaseUrl, FLUTTERWAVE_SECRET_KEY: "FLWSECK-test" }),
      /FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_HASH must be configured together/,
    );
    assert.throws(
      () => getServerEnv({ DATABASE_URL: databaseUrl, FLUTTERWAVE_WEBHOOK_HASH: "whsec" }),
      /must be configured together/,
    );
  });

  it("accepts a complete Flutterwave configuration", () => {
    const env = getServerEnv({
      DATABASE_URL: databaseUrl,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK-test",
      FLUTTERWAVE_WEBHOOK_HASH: "whsec-test",
    });
    assert.equal(env.FLUTTERWAVE_SECRET_KEY, "FLWSECK-test");
    assert.equal(env.FLUTTERWAVE_WEBHOOK_HASH, "whsec-test");
  });

  it("distinguishes the R2 S3 API endpoint from public delivery", () => {
    const env = getServerEnv({
      DATABASE_URL: databaseUrl,
      R2_S3_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      R2_PUBLIC_BASE_URL: "https://media.example.test",
    });
    assert.equal(env.R2_S3_ENDPOINT, "https://account.r2.cloudflarestorage.com");
    assert.equal(env.R2_PUBLIC_BASE_URL, "https://media.example.test");

    assert.throws(
      () =>
        getServerEnv({
          DATABASE_URL: databaseUrl,
          R2_S3_ENDPOINT: "https://media.example.test",
        }),
      /R2 S3 API endpoint/,
    );
  });
});
