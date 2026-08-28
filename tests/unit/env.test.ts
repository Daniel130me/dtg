import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getServerEnv } from "@/server/config/env";

const databaseUrl = "postgresql://user:password@localhost:5432/dtg";

describe("server environment", () => {
  it("parses safe defaults and comma-separated CORS origins", () => {
    const env = getServerEnv({
      DATABASE_URL: databaseUrl,
      CORS_ORIGINS: "https://dtg.test, https://admin.dtg.test",
    });

    assert.equal(env.PORT, 3000);
    assert.equal(env.DB_READINESS_TIMEOUT_MS, 10_000);
    assert.deepEqual(env.corsOrigins, new Set(["https://dtg.test", "https://admin.dtg.test"]));
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
});
