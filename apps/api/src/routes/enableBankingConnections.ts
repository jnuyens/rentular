/**
 * Enable Banking routes, mounted at /api/v1/bank-connections/enable-banking.
 *
 *   GET    /app                 status of the landlord's own application (never the key)
 *   PUT    /app                 upload or replace application id + private key, then verify
 *   POST   /app/verify          verify again (signs a JWT and calls GET /aspsps)
 *   DELETE /app                 remove the key; revokes the Enable Banking sessions
 *   GET    /aspsps              bank list for the picker
 *   POST   /                    start a connection: pending row + bank login url
 *   GET    /callback            redirect target after the bank login (state JWT, no session)
 *   POST   /:id/accounts        pick which account(s) of the session to monitor
 *
 * The private key never leaves the server and is never logged. The callback
 * is exempt from the session check in index.ts; the signed state JWT, bound
 * to the landlord, takes its place.
 */

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, bankConnections } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import { signOAuthState, verifyOAuthState } from "../lib/bankOAuthState";
import {
  EnableBankingApiError,
  EnableBankingClient,
  buildAuthRequestBody,
  computeValidUntil,
  getEnableBankingRedirectUrl,
  type EnableBankingCredentials,
  type EnableBankingSession,
  type PsuContext,
  type PsuType,
} from "../lib/enableBanking";
import {
  deleteEnableBankingApp,
  getEnableBankingAppStatus,
  loadBankProviderOptions,
  loadEnableBankingCredentials,
  recordEnableBankingVerification,
  saveEnableBankingApp,
} from "../lib/enableBankingApps";
import { readMetadata, type EnableBankingMetadata } from "../services/enableBankingSync";
import { syncBankConnection } from "../services/bankConnectionSync";
import { normalizeIban } from "../services/bankReauth";

export const enableBankingRouter = new Hono();

type ConnectionRow = typeof bankConnections.$inferSelect;

