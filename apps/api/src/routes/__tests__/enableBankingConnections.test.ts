/**
 * Enable Banking routes: the callback only accepts a valid state bound to the
 * landlord, and the private key never comes back out of the API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const PEM = "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----";

let reads: unknown[][] = [];
const updates: Array<Record<string, unknown>> = [];

function chain(): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        const r = Promise.resolve(reads.length ? reads.shift() : []);
        return r.then.bind(r);
      }
      if (prop === "set") {
        return (v: Record<string, unknown>) => {
          updates.push(v);
          return { where: async () => [] };
        };
      }
      return () => chain();
    },
  });
}

vi.mock("@rentular/db", () => ({
  getDb: () => ({
    select: () => chain(),
    update: () => chain(),
    insert: () => ({ values: async () => [] }),
    delete: () => chain(),
  }),
  bankConnections: { id: "id", ownerId: "owner_id", provider: "provider", status: "status" },
  enableBankingApps: { ownerId: "owner_id", id: "id" },
  users: { id: "id", plan: "plan" },
  properties: { ownerId: "owner_id", isArchived: "is_archived" },
  bankStatements: {},
}));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return { ...actual, eq: vi.fn(() => "EQ"), and: vi.fn(() => "AND"), ne: vi.fn(() => "NE") };
});

vi.mock("../../lib/encryption", () => ({
  encrypt: vi.fn(() => ({ encrypted: "CIPHERTEXT", iv: "IV", tag: "TAG" })),
  decrypt: vi.fn(() => PEM),
}));

const verifyOAuthState = vi.fn();
vi.mock("../../lib/bankOAuthState", () => ({
  signOAuthState: vi.fn(async () => "signed-state"),
  verifyOAuthState: (...a: unknown[]) => verifyOAuthState(...a),
}));

const createSession = vi.fn();
vi.mock("../../lib/enableBanking", async () => {
  const actual = await vi.importActual<typeof import("../../lib/enableBanking")>("../../lib/enableBanking");
  class FakeClient {
    listAspsps = vi.fn(async () => [{ name: "KBC", country: "BE" }]);
    createSession = (...a: unknown[]) => createSession(...a);
    deleteSession = vi.fn(async () => undefined);
  }
  return { ...actual, EnableBankingClient: FakeClient };
});

vi.mock("../../lib/enableBankingApps", async () => {
  const actual = await vi.importActual<typeof import("../../lib/enableBankingApps")>(
    "../../lib/enableBankingApps",
  );
  return {
    ...actual,
    saveEnableBankingApp: vi.fn(async () => undefined),
    recordEnableBankingVerification: vi.fn(async () => undefined),
    loadEnableBankingCredentials: vi.fn(async () => ({ applicationId: "app-12345678", privateKeyPem: PEM })),
    loadBankProviderOptions: vi.fn(async () => ({
      instance: "self",
      plan: "free",
      providers: ["enable_banking"],
      defaultProvider: "enable_banking",
      notices: [],
    })),
  };
});

vi.mock("../../services/bankConnectionSync", () => ({ syncBankConnection: vi.fn(async () => ({})) }));
vi.mock("../../services/enableBankingSync", () => ({
  readMetadata: (raw: unknown) => (raw as Record<string, unknown>) || {},
}));

const { enableBankingRouter } = await import("../enableBankingConnections");

function makeApp(userId: string | null = "owner-1") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId" as never, userId as never);
    await next();
  });
  app.route("/eb", enableBankingRouter);
  return app;
}

const storedRow = {
  id: "app-row",
  ownerId: "owner-1",
  applicationId: "app-12345678",
  privateKeyEncrypted: "CIPHERTEXT",
  privateKeyIv: "IV",
  privateKeyAuthTag: "TAG",
  environment: "production",
  createdAt: new Date("2026-11-01T10:00:00Z"),
  updatedAt: new Date("2026-11-01T10:00:00Z"),
  lastVerifiedAt: new Date("2026-11-01T10:01:00Z"),
  lastError: null,
};

beforeEach(() => {
  reads = [];
  updates.length = 0;
  verifyOAuthState.mockReset();
  createSession.mockReset();
  process.env.WEB_URL = "https://web.test";
});

describe("the private key never leaves the API", () => {
  it("GET /app returns only the status", async () => {
    reads = [[storedRow]];
    const res = await makeApp().request("/eb/app");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRETKEYMATERIAL");
    expect(text).not.toContain("CIPHERTEXT");
    expect(text).not.toMatch(/privateKey/i);
    const body = JSON.parse(text);
    expect(body.data).toMatchObject({
      configured: true,
      source: "account",
      applicationId: "app-12345678",
      keyUploadedAt: "2026-11-01T10:00:00.000Z",
    });
    expect(body.data.redirectUrl).toContain("/bank-connections/enable-banking/callback");
  });

  it("PUT /app answers with status and verification, not the key", async () => {
    reads = [[storedRow]];
    const res = await makeApp().request("/eb/app", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationId: "app-12345678",
        privateKeyPem: PEM + "\n" + "x".repeat(100),
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRETKEYMATERIAL");
    expect(text).not.toContain("CIPHERTEXT");
    expect(JSON.parse(text).data.verification).toEqual({ ok: true, banks: 1 });
  });
});

describe("callback", () => {
  it("rejects a tampered or expired state", async () => {
    verifyOAuthState.mockRejectedValueOnce(new Error("signature verification failed"));
    const res = await makeApp(null).request("/eb/callback?code=abc&state=forged");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://web.test/bank-connections/callback?error=expired_state&provider=enable_banking");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a state made for another provider", async () => {
    verifyOAuthState.mockResolvedValueOnce({ ownerId: "owner-1", connectionId: "c1", provider: "ponto", nonce: "n" });
    const res = await makeApp(null).request("/eb/callback?code=abc&state=ponto-state");
    expect(res.headers.get("location")).toContain("error=expired_state");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("sends an empty session back with the provider, so the web page can point to step 5", async () => {
    verifyOAuthState.mockResolvedValueOnce({
      ownerId: "owner-1",
      connectionId: "c1",
      provider: "enable_banking",
      nonce: "n",
    });
    reads = [[{ id: "c1", ownerId: "owner-1", status: "pending", provider: "enable_banking", providerMetadata: {} }]];
    createSession.mockResolvedValueOnce({ session_id: "sess-0", accounts: [], access: {} });
    const res = await makeApp(null).request("/eb/callback?code=abc&state=good");
    expect(res.headers.get("location")).toBe(
      "https://web.test/bank-connections/callback?error=no_accounts&provider=enable_banking",
    );
  });

  it("passes a bank error through", async () => {
    const res = await makeApp(null).request("/eb/callback?error=access_denied&state=s");
    expect(res.headers.get("location")).toContain("error=access_denied");
  });

  it("activates the single account of a new connection", async () => {
    verifyOAuthState.mockResolvedValueOnce({
      ownerId: "owner-1",
      connectionId: "c1",
      provider: "enable_banking",
      nonce: "n",
    });
    reads = [[{ id: "c1", ownerId: "owner-1", status: "pending", provider: "enable_banking", providerMetadata: {} }]];
    createSession.mockResolvedValueOnce({
      session_id: "sess-1",
      accounts: [{ uid: "uid-1", account_id: { iban: "BE68 5390 0754 7034" } }],
      access: { valid_until: "2027-05-08T10:00:00Z" },
    });
    const res = await makeApp(null).request("/eb/callback?code=abc&state=good", {
      headers: { "x-forwarded-for": "8.8.8.8", "user-agent": "Mozilla/5.0" },
    });
    expect(res.headers.get("location")).toBe("https://web.test/bank-connections/c1?connected=1");
    expect(createSession).toHaveBeenCalledWith("abc", { ipAddress: "8.8.8.8", userAgent: "Mozilla/5.0" });
    expect(updates[0]).toMatchObject({
      status: "active",
      externalAccountId: "uid-1",
      iban: "BE68539007547034",
      reauthWarnStage: null,
    });
  });
});
