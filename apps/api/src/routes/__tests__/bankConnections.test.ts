/**
 * Phase 09 Plan 03 Task 3 — Hono router integration tests for bankConnections.
 *
 * Covers three critical paths:
 *
 *   BANK-ROUTES: GET /institutions returns 503 when Ponto is not configured.
 *   BANK-ROUTES: POST / inserts a pending bank_connections row and returns
 *                a Ponto authorization URL.
 *   BANK-OAUTH:  GET /callback with a tampered state JWT redirects to the
 *                dashboard with ?error=expired_state (T-09-03-01 mitigation).
 *
 * Mocking strategy mirrors apps/api/src/routes/__tests__/settings.test.ts —
 * vi.mock'd boundaries for @rentular/db, bullmq, encryption, pontoConnect,
 * bankConnectionSync. The auth middleware is bypassed by injecting userId
 * onto the Hono context before each test via a wrapper app.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// --- DB / drizzle mocks --------------------------------------------------

const insertCalls: Array<{ table: unknown; row: Record<string, unknown> }> = [];

vi.mock("@rentular/db", () => {
  const bankConnections = {
    id: "id",
    ownerId: "owner_id",
    status: "status",
    institutionId: "institution_id",
    createdAt: "created_at",
    __table: "bank_connections",
  };

  const users = { id: "id", landlordType: "landlord_type", __table: "users" };
  const bankStatements = { id: "id", __table: "bank_statements" };

  const fakeDb = {
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return [{ insertId: 1 }];
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
          limit: async () => [],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => [{ affectedRows: 0 }],
      }),
    }),
  };

  return {
    bankConnections,
    users,
    bankStatements,
    getDb: vi.fn(() => fakeDb),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "EQ"),
  and: vi.fn(() => "AND"),
  desc: vi.fn(() => "DESC"),
}));

// --- bullmq / queue boundary (Worker module triggers a connection attempt
//     if not mocked; mirror settings.test.ts pattern) -----------------------

vi.mock("bullmq", () => {
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: "j" });
    constructor() {}
  }
  class MockWorker {
    on = vi.fn();
    constructor(..._args: unknown[]) {}
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

// --- Encryption / Ponto / Sync boundaries -------------------------------

vi.mock("../../lib/encryption", () => ({
  encrypt: vi.fn((plain: string) => ({
    encrypted: `ENC-${plain}`,
    iv: "IV",
    tag: "TAG",
  })),
  decrypt: vi.fn((enc: string) => enc.replace(/^ENC-/, "")),
}));

const isPontoConfiguredMock = vi.fn();
const listFinancialInstitutionsMock = vi.fn();
const createPontoAuthorizationUrlMock = vi.fn();
const exchangeAuthorizationCodeMock = vi.fn();
const listAccountsMock = vi.fn();
const revokeAccessMock = vi.fn();
const getRedirectUriMock = vi.fn();

vi.mock("../../lib/pontoConnect", () => ({
  isPontoConfigured: () => isPontoConfiguredMock(),
  listFinancialInstitutions: (...a: unknown[]) =>
    listFinancialInstitutionsMock(...a),
  createPontoAuthorizationUrl: (...a: unknown[]) =>
    createPontoAuthorizationUrlMock(...a),
  exchangeAuthorizationCode: (...a: unknown[]) =>
    exchangeAuthorizationCodeMock(...a),
  listAccounts: (...a: unknown[]) => listAccountsMock(...a),
  revokeAccess: (...a: unknown[]) => revokeAccessMock(...a),
  getRedirectUri: (...a: unknown[]) => getRedirectUriMock(...a),
}));

// OAuth state JWT helper — the third test stubs verifyOAuthState to throw.
const signOAuthStateMock = vi.fn();
const verifyOAuthStateMock = vi.fn();

vi.mock("../../lib/bankOAuthState", () => ({
  signOAuthState: (...a: unknown[]) => signOAuthStateMock(...a),
  verifyOAuthState: (...a: unknown[]) => verifyOAuthStateMock(...a),
}));

vi.mock("../../services/bankConnectionSync", () => ({
  syncBankConnection: vi.fn(async () => ({
    fetched: 0,
    matched: 0,
    mismatched: 0,
    unmatched: 0,
    skippedDuplicates: 0,
  })),
}));

// --- Test harness --------------------------------------------------------

async function buildApp(userId: string | null) {
  const { bankConnectionsRouter } = await import("../bankConnections");
  const app = new Hono();
  // Inject userId before routing — matches the production authMiddleware
  // semantics. When userId is null, getRequiredUserId throws inside the
  // handler producing a 500 (acceptable — the real protectedPrefixes
  // wrapper would short-circuit with 401 before reaching the handler).
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    await next();
  });
  app.route("/bank-connections", bankConnectionsRouter);
  return app;
}

beforeEach(() => {
  vi.resetModules();
  insertCalls.length = 0;
  isPontoConfiguredMock.mockReset();
  listFinancialInstitutionsMock.mockReset();
  createPontoAuthorizationUrlMock.mockReset();
  exchangeAuthorizationCodeMock.mockReset();
  listAccountsMock.mockReset();
  revokeAccessMock.mockReset();
  getRedirectUriMock.mockReset();
  signOAuthStateMock.mockReset();
  verifyOAuthStateMock.mockReset();

  // Default: not configured (tests opt-in for "configured")
  isPontoConfiguredMock.mockReturnValue(false);

  // WEB_URL used by the callback redirects
  process.env.WEB_URL = "http://localhost:3000";
});

describe("Phase 09-03 / bankConnections router", () => {
  it("BANK-ROUTES: GET /institutions returns 503 when Ponto not configured", async () => {
    isPontoConfiguredMock.mockReturnValue(false);
    const app = await buildApp("owner-test");
    const res = await app.request("/bank-connections/institutions?country=BE");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Bank data provider not configured");
  });

  it("BANK-ROUTES: POST / inserts a pending connection and returns consentLink", async () => {
    isPontoConfiguredMock.mockReturnValue(true);
    signOAuthStateMock.mockResolvedValue("signed-state-token");
    createPontoAuthorizationUrlMock.mockReturnValue(
      "https://authorization.myponto.com/oauth2/authorize?client_id=x&state=signed-state-token",
    );

    const app = await buildApp("owner-test");
    const res = await app.request("/bank-connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionId: "fixture-belfius" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; consentLink: string } };
    expect(body.data.consentLink.startsWith("https://authorization.myponto.com")).toBe(
      true,
    );

    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0]!.row;
    expect(row.ownerId).toBe("owner-test");
    expect(row.institutionId).toBe("fixture-belfius");
    expect(row.status).toBe("pending");
    expect(row.provider).toBe("ponto");
  });

  it("BANK-OAUTH: GET /callback with tampered state redirects to ?error=expired_state", async () => {
    verifyOAuthStateMock.mockRejectedValue(new Error("Bad signature"));

    const app = await buildApp(null);
    const res = await app.request(
      "/bank-connections/callback?code=test-code&state=BAD-STATE",
      { redirect: "manual" },
    );

    // Hono's c.redirect returns a 302 with Location header
    expect([302, 301]).toContain(res.status);
    const location = res.headers.get("Location") || "";
    expect(location).toContain("error=expired_state");
    // verifyOAuthState was called once with the tampered token
    expect(verifyOAuthStateMock).toHaveBeenCalledWith("BAD-STATE");
  });
});