function webUrl(): string {
  return (process.env.WEB_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** The landlord's browser as seen behind the proxy, for the PSU headers. */
export function psuFromRequest(c: Context): PsuContext {
  return {
    ipAddress:
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      undefined,
    userAgent: c.req.header("user-agent") || undefined,
  };
}

/** Readable outcome of a verification call, with a hint the UI can translate. */
async function verifyCredentials(
  creds: EnableBankingCredentials,
): Promise<{ ok: true; banks: number } | { ok: false; error: string; hint?: "wrong_key_or_app" }> {
  try {
    const banks = await new EnableBankingClient(creds).listAspsps("BE");
    return { ok: true, banks: banks.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof EnableBankingApiError && err.status === 401 ? ("wrong_key_or_app" as const) : undefined;
    return { ok: false, error: message, hint };
  }
}

async function requireCreds(ownerId: string): Promise<EnableBankingCredentials | null> {
  try {
    return await loadEnableBankingCredentials(ownerId);
  } catch (err) {
    console.error("[EnableBanking] could not load the application key:", (err as Error).message);
    return null;
  }
}

async function enableBankingAllowed(ownerId: string): Promise<boolean> {
  const options = await loadBankProviderOptions(ownerId);
  return options.providers.includes("enable_banking");
}

// ===========================================================================
// Application (id + key)
// ===========================================================================

enableBankingRouter.get("/app", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const status = await getEnableBankingAppStatus(userId);
    return c.json({ data: { ...status, redirectUrl: getEnableBankingRedirectUrl() } });
  } catch (err) {
    console.error("[EnableBanking] GET /app error:", err);
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

const appSchema = z.object({
  applicationId: z
    .string()
    .trim()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, "The application id has letters, digits and dashes only"),
  privateKeyPem: z.string().min(100).max(20_000),
  environment: z.enum(["production", "sandbox"]).optional().default("production"),
});

enableBankingRouter.put("/app", zValidator("json", appSchema), async (c) => {
  try {
    const userId = getRequiredUserId(c);
    if (!(await enableBankingAllowed(userId))) {
      return c.json({ error: "Enable Banking is not available on your plan" }, 403);
    }
    const input = c.req.valid("json");
    try {
      await saveEnableBankingApp(userId, input);
    } catch (err) {
      // A key that cannot be parsed: tell the landlord, never echo the key.
      return c.json({ error: (err as Error).message, code: "invalid_key" }, 400);
    }
    const verification = await verifyCredentials({
      applicationId: input.applicationId,
      privateKeyPem: input.privateKeyPem,
    });
    await recordEnableBankingVerification(
      userId,
      verification.ok ? { ok: true } : { ok: false, error: verification.error },
    );
    const status = await getEnableBankingAppStatus(userId);
    return c.json({ data: { ...status, redirectUrl: getEnableBankingRedirectUrl(), verification } });
  } catch (err) {
    console.error("[EnableBanking] PUT /app error:", (err as Error).message);
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

enableBankingRouter.post("/app/verify", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const creds = await requireCreds(userId);
    if (!creds) return c.json({ error: "No Enable Banking application configured" }, 404);
    const verification = await verifyCredentials(creds);
    const status = await getEnableBankingAppStatus(userId);
    if (status.source === "account") {
      await recordEnableBankingVerification(
        userId,
        verification.ok ? { ok: true } : { ok: false, error: verification.error },
      );
    }
    return c.json({ data: { ...(await getEnableBankingAppStatus(userId)), verification } });
  } catch (err) {
    console.error("[EnableBanking] POST /app/verify error:", (err as Error).message);
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

enableBankingRouter.delete("/app", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const db = getDb();
    const creds = await requireCreds(userId);
    const rows = await db
      .select()
      .from(bankConnections)
      .where(
        and(
          eq(bankConnections.ownerId, userId),
          eq(bankConnections.provider, "enable_banking"),
          ne(bankConnections.status, "revoked"),
        ),
      );
    // Revoke each session once at Enable Banking (best effort), then the rows.
    const sessions = new Set(rows.map((r) => readMetadata(r.providerMetadata).sessionId).filter(Boolean));
    if (creds) {
      const client = new EnableBankingClient(creds);
      for (const sessionId of sessions) {
        try {
          await client.deleteSession(sessionId!);
        } catch (err) {
          console.warn("[EnableBanking] session revoke failed:", (err as Error).message);
        }
      }
    }
    for (const r of rows) {
      await db
        .update(bankConnections)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(bankConnections.id, r.id));
    }
    await deleteEnableBankingApp(userId);
    return c.json({ data: { removed: true, revokedConnections: rows.length } });
  } catch (err) {
    console.error("[EnableBanking] DELETE /app error:", err);
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});

// ===========================================================================
// Banks
// ===========================================================================

enableBankingRouter.get(
  "/aspsps",
  zValidator(
    "query",
    z.object({
      country: z.string().length(2).default("BE"),
      psuType: z.enum(["personal", "business"]).optional(),
    }),
  ),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const creds = await requireCreds(userId);
      if (!creds) return c.json({ error: "No Enable Banking application configured" }, 404);
      const { country, psuType } = c.req.valid("query");
      const banks = await new EnableBankingClient(creds).listAspsps(country.toUpperCase(), psuType);
      return c.json({
        data: banks
          .map((b) => ({
            name: b.name,
            country: b.country,
            logo: b.logo ?? null,
            psuTypes: b.psu_types ?? [],
            maximumConsentValidity: b.maximum_consent_validity ?? null,
            beta: !!b.beta,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[EnableBanking] GET /aspsps error:", message);
      return c.json({ error: message }, err instanceof EnableBankingApiError ? 502 : 500);
    }
  },
);

// ===========================================================================
// Start a connection (and re-login, see startEnableBankingLogin)
// ===========================================================================

/**
 * Ask Enable Banking for a bank login url for a connection row. Used for a
 * new connection and for a re-login of an existing one.
 */
export async function startEnableBankingLogin(params: {
  ownerId: string;
  connectionId: string;
  aspspName: string;
  country: string;
  psuType: PsuType;
  psu: PsuContext;
}): Promise<{ consentLink: string; validUntil: Date }> {
  const creds = await loadEnableBankingCredentials(params.ownerId);
  if (!creds) throw new Error("No Enable Banking application configured");
  const client = new EnableBankingClient(creds);

  // The bank's own maximum consent validity caps the 180 days.
  let maxValidity: number | null = null;
  try {
    const banks = await client.listAspsps(params.country, params.psuType);
    maxValidity = banks.find((b) => b.name === params.aspspName)?.maximum_consent_validity ?? null;
  } catch (err) {
    console.warn("[EnableBanking] bank list unavailable, using 180 days:", (err as Error).message);
  }
  const validUntil = computeValidUntil(maxValidity);

  const state = await signOAuthState({
    ownerId: params.ownerId,
    connectionId: params.connectionId,
    institutionId: params.aspspName,
    provider: "enable_banking",
    aspspName: params.aspspName,
    aspspCountry: params.country,
    psuType: params.psuType,
  });
  const r = await client.startAuthorization(
    buildAuthRequestBody({
      aspspName: params.aspspName,
      country: params.country,
      psuType: params.psuType,
      state,
      redirectUrl: getEnableBankingRedirectUrl(),
      validUntil,
    }),
    params.psu,
  );
  return { consentLink: r.url, validUntil };
}

enableBankingRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      aspspName: z.string().min(1).max(255),
      country: z.string().length(2).default("BE"),
      psuType: z.enum(["personal", "business"]).default("personal"),
    }),
  ),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      if (!(await enableBankingAllowed(userId))) {
        return c.json({ error: "Enable Banking is not available on your plan" }, 403);
      }
      const { aspspName, country, psuType } = c.req.valid("json");
      const id = randomUUID();
      const meta: EnableBankingMetadata = {
        aspsp: { name: aspspName, country: country.toUpperCase() },
        psuType,
      };
      const db = getDb();
      await db.insert(bankConnections).values({
        id,
        ownerId: userId,
        provider: "enable_banking",
        institutionId: aspspName,
        institutionName: aspspName,
        status: "pending",
        country: country.toUpperCase(),
        providerMetadata: meta,
      });
      const { consentLink } = await startEnableBankingLogin({
        ownerId: userId,
        connectionId: id,
        aspspName,
        country: country.toUpperCase(),
        psuType,
        psu: psuFromRequest(c),
      });
      return c.json({ data: { id, consentLink } }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[EnableBanking] POST / error:", message);
      return c.json({ error: message }, err instanceof EnableBankingApiError ? 502 : 500);
    }
  },
);

// ===========================================================================
// Callback
// ===========================================================================

function sessionAccounts(session: EnableBankingSession): NonNullable<EnableBankingMetadata["accounts"]> {
  return (session.accounts || []).map((a) => ({
    uid: a.uid,
    iban: normalizeIban(a.account_id?.iban || a.account_id?.other?.identification || ""),
    name: a.name ?? null,
    currency: a.currency ?? null,
  }));
}

/**
 * Point a connection row at one account of a (new) session: active, new
 * consent end, warning stage reset. History and statements stay on the row.
 */
function activePayload(
  meta: EnableBankingMetadata,
  session: EnableBankingSession,
  account: { uid: string; iban: string },
  accounts: NonNullable<EnableBankingMetadata["accounts"]>,
  validUntil: Date,
) {
  return {
    status: "active" as const,
    externalRequisitionId: session.session_id,
    externalAccountId: account.uid,
    iban: account.iban || null,
    consentExpiresAt: validUntil,
    errorMessage: null,
    reauthWarnStage: null,
    reauthWarnedAt: null,
    providerMetadata: {
      ...meta,
      sessionId: session.session_id,
      accountUids: [account.uid],
      accounts,
      unattended: undefined,
    } satisfies EnableBankingMetadata,
    updatedAt: new Date(),
  };
}

function firstSync(connectionId: string, psu: PsuContext): void {
  // The first fetch runs with the landlord present (some banks want that).
  void syncBankConnection(connectionId, psu.ipAddress || undefined, psu.userAgent || undefined).catch(
    (err) => console.warn(`[EnableBanking] first sync of ${connectionId} failed:`, (err as Error).message),
  );
}

enableBankingRouter.get(
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
    const back = (q: string) => c.redirect(`${webUrl()}/bank-connections/callback?${q}`);
    const { code, state, error } = c.req.valid("query");
    if (error) return back(`error=${encodeURIComponent(error)}`);
    if (!code || !state) return back("error=missing_params");

    let payload;
    try {
      payload = await verifyOAuthState(state);
    } catch (verifyErr) {
      console.error("[EnableBanking] /callback state verify failed:", (verifyErr as Error).message);
      return back("error=expired_state");
    }
    if (payload.provider !== "enable_banking" || !payload.connectionId) {
      return back("error=expired_state");
    }

    const db = getDb();
    try {
      const row = (
        await db
          .select()
          .from(bankConnections)
          .where(
            and(
              eq(bankConnections.id, payload.connectionId),
              eq(bankConnections.ownerId, payload.ownerId),
              eq(bankConnections.provider, "enable_banking"),
            ),
          )
          .limit(1)
      )[0];
      if (!row || row.status === "revoked") return back("error=no_pending_row");

      const creds = await loadEnableBankingCredentials(payload.ownerId);
      if (!creds) return back("error=no_app");
      const client = new EnableBankingClient(creds);
      const psu = psuFromRequest(c);
      const session = await client.createSession(code, psu);
      const accounts = sessionAccounts(session);
      if (accounts.length === 0) return back("error=no_accounts");
      const validUntil = session.access?.valid_until
        ? new Date(session.access.valid_until)
        : computeValidUntil(null);
      const meta = readMetadata(row.providerMetadata);

      if (row.status === "pending") {
        // New connection: one account goes live right away, several are offered.
        if (accounts.length === 1) {
          await db
            .update(bankConnections)
            .set(activePayload(meta, session, accounts[0]!, accounts, validUntil))
            .where(eq(bankConnections.id, row.id));
          firstSync(row.id, psu);
          return c.redirect(`${webUrl()}/bank-connections/${row.id}?connected=1`);
        }
        await db
          .update(bankConnections)
          .set({
            externalRequisitionId: session.session_id,
            consentExpiresAt: validUntil,
            providerMetadata: { ...meta, sessionId: session.session_id, accounts },
            updatedAt: new Date(),
          })
          .where(eq(bankConnections.id, row.id));
        return c.redirect(`${webUrl()}/bank-connections/${row.id}?pick=1`);
      }

      // Re-login: the new session replaces the old one on the same row (and on
      // its sibling rows of the same session), matched by IBAN because account
      // uids change with every session.
      const oldSessionId = meta.sessionId;
      const siblings: ConnectionRow[] = oldSessionId
        ? (
            await db
              .select()
              .from(bankConnections)
              .where(
                and(
                  eq(bankConnections.ownerId, payload.ownerId),
                  eq(bankConnections.provider, "enable_banking"),
                  ne(bankConnections.status, "revoked"),
                ),
              )
          ).filter((r) => r.id !== row.id && readMetadata(r.providerMetadata).sessionId === oldSessionId)
        : [];

      const target = accounts.find((a) => a.iban && a.iban === normalizeIban(row.iban));
      if (!target) {
        await db
          .update(bankConnections)
          .set({
            errorMessage: "The account was not included in the new bank login",
            updatedAt: new Date(),
          })
          .where(eq(bankConnections.id, row.id));
        return back("error=account_missing");
      }
      await db
        .update(bankConnections)
        .set(activePayload(meta, session, target, accounts, validUntil))
        .where(eq(bankConnections.id, row.id));
      for (const sib of siblings) {
        const acc = accounts.find((a) => a.iban && a.iban === normalizeIban(sib.iban));
        if (!acc) continue;
        await db
          .update(bankConnections)
          .set(activePayload(readMetadata(sib.providerMetadata), session, acc, accounts, validUntil))
          .where(eq(bankConnections.id, sib.id));
      }
      if (oldSessionId && oldSessionId !== session.session_id) {
        await client.deleteSession(oldSessionId).catch(() => undefined);
      }
      firstSync(row.id, psu);
      return c.redirect(`${webUrl()}/bank-connections/${row.id}?connected=1`);
    } catch (err) {
      console.error("[EnableBanking] /callback error:", (err as Error).message);
      return back("error=exchange_failed");
    }
  },
);

// ===========================================================================
// Pick accounts after a login with several accounts
// ===========================================================================

enableBankingRouter.post(
  "/:id/accounts",
  zValidator("json", z.object({ accountUids: z.array(z.string().min(1)).min(1).max(20) })),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const id = c.req.param("id");
      const { accountUids } = c.req.valid("json");
      const db = getDb();
      const row = (
        await db
          .select()
          .from(bankConnections)
          .where(
            and(
              eq(bankConnections.id, id),
              eq(bankConnections.ownerId, userId),
              eq(bankConnections.provider, "enable_banking"),
            ),
          )
          .limit(1)
      )[0];
      if (!row) return c.json({ error: "Connection not found" }, 404);
      if (row.status !== "pending") return c.json({ error: "Accounts were already chosen" }, 409);
      const meta = readMetadata(row.providerMetadata);
      const offered = meta.accounts || [];
      const picked = accountUids
        .map((uid) => offered.find((a) => a.uid === uid))
        .filter((a): a is NonNullable<typeof a> => !!a);
      if (picked.length === 0 || !meta.sessionId) {
        return c.json({ error: "Pick one of the offered accounts" }, 400);
      }
      const session: EnableBankingSession = { session_id: meta.sessionId, accounts: [] };
      const validUntil = row.consentExpiresAt ?? computeValidUntil(null);

      await db
        .update(bankConnections)
        .set(activePayload(meta, session, picked[0]!, offered, validUntil))
        .where(eq(bankConnections.id, row.id));
      const ids = [row.id];
      for (const acc of picked.slice(1)) {
        const extraId = randomUUID();
        await db.insert(bankConnections).values({
          id: extraId,
          ownerId: userId,
          provider: "enable_banking",
          institutionId: row.institutionId,
          institutionName: row.institutionName,
          country: row.country,
          ...activePayload(meta, session, acc, offered, validUntil),
        });
        ids.push(extraId);
      }
      const psu = psuFromRequest(c);
      for (const cid of ids) firstSync(cid, psu);
      return c.json({ data: { ids } });
    } catch (err) {
      console.error("[EnableBanking] POST /:id/accounts error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  },
);
