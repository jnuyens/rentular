/**
 * Public version endpoint used by the Android app before login.
 *
 * Besides the response shape, this pins two release rules that are easy to get
 * wrong by hand: REQUIRED_APP_VERSION must equal the Android versionCode, and the
 * route must stay public (mounted, but not behind requireAuth).
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RENTULAR_VERSION, REQUIRED_APP_VERSION } from "@rentular/shared";
import { appVersionRouter } from "../appVersion";

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/__tests__ -> repo root
const repoRoot = resolve(here, "../../../../..");

function buildApp() {
  const app = new Hono();
  app.route("/app", appVersionRouter);
  return app;
}

describe("GET /app/version", () => {
  it("returns the shared version constants without any credentials", async () => {
    const res = await buildApp().request("/app/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      serverVersion: RENTULAR_VERSION,
      requiredAppVersion: REQUIRED_APP_VERSION,
      latestServerVersion: RENTULAR_VERSION,
    });
  });

  it("is cacheable for a minute", async () => {
    const res = await buildApp().request("/app/version");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("uses an integer app version and a semver server version", async () => {
    const res = await buildApp().request("/app/version");
    const body = (await res.json()) as { requiredAppVersion: unknown; serverVersion: unknown };
    expect(typeof body.requiredAppVersion).toBe("number");
    expect(Number.isInteger(body.requiredAppVersion)).toBe(true);
    expect(String(body.serverVersion)).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("release rules", () => {
  it("REQUIRED_APP_VERSION equals versionCode in android-app/app/build.gradle.kts", () => {
    const gradle = readFileSync(resolve(repoRoot, "android-app/app/build.gradle.kts"), "utf8");
    const match = gradle.match(/versionCode\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(REQUIRED_APP_VERSION);
  });

  it("index.ts mounts the router at /app and keeps it out of protectedPrefixes", () => {
    const source = readFileSync(resolve(repoRoot, "apps/api/src/index.ts"), "utf8");
    expect(source).toContain('app.route("/app", appVersionRouter)');
    const prefixes = source.match(/const protectedPrefixes = \[([\s\S]*?)\];/);
    expect(prefixes).not.toBeNull();
    expect(prefixes![1]).not.toMatch(/["']\/app["']/);
  });
});
