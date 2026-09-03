import packageJson from "../../package.json";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReleaseInfo } from "@/server/observability/release";

describe("release info", () => {
  it("falls back to the package version when RELEASE_ID is unset", () => {
    const info = getReleaseInfo({ env: { NODE_ENV: "test" } });
    assert.equal(info.releaseId, packageJson.version);
    assert.equal(info.environment, "test");
  });

  it("prefers an explicit RELEASE_ID and trims it", () => {
    const info = getReleaseInfo({ env: { RELEASE_ID: "  deploy-2026-01-01.7  ", NODE_ENV: "production" } });
    assert.equal(info.releaseId, "deploy-2026-01-01.7");
    assert.equal(info.environment, "production");
  });

  it("uses Render's commit SHA when an explicit release id is unset", () => {
    const info = getReleaseInfo({ env: { RENDER_GIT_COMMIT: "  abc123def  ", NODE_ENV: "production" } });
    assert.equal(info.releaseId, "abc123def");
  });

  it("defaults the environment to development when NODE_ENV is absent", () => {
    assert.equal(getReleaseInfo({ env: {} }).environment, "development");
  });

  it("reports the node version and deterministic uptime", () => {
    const startedAtMs = getReleaseInfo({ env: { NODE_ENV: "test" } }).startedAtMs;
    const now = startedAtMs + 12_345;
    const info = getReleaseInfo({ env: { NODE_ENV: "test" }, now });
    assert.equal(info.nodeVersion, process.version);
    assert.equal(info.startedAtMs, startedAtMs);
    assert.equal(info.uptimeSeconds, 12.345);
  });

  it("clamps negative uptime to zero (clock skew)", () => {
    assert.equal(getReleaseInfo({ env: {}, now: 0 }).uptimeSeconds, 0);
  });

  it("caches the process-level release id but honours per-call overrides", () => {
    const cached = getReleaseInfo();
    assert.equal(cached.releaseId, packageJson.version);
    // An injected env source must not overwrite the process-level cache.
    assert.equal(getReleaseInfo({ env: { RELEASE_ID: "override" } }).releaseId, "override");
    assert.equal(getReleaseInfo().releaseId, cached.releaseId);
  });
});
