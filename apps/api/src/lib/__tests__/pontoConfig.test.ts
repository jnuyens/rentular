import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPontoAppConfig } from "../pontoConnect";

const SAVE = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(process.env))
    if (k.startsWith("PONTO_")) delete process.env[k];
});
afterEach(() => {
  process.env = { ...SAVE };
});

describe("getPontoAppConfig", () => {
  it("uses model-specific vars when present", () => {
    process.env.PONTO_PPM_CLIENT_ID = "ppm-id";
    process.env.PONTO_PPM_CLIENT_SECRET = "ppm-secret";
    process.env.PONTO_PPM_TLS_CERT = "/certs/ppm.pem";
    process.env.PONTO_PPM_TLS_KEY = "/certs/ppm.key";
    process.env.PONTO_PPM_SIG_KEY = "-----BEGIN PRIVATE KEY-----ppm";
    process.env.PONTO_PPM_SIG_KEY_ID = "ppm-uuid";
    const cfg = getPontoAppConfig("ppm");
    expect(cfg.clientId).toBe("ppm-id");
    expect(cfg.transport.cert).toBe("/certs/ppm.pem");
    expect(cfg.signature?.keyId).toBe("ppm-uuid");
  });

  it("falls back to legacy single-app vars (sandbox)", () => {
    process.env.PONTO_CLIENT_ID = "legacy-id";
    process.env.PONTO_CLIENT_SECRET = "legacy-secret";
    process.env.PONTO_TLS_PFX = "/certs/legacy.pfx";
    const cfg = getPontoAppConfig("cpm");
    expect(cfg.clientId).toBe("legacy-id");
    expect(cfg.transport.pfx).toBe("/certs/legacy.pfx");
    expect(cfg.signature).toBeUndefined();
  });
});
