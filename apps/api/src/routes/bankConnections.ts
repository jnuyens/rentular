/**
 * Phase 09 Plan 03 Task 2 — Hono router for the bank-connection lifecycle.
 *
 * 8 endpoints (mounted at /api/v1/bank-connections by index.ts):
 *
 *   GET    /institutions           list Ponto financial institutions (picker data)
 *   POST   /                       initiate OAuth flow (returns Ponto consentLink)
 *   GET    /callback               OAuth callback (state JWT replaces session auth)
 *   GET    /                       list current owner's connections (tokens stripped)
 *   GET    /:id                    single connection (owner-scoped, tokens stripped)
 *   POST   /:id/renew              re-consent (returns fresh consentLink)
 *   DELETE /:id                    revoke + soft-delete (bank_statements retained)
 *   POST   /:id/sync               manual sync, 1/min rate-limited per connection
 *
 * Trust boundaries:
 *   - All routes except GET /callback go through requireAuth + CSRF middleware
 *     (mounted in apps/api/src/index.ts protectedPrefixes).
 *   - GET /callback uses the OAuth state JWT for identity (T-09-03-01); the
 *     `requireAuth` wrapper in index.ts is patched to exempt /callback.
 *   - Cross-tenant access prevented by WHERE id AND ownerId on every :id route
 *     (T-09-03-08).
 *   - Token columns NEVER returned to clients — sanitization helper strips
 *     them on every list/detail response (T-09-03-03).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, bankConnections, bankStatements } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  buildTransactionRows,
  type StatementRow,
} from "../lib/bankTransactionView";
import { signOAuthState, verifyOAuthState } from "../lib/bankOAuthState";
import {
  isPontoConfigured,
  createPontoAuthorizationUrl,
  exchangeAuthorizationCode,
  revokeAccess,
  listAccounts,
  listFinancialInstitutions,
  getFinancialInstitution,
} from "../lib/pontoConnect";
import { encrypt, decrypt } from "../lib/encryption";
import { syncBankConnection } from "../services/bankConnectionSync";

export const bankConnectionsRouter = new Hono();

// In-memory per-connection sync rate limiter (1/min). v1 keeps this in-process —
// CONTEXT line 156 marks Redis-based limiter as optional / future work.
const lastSyncCallByConnection = new Map<string, number>();
const SYNC_RATE_LIMIT_MS = 60_000;

// Connection row keys that MUST be stripped before returning to clients
// (T-09-03-03). The token columns are doubly-protected by encryption at rest,
// but defense-in-depth requires they never leave the API boundary.
function sanitizeConnection<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const {
    encryptedAccessToken: _a,
    tokenIv: _b,
    tokenAuthTag: _c,
    encryptedRefreshToken: _d,
    refreshTokenIv: _e,
    refreshTokenAuthTag: _f,
    providerMetadata: _g,
    ...rest
  } = row;
  void _a;
  void _b;
  void _c;
  void _d;
  void _e;
  void _f;
  void _g;
  return rest;
}

function webUrl(): string {
  return process.env.WEB_URL || "http://localhost:3000";
}

function notConfigured() {
  return { error: "Bank data provider not configured" } as const;
}

// ===========================================================================
// GET /institutions — list Ponto financial institutions for the picker
// ===========================================================================
bankConnectionsRouter.get(
  "/institutions",
  zValidator(
    "query",
    z.object({ country: z.string().length(2).default("BE") }),
  ),
  async (c) => {
    try {
      getRequiredUserId(c);
      if (!isPontoConfigured()) return c.json(notConfigured(), 503);
      const { country } = c.req.valid("query");
      const institutions = await listFinancialInstitutions(country);
      return c.json({ data: institutions });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[BankConnections] /institutions error:", err);
      return c.json({ error: message }, 500);
    }
  },
);

// ===========================================================================
// POST / — initiate connection. Inserts pending row + returns consentLink.
// ===========================================================================
bankConnectionsRouter.post(
  "/",
  zValidator("json", z.object({ institutionId: z.string().min(1) })),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      if (!isPontoConfigured()) return c.json(notConfigured(), 503);
      const { institutionId } = c.req.valid("json");

      const state = await signOAuthState({ ownerId: userId, institutionId });
      const consentLink = createPontoAuthorizationUrl({ state });

      const id = randomUUID();
      const db = getDb();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).insert(bankConnections).values({
        id,
        ownerId: userId,
        provider: "ponto",
        institutionId,
        status: "pending",
        country: "BE",
      });

      return c.json({ data: { id, consentLink } }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[BankConnections] POST / error:", err);
      return c.json({ error: message }, 500);
    }
  },
);

// ===========================================================================
// GET /callback — OAuth callback. State JWT replaces session auth.
// Static path MUST come before /:id so Hono matches it first.
// ===========================================================================
bankConnectionsRouter.get(
  "/callback",
  zValidator(
    "query",
    z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
      error_description: z.string().optional(),
    }),
  ),
  async (c) => {
    const { code, state, error } = c.req.valid("query");

    // Provider-side error (user cancelled, bank refused, …)
    if (error) {
      return c.redirect(
        `${webUrl()}/bank-connections/callback?error=${encodeURIComponent(error)}`,
      );
    }
    if (!code || !state) {
      return c.redirect(
        `${webUrl()}/bank-connections/callback?error=missing_params`,
      );
    }

    // Verify the state JWT (T-09-03-01)
    let payload;
    try {
      payload = await verifyOAuthState(state);
    } catch (verifyErr) {
      console.error("[BankConnections] /callback state verify failed:", verifyErr);
      return c.redirect(
        `${webUrl()}/bank-connections/callback?error=expired_state`,
      );
    }

    try {
      // Exchange code → OAuth tokens
      const tokens = await exchangeAuthorizationCode(code);

      // List accounts under this consent — v1 takes accounts[0]
      const accounts = await listAccounts({ accessToken: tokens.accessToken });
      if (accounts.length === 0) {
        return c.redirect(
          `${webUrl()}/bank-connections/callback?error=no_accounts`,
        );
      }
      const account = accounts[0]!;

      // Encrypt tokens at rest (T-09-03-04 defence-in-depth — even though
      // sanitization already strips them, encryption protects the at-rest copy)
      const encAccess = encrypt(tokens.accessToken);
      const encRefresh = encrypt(tokens.refreshToken);

      // Compute consentExpiresAt — provider-sourced when available, else fall
      // back to EBA upper bound of 180 days (CONTEXT line 56-58).
      const consentExpiresAt = account.authorizationExpirationExpectedAt
        ? new Date(account.authorizationExpirationExpectedAt)
        : new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

      // Resolve the institution display name (e.g. "MyTestBank") so the detail
      // page shows a name, not the raw UUID. Non-fatal: never block the
      // connection if the lookup fails.
      let institutionName: string | null = null;
      try {
        const inst = await getFinancialInstitution(payload.institutionId || "");
        institutionName = inst?.name ?? null;
      } catch (nameErr) {
        console.warn(
          "[BankConnections] could not resolve institution name:",
          nameErr,
        );
      }

      const db = getDb();

      // Build the update payload shared between renewal and new-connection paths.
      const writePayload = {
        institutionName,
        encryptedAccessToken: encAccess.encrypted,
        tokenIv: encAccess.iv,
        tokenAuthTag: encAccess.tag,
        encryptedRefreshToken: encRefresh.encrypted,
        refreshTokenIv: encRefresh.iv,
        refreshTokenAuthTag: encRefresh.tag,
        externalAccountId: account.id,
        iban: account.iban,
        status: "active" as const,
        consentExpiresAt,
        providerMetadata: { accountIds: [account.id] },
        errorMessage: null,
        updatedAt: new Date(),
      };

      let connectionId: string;

      if (payload.connectionId) {
        // Renewal flow: update existing row, scoped to verified owner (T-09-03-02)
        connectionId = payload.connectionId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .update(bankConnections)
          .set(writePayload)
          .where(
            and(
              eq(bankConnections.id, connectionId),
              eq(bankConnections.ownerId, payload.ownerId),
            ),
          );
      } else {
        // New connection: find the most recent pending row by ownerId+institutionId
        const pending = await db
          .select()
          .from(bankConnections)
          .where(
            and(
              eq(bankConnections.ownerId, payload.ownerId),
              eq(bankConnections.status, "pending"),
              eq(
                bankConnections.institutionId,
                payload.institutionId || "",
              ),
            ),
          )
          .orderBy(desc(bankConnections.createdAt))
          .limit(1);

        if (!pending[0]) {
          return c.redirect(
            `${webUrl()}/bank-connections/callback?error=no_pending_row`,
          );
        }
        connectionId = pending[0].id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .update(bankConnections)
          .set(writePayload)
          .where(eq(bankConnections.id, connectionId));
      }

      return c.redirect(
        `${webUrl()}/bank-connections/${connectionId}?connected=1`,
      );
    } catch (err) {
      console.error("[BankConnections] /callback exchange error:", err);
      return c.redirect(
        `${webUrl()}/bank-connections/callback?error=exchange_failed`,
      );
    }
  },
);

// ===========================================================================
// GET / — list current owner's connections (tokens stripped)
// ===========================================================================
bankConnectionsRouter.get("/", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const db = getDb();
    const rows = await db
      .select()
      .from(bankConnections)
      .where(eq(bankConnections.ownerId, userId))
      .orderBy(desc(bankConnections.createdAt));
    return c.json({ data: rows.map(sanitizeConnection) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankConnections] GET / error:", err);
    return c.json({ error: message }, 500);
  }
});

// ===========================================================================
// GET /:id — single owner-scoped connection (tokens stripped)
// ===========================================================================
bankConnectionsRouter.get("/:id", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const id = c.req.param("id");
    const db = getDb();
    const rows = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
      .limit(1);
    if (!rows[0]) return c.json({ error: "Connection not found" }, 404);
    return c.json({ data: sanitizeConnection(rows[0]) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankConnections] GET /:id error:", err);
    return c.json({ error: message }, 500);
  }
});

// ===========================================================================
// GET /:id/transactions — list bank_statements for one owned connection.
// Query ?status=all|unmatched|matched|ignored|mismatched_amount (default all).
// Counterparty PII is decrypted server-side; matched rows carry linkedPayment.
// ===========================================================================
const transactionStatusSchema = z.object({
  status: z
    .enum(["all", "unmatched", "matched", "ignored", "mismatched_amount"])
    .optional()
    .default("all"),
});

bankConnectionsRouter.get(
  "/:id/transactions",
  zValidator("query", transactionStatusSchema),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const id = c.req.param("id");
      const { status } = c.req.valid("query");
      const db = getDb();

      // Ownership: connection must belong to the caller.
      const conn = await db
        .select()
        .from(bankConnections)
        .where(
          and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)),
        )
        .limit(1);
      if (!conn[0]) return c.json({ error: "Connection not found" }, 404);

      const whereClause =
        status === "all"
          ? eq(bankStatements.connectionId, id)
          : and(
              eq(bankStatements.connectionId, id),
              eq(bankStatements.matchStatus, status),
            );

      const rows = (await db
        .select()
        .from(bankStatements)
        .where(whereClause)
        .orderBy(desc(bankStatements.bookingDate))) as StatementRow[];

      const data = await buildTransactionRows(db, rows);
      return c.json({ data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[BankTransactions] GET /:id/transactions error:", err);
      return c.json({ error: message }, 500);
    }
  },
);

// ===========================================================================
// POST /:id/renew — return a fresh authorization URL for re-consent
// ===========================================================================
bankConnectionsRouter.post("/:id/renew", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const id = c.req.param("id");
    if (!isPontoConfigured()) return c.json(notConfigured(), 503);

    const db = getDb();
    const rows = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
      .limit(1);
    if (!rows[0]) return c.json({ error: "Connection not found" }, 404);
    const conn = rows[0];

    const state = await signOAuthState({
      ownerId: userId,
      connectionId: id,
      institutionId: conn.institutionId,
    });
    const consentLink = createPontoAuthorizationUrl({ state });
    return c.json({ data: { consentLink } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankConnections] POST /:id/renew error:", err);
    return c.json({ error: message }, 500);
  }
});

// ===========================================================================
// DELETE /:id — revoke + soft-delete. bank_statements retained for audit.
// ===========================================================================
bankConnectionsRouter.delete("/:id", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const id = c.req.param("id");
    const db = getDb();
    const rows = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
      .limit(1);
    if (!rows[0]) return c.json({ error: "Connection not found" }, 404);
    const conn = rows[0];

    // Best-effort revoke against Ponto. Failures are logged but do not block
    // the soft-delete because the row may already be expired/revoked upstream.
    if (
      conn.encryptedAccessToken &&
      conn.tokenIv &&
      conn.tokenAuthTag
    ) {
      try {
        const accessToken = decrypt(
          conn.encryptedAccessToken,
          conn.tokenIv,
          conn.tokenAuthTag,
        );
        await revokeAccess(accessToken);
      } catch (revokeErr) {
        console.warn(
          `[BankConnections] revokeAccess failed for ${id} — continuing with soft-delete`,
          revokeErr,
        );
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(bankConnections)
      .set({
        status: "revoked",
        encryptedAccessToken: null,
        tokenIv: null,
        tokenAuthTag: null,
        encryptedRefreshToken: null,
        refreshTokenIv: null,
        refreshTokenAuthTag: null,
        updatedAt: new Date(),
      })
      .where(eq(bankConnections.id, id));

    return c.json({ data: { id, status: "revoked" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankConnections] DELETE /:id error:", err);
    return c.json({ error: message }, 500);
  }
});

// ===========================================================================
// POST /:id/sync — manual landlord-triggered sync, 1/min rate-limited
// ===========================================================================
bankConnectionsRouter.post("/:id/sync", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const id = c.req.param("id");
    const db = getDb();
    const rows = await db
      .select()
      .from(bankConnections)
      .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
      .limit(1);
    if (!rows[0]) return c.json({ error: "Connection not found" }, 404);

    // Rate limit 1/min per connection (T-09-03-05)
    const key = `${userId}:${id}`;
    const now = Date.now();
    const last = lastSyncCallByConnection.get(key) ?? 0;
    if (now - last < SYNC_RATE_LIMIT_MS) {
      const retryAfterSeconds = Math.ceil(
        (SYNC_RATE_LIMIT_MS - (now - last)) / 1000,
      );
      return c.json(
        { error: "Rate limit exceeded", retryAfterSeconds },
        429,
      );
    }
    lastSyncCallByConnection.set(key, now);

    const result = await syncBankConnection(id);
    return c.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[BankConnections] POST /:id/sync error:", err);
    return c.json({ error: message }, 500);
  }
});
