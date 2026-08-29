import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const applicationDatabaseUrl = process.env.DATABASE_URL;

function databaseIdentity(value: string): string {
  const url = new URL(value);
  const endpoint = url.hostname.replace("-pooler.", ".");
  const schema = url.searchParams.get("schema") ?? "public";
  return `${url.username}@${endpoint}${url.pathname}?schema=${schema}`;
}

describe("database integration", { skip: !testDatabaseUrl }, () => {
  let database: typeof import("@/server/db/client").db;

  before(async () => {
    if (
      applicationDatabaseUrl &&
      databaseIdentity(applicationDatabaseUrl) === databaseIdentity(testDatabaseUrl!)
    ) {
      throw new Error("TEST_DATABASE_URL must use an isolated database or Neon branch.");
    }

    Object.assign(process.env, {
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
    });
    ({ db: database } = await import("@/server/db/client"));
  });

  after(async () => {
    await database?.$disconnect();
  });

  it("can execute a bounded readiness query", async () => {
    const { withDatabaseConnectionRetry } = await import("@/server/db/retry");
    assert.deepEqual(
      await withDatabaseConnectionRetry(() => database.$queryRaw`SELECT 1 AS value`),
      [{ value: 1 }],
    );
  });

  it("has the database-backed authentication tables and indexes", async () => {
    const rows = await database.$queryRaw<Array<{ relation: string | null }>>`
      SELECT to_regclass('public."Session"')::text AS relation
      UNION ALL
      SELECT to_regclass('public."Verification"')::text AS relation
    `;
    assert.deepEqual(rows.map((row) => row.relation), ['"Session"', '"Verification"']);
  });
});
