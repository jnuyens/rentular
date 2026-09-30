# Phase 09: PSD2 Bank Connection Flow (Ponto Connect, Customer-Paying) — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 22 new/modified
**Analogs found:** 22 / 22 (all backed by existing reference code)

---

## File Classification

| New/Modified File | NEW/MODIFY | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `packages/db/src/schema/bankConnections.ts` | MODIFY | schema | CRUD | self (extend existing table) | exact (self-extension) |
| `packages/db/src/schema/bankStatements.ts` | NEW | schema | CRUD + audit | `packages/db/src/schema/communications.ts` (json + enum + indexes) | role-match (table with json blob + status enum + multi-index) |
| `packages/db/src/schema/index.ts` | MODIFY | barrel export | n/a | self (existing pattern) | exact |
| `packages/db/drizzle/0001_*.sql` | NEW | migration | DDL | `packages/db/drizzle/0000_futuristic_the_initiative.sql` | exact (drizzle-kit generated) |
| `apps/api/src/routes/bankConnections.ts` | NEW | controller | request-response (REST + OAuth callback) | `apps/api/src/routes/gocardless.ts` + `apps/api/src/routes/bankAccounts.ts` | exact (Hono router + zod-validator + ownership check) |
| `apps/api/src/index.ts` | MODIFY | bootstrap | mount + protect | self (existing mount + `protectedPrefixes`) | exact |
| `apps/api/src/lib/bankAccountData.ts` | MODIFY | provider class + factory | request-response (HTTP→provider) | self (existing `GoCardlessBadProvider`) | exact (parallel class) |
| `apps/api/src/lib/pontoConnect.ts` | NEW | OAuth/REST client | request-response | `apps/api/src/lib/gocardless.ts` (SDK wrapper) | role-match (third-party client wrapper) |
| `apps/api/src/lib/bankOAuthState.ts` | NEW | utility (JWT sign/verify) | transform (pure crypto) | `apps/api/src/lib/encryption.ts` (env-key + jose/node-crypto helper) | role-match (small crypto helper module) |
| `apps/api/src/services/bankConnectionSync.ts` | NEW | service | request-response + DB write | `apps/api/src/services/transactionMatcher.ts` | role-match (service that wraps DB + provider) |
| `apps/api/src/services/bankStatementImporter.ts` | NEW | service | batch (dedup-insert) | `apps/api/src/services/transactionMatcher.ts` (batch over transactions, INSERT pattern) | role-match |
| `apps/api/src/jobs/paymentCheckWorker.ts` | MODIFY | background worker | event-driven (cron) | self (Phase B loop already iterates connections) | exact (10-line edit) |
| `apps/web/app/(dashboard)/bank-connections/page.tsx` | NEW | component (list view) | request-response (fetch list) | `apps/web/app/(dashboard)/mandates/page.tsx` | exact |
| `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx` | NEW | component (detail view) | request-response | mandates page.tsx (table row pattern → adapt to single-record detail) | role-match (no exact detail-page analog exists) |
| `apps/web/app/(dashboard)/bank-connections/connect/page.tsx` | NEW | component (institution picker) | request-response | `apps/web/components/MandateSetupModal.tsx` (multi-step picker flow) | role-match |
| `apps/web/app/(dashboard)/bank-connections/callback/page.tsx` | NEW | component (thin redirect target) | request-response | mandates page header pattern (success/error display only) | partial (no exact analog) |
| `apps/web/app/(dashboard)/layout.tsx` | MODIFY | layout | sidebar nav | self (`navigationItems` + `NAV_VISIBILITY`) | exact |
| `apps/web/components/BankConnectionStatusBadge.tsx` | NEW | component | display | `apps/web/components/MandateStatusBadge.tsx` | exact |
| `apps/web/components/InstitutionPicker.tsx` | NEW | component | display + selection | `apps/web/components/MandateSetupModal.tsx` (select + searchable picker) | role-match |
| `apps/web/messages/{en,nl,fr,de}/common.json` | MODIFY | i18n | k/v | self (existing `mandates.*` and `nav.*` namespaces) | exact |
| `.env.example` | MODIFY | config | k/v | self (existing GoCardless section) | exact |
| `apps/api/src/__tests__/bankConnections.test.ts` | NEW | test | n/a | `apps/api/src/routes/__tests__/settings.test.ts` (vi.mock + describe/it pattern) | role-match |

---

## Pattern Assignments

### 1. `packages/db/src/schema/bankConnections.ts` (MODIFY — additive columns)

**Analog:** self (`packages/db/src/schema/bankConnections.ts`)

**Existing table shape to preserve** (`bankConnections.ts:11-34`):

```typescript
export const bankConnections = mysqlTable("bank_connections", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 }).notNull().references(() => users.id),
  provider: mysqlEnum("provider", ["gocardless_bad", "ponto", "enable_banking"]).notNull(),
  externalRequisitionId: varchar("external_requisition_id", { length: 255 }),
  externalAccountId: varchar("external_account_id", { length: 255 }),
  institutionId: varchar("institution_id", { length: 255 }).notNull(),
  institutionName: varchar("institution_name", { length: 255 }),
  iban: varchar("iban", { length: 34 }),
  status: mysqlEnum("status", ["pending", "active", "expired", "revoked", "error"]).default("pending").notNull(),
  consentExpiresAt: timestamp("consent_expires_at"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncCursor: varchar("last_sync_cursor", { length: 255 }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ownerIdx: index("bank_connections_owner_idx").on(table.ownerId),
  statusIdx: index("bank_connections_status_idx").on(table.status),
}));
```

**Additive columns to introduce** (all nullable, no breaking change):
- `encryptedAccessToken: text("encrypted_access_token")` — base64 ciphertext from `encrypt()`
- `tokenIv: varchar("token_iv", { length: 64 })` — base64 IV
- `tokenAuthTag: varchar("token_auth_tag", { length: 64 })` — base64 GCM tag
- `encryptedRefreshToken: text("encrypted_refresh_token")`, `refreshTokenIv: varchar(...,64)`, `refreshTokenAuthTag: varchar(...,64)`
- `providerMetadata: json("provider_metadata")` — Ponto org_id, integration_id, account_ids
- `country: varchar("country", { length: 2 }).default("BE").notNull()`

**Conventions to maintain:**
- snake_case column names; camelCase TS keys
- `varchar(255)` for external IDs, `varchar(36)` for our UUIDs, `varchar(34)` for IBAN
- Indexes declared inside the second `mysqlTable` argument
- All timestamp columns explicit (no implicit `updated_at` ON UPDATE)

---

### 2. `packages/db/src/schema/bankStatements.ts` (NEW)

**Analog:** `packages/db/src/schema/communications.ts` (json blob + enum status + multi-column indexes)

**Pattern excerpt from analog** (`communications.ts:14-67`):

```typescript
export const communications = mysqlTable("communications", {
  id: varchar("id", { length: 36 }).primaryKey().notNull(),
  ownerId: varchar("owner_id", { length: 255 }).notNull().references(() => users.id),
  leaseId: varchar("lease_id", { length: 36 }).references(() => leases.id),
  channel: mysqlEnum("channel", ["email", "sms", "letter"]).notNull(),
  type: mysqlEnum("type", [/* ... */]).notNull(),
  status: mysqlEnum("status", ["queued", "sent", "delivered", "failed", "bounced"]).default("queued").notNull(),
  externalId: varchar("external_id", { length: 255 }),
  metadata: json("metadata"),
  queuedAt: timestamp("queued_at").defaultNow().notNull(),
  // ...
}, (table) => ({
  ownerIdx: index("communications_owner_idx").on(table.ownerId),
  leaseIdx: index("communications_lease_idx").on(table.leaseId),
}));
```

**Required shape per CONTEXT decisions:**
- `id varchar(36) PK`
- `connectionId varchar(36) NOT NULL → bank_connections.id`
- `externalTransactionId varchar(255) NOT NULL` — UNIQUE with `connectionId`
- `amount decimal(12, 2) NOT NULL`, `currency varchar(3) NOT NULL`
- `valueDate date`, `executionDate date NOT NULL` (or `bookingDate` per research example — keep `bookingDate` to align with `IncomingTransaction.bookingDate` in `bankAccountData.ts:13`)
- `counterpartyName text` (encrypted via `lib/encryption.ts` → store as ciphertext; needs IV + tag columns)
- `counterpartyIban text` (encrypted)
- `structuredCommunication varchar(50)` — digits-only normalized (matches `transactionMatcher.ts:38`)
- `unstructuredCommunication text`
- `rawPayload json` (encrypted at rest per CONTEXT line 83 — store ciphertext + IV + tag)
- `matchedPaymentId varchar(36)` nullable → `payments.id`
- `matchStatus mysqlEnum("match_status", ["unmatched", "matched", "mismatched_amount", "ignored"]).default("unmatched").notNull()`
- `importedAt timestamp DEFAULT now()`, `matchedAt timestamp` nullable

**Indexes (per CONTEXT line 53):**
- UNIQUE `(connection_id, external_transaction_id)` — dedup safety net
- INDEX `(connection_id, value_date)` or `(connection_id, booking_date)`
- INDEX `(match_status)`

**Conventions to maintain:**
- Use `decimal(12, 2)` for money (matches `payments.amount` precedent)
- Use `mysqlEnum` not free string for status (matches `bank_connections.status`)
- Underscore_case for indexes: `bank_statements_conn_tx_uniq` (matches research excerpt naming on line 269 of RESEARCH.md)

---

### 3. `packages/db/src/schema/index.ts` (MODIFY)

**Analog:** self.

**Pattern** (`schema/index.ts:1-16`):

```typescript
export * from "./users";
export * from "./properties";
export * from "./bankAccounts";
export * from "./bankConnections";
export * from "./imports";
```

**Action:** Add `export * from "./bankStatements";` after `./bankConnections`.

---

### 4. `packages/db/drizzle/0001_*.sql` (NEW migration)

**Analog:** `packages/db/drizzle/0000_futuristic_the_initiative.sql`

**Pattern excerpt** (`0000_*.sql:1-14`):

```sql
CREATE TABLE `bank_accounts` (
	`id` varchar(36) NOT NULL,
	`owner_id` varchar(255) NOT NULL,
	`iban` varchar(34) NOT NULL,
	`is_default` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
```

**Conventions to maintain:**
- Generated by `pnpm --filter @rentular/db drizzle-kit generate` — never hand-write
- `--> statement-breakpoint` separator between statements
- File name auto-generated by drizzle-kit (e.g. `0001_<adjective>_<noun>.sql`)
- Migration commits both `.sql` file and updated `meta/_journal.json` + `meta/000X_snapshot.json`

---

### 5. `apps/api/src/routes/bankConnections.ts` (NEW)

**Analog:** `apps/api/src/routes/gocardless.ts` (closest by domain: third-party provider lifecycle routes with ownership check)

**Imports pattern** (`gocardless.ts:1-19`):

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getDb, tenants, leases, properties } from "@rentular/db";
import {
  isGoCardlessConfigured,
  createMandateSetupFlow,
  getMandate,
  cancelMandate,
} from "../lib/gocardless";
import { getRequiredUserId } from "../lib/routeAuth";
import {
  getUserPropertyRole,
  hasMinimumRole,
  getAccessiblePropertyIds,
} from "../lib/propertyAccess";

export const gocardlessRouter = new Hono();
```

**For Phase 9** adapt to:
```typescript
import { getDb, bankConnections } from "@rentular/db";
import { getBankAccountDataProvider } from "../lib/bankAccountData";
import { signOAuthState, verifyOAuthState } from "../lib/bankOAuthState";
import { getRequiredUserId } from "../lib/routeAuth";
import { syncBankConnection } from "../services/bankConnectionSync";

export const bankConnectionsRouter = new Hono();
```

**Configured-check pattern** (`gocardless.ts:24-35`, `gocardless.ts:38-53`):

```typescript
gocardlessRouter.get("/status", async (c) => {
  const configured = isGoCardlessConfigured();
  // ...
  return c.json({ configured, environment: process.env.GOCARDLESS_ENVIRONMENT || "sandbox", maskedToken });
});

gocardlessRouter.get("/creditor", async (c) => {
  if (!isGoCardlessConfigured()) {
    return c.json({ error: "GoCardless is not configured." }, 503);
  }
  // ...
});
```

For Phase 9: implement `isPontoConfigured()` in `pontoConnect.ts`; gate all routes with `503` if missing env.

**Ownership check pattern** (`gocardless.ts:198-209`):

```typescript
const userId = getRequiredUserId(c);
// Verify lease exists and user has manager+ role on its property
const lease = await db.select().from(leases).where(eq(leases.id, data.leaseId)).limit(1);
if (!lease[0]) {
  return c.json({ error: "Lease not found" }, 404);
}
const role = await getUserPropertyRole(userId, lease[0].propertyId);
if (!role || !hasMinimumRole(role, "manager")) {
  return c.json({ error: "Insufficient permissions" }, 403);
}
```

**Phase 9 adapts to:** owner-scoped check using `eq(bankConnections.ownerId, userId)` (no property role — bank connections are owner-level per CONTEXT line 47).

**Body validation pattern** (`gocardless.ts:170-186`):

```typescript
gocardlessRouter.post(
  "/mandates/setup",
  zValidator("json", z.object({
    tenantId: z.string().uuid(),
    redirectUrl: z.string().url(),
  })),
  async (c) => {
    const data = c.req.valid("json");
    // ...
  }
);
```

**Phase 9 endpoints needed (per CONTEXT lines 62-72):**
- `POST /` — initiate connection. Body: `{ institutionId: string }`.
- `GET /` — list connections for owner. Sanitized (strip token columns).
- `GET /:id` — single connection.
- `GET /callback` — OAuth callback (state JWT verification).
- `POST /:id/renew` — initiate re-consent.
- `DELETE /:id` — revoke and soft-delete (set `status='revoked'`).
- `POST /:id/sync` — manual sync (rate-limited 1/min per connection).
- `GET /institutions?country=BE` — list available banks (cache server-side).

**Error handling pattern** (`gocardless.ts:234-239`):

```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Failed to create mandate flow";
  console.error("[GoCardless] Mandate setup error:", err);
  return c.json({ error: message }, 500);
}
```

**Phase 9 log prefix:** `[BankConnections]` (matches existing `[Properties]`, `[GoCardless]`, `[PaymentCheck]` convention from CLAUDE.md).

**Soft-delete pattern** (`gocardless.ts:381-414` — flag affected leases + clear linked IDs):

```typescript
await db.update(leases).set({ notes: updatedNotes, gocardlessMandateId: null, updatedAt: new Date() }).where(...);
```

For Phase 9 DELETE: do NOT hard-delete; set `status='revoked'`, keep historical `bank_statements` rows (CONTEXT line 157).

---

### 6. `apps/api/src/index.ts` (MODIFY)

**Analog:** self.

**Mount pattern** (`apps/api/src/index.ts:128-147`):

```typescript
app.route("/properties", propertiesRouter);
// ...
app.route("/bank-accounts", bankAccountsRouter);
app.route("/gocardless", gocardlessRouter);
app.route("/import", importRouter);
```

**Protected-prefix pattern** (`apps/api/src/index.ts:46-61`):

```typescript
const protectedPrefixes = [
  "/properties",
  // ...
  "/bank-accounts",
  "/gocardless",
  "/maintenance",
  "/import",
];
```

**Phase 9 actions:**
1. Add `import { bankConnectionsRouter } from "./routes/bankConnections";` near other router imports.
2. Add `"/bank-connections"` to `protectedPrefixes` array.
3. Add `app.route("/bank-connections", bankConnectionsRouter);` near other `app.route(...)` calls.

**CSRF note:** The existing CSRF middleware (`apps/api/src/index.ts:73-80`) skips webhook paths. The `GET /bank-connections/callback` route is a GET (no CSRF) and uses the JWT state token instead. All POST/DELETE routes are auto-protected because they share the same router origin allowlist.

---

### 7. `apps/api/src/lib/bankAccountData.ts` (MODIFY — add `PontoConnectProvider`)

**Analog:** self (`GoCardlessBadProvider` class, lines 65-192).

**Class scaffolding pattern** (`bankAccountData.ts:65-93`):

```typescript
export class GoCardlessBadProvider implements BankAccountDataProvider {
  readonly name = "gocardless_bad";
  private client: Record<string, any> | null = null;

  private async getClient(): Promise<Record<string, any>> {
    if (this.client) return this.client;
    const secretId = process.env.GOCARDLESS_BAD_SECRET_ID;
    const secretKey = process.env.GOCARDLESS_BAD_SECRET_KEY;
    if (!secretId || !secretKey) {
      throw new Error("GOCARDLESS_BAD_SECRET_ID and GOCARDLESS_BAD_SECRET_KEY must be set");
    }
    try {
      const NordigenClient = (await import("nordigen-node")).default;
      this.client = new NordigenClient({ secretId, secretKey });
      await this.client!.generateToken();
      return this.client!;
    } catch (err) {
      throw new Error(`Failed to initialize GoCardless BAD client: ${err}`);
    }
  }
  // ...
}
```

**Factory pattern** (`bankAccountData.ts:194-199`):

```typescript
export function getBankAccountDataProvider(): BankAccountDataProvider {
  return new GoCardlessBadProvider();
}
```

**Phase 9 changes:**
1. **Extend `BankAccountDataProvider` interface** to add `listInstitutions(country: string): Promise<Institution[]>` and (optionally) `readonly defaultConsentDays: number` (RESEARCH Pattern 2 lines 217-237).
2. **Add `Institution` type export.**
3. **Add `PontoConnectProvider` class** parallel to `GoCardlessBadProvider`:
   - `readonly name = "ponto"`
   - `private async getClient()` reads `PONTO_CLIENT_ID`, `PONTO_CLIENT_SECRET`, `PONTO_ENVIRONMENT`
   - Uses REST + `jose` directly (no SDK exists per RESEARCH line 102)
   - Methods: `createConsent`, `listAccounts`, `getTransactions`, `renewConsent`, `revokeConsent`, `listInstitutions`
   - **Key difference from GoCardless:** Ponto issues OAuth access + refresh tokens (long-lived). Phase 9 must persist these encrypted to `bank_connections.encryptedAccessToken/encryptedRefreshToken` and refresh proactively.
4. **Modify factory** to select via env var:
   ```typescript
   export function getBankAccountDataProvider(): BankAccountDataProvider {
     const provider = process.env.BANK_DATA_PROVIDER || "ponto";
     if (provider === "gocardless_bad") return new GoCardlessBadProvider();
     return new PontoConnectProvider();
   }
   ```
5. **Remove hardcoded 90-day expiry** at `bankAccountData.ts:108-109`. Source `expiresAt` from provider response (CONTEXT line 56-58).

**Conventions to maintain:**
- `readonly name` lowercase snake_case matches `provider` enum values
- Lazy client init (cached after first call)
- Dynamic `import()` only if SDK exists — for Ponto, plain `fetch()` against REST API
- Log prefix `[BankAccountData]` (matches existing usage at lines 138, 183)

---

### 8. `apps/api/src/lib/pontoConnect.ts` (NEW — REST/OAuth client)

**Analog:** `apps/api/src/lib/gocardless.ts` (third-party API wrapper module that the provider class imports from)

**Pattern category:** Service module that encapsulates HTTP calls, exposes typed helpers, gates on env vars.

**Suggested exports:**
- `isPontoConfigured(): boolean` — mirrors `isGoCardlessConfigured()` from `gocardless.ts:7`
- `createPontoAuthorizationUrl({ state, redirectUri, scopes })` → returns redirect URL string
- `exchangeAuthorizationCode(code: string)` → `{ accessToken, refreshToken, expiresIn, organisationId }`
- `refreshAccessToken(refreshToken: string)` → fresh `{ accessToken, refreshToken, expiresIn }`
- `revokeAccess({ accessToken })` → `void`
- `listSynchronizations({ accessToken, accountId })` and `listTransactions({ accessToken, accountId, dateFrom })` → raw Ponto response
- `listAccounts({ accessToken })` → `Array<{ id, iban, currency, holderName }>`
- `listFinancialInstitutions(country: string)` → `Array<{ id, name, bic, logoUrl }>`

**Env vars to read:** `PONTO_CLIENT_ID`, `PONTO_CLIENT_SECRET`, `PONTO_ENVIRONMENT` (sandbox|production), `PONTO_REDIRECT_URI` (or `BANK_CONNECTION_REDIRECT_URL`).

**Conventions to maintain:**
- Module-level config check function (`isPontoConfigured`) used by route + provider class
- Functions return typed plain objects (no Ponto classes leak to callers)
- Log prefix `[Ponto]`

---

### 9. `apps/api/src/lib/bankOAuthState.ts` (NEW — JWT helper)

**Analog:** `apps/api/src/lib/encryption.ts` (small crypto helper module reading `AUTH_SECRET`)

**Pattern excerpt from analog** (`encryption.ts:1-32`):

```typescript
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) {
    console.log("[Encryption] WARNING: AUTH_SECRET is empty, encryption key derived from empty string");
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return { encrypted, iv: iv.toString("base64"), tag: tag.toString("base64") };
}
```

**Phase 9 module shape** (per RESEARCH Pattern 1 lines 181-205):

```typescript
import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET || "");

export async function signOAuthState(payload: {
  ownerId: string;
  requisitionId: string;
}): Promise<string> {
  return new SignJWT({ ...payload, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

export async function verifyOAuthState(token: string): Promise<{ ownerId: string; requisitionId: string }> {
  const { payload } = await jwtVerify(token, secret);
  return {
    ownerId: payload.ownerId as string,
    requisitionId: payload.requisitionId as string,
  };
}
```

**Conventions to maintain:**
- Read `AUTH_SECRET` from env at call time (matches `encryption.ts:4`)
- 10-minute TTL (CONTEXT line 79)
- Module-level constants UPPERCASE only if env-derived; lowercase for the encoded secret buffer
- Log prefix `[BankOAuthState]` for any warning logs

---

### 10. `apps/api/src/services/bankConnectionSync.ts` (NEW)

**Analog:** `apps/api/src/services/transactionMatcher.ts` (service that wraps DB + types + processes batches)

**Imports pattern** (`transactionMatcher.ts:1-4`):

```typescript
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@rentular/db";
import { payments, leases } from "@rentular/db";
import type { IncomingTransaction } from "../lib/bankAccountData";
```

**Service function signature pattern** (`transactionMatcher.ts:74-77`):

```typescript
export async function processIncomingTransactions(
  ownerId: string,
  transactions: IncomingTransaction[]
): Promise<{ matched: number; mismatched: number; unmatched: number }> {
  const db = getDb();
  // ...
}
```

**Phase 9 service shape (per RESEARCH lines 311-319 and CONTEXT line 74-75):**

```typescript
export async function syncBankConnection(connectionId: string): Promise<{
  fetched: number;
  matched: number;
  mismatched: number;
  unmatched: number;
}> {
  const db = getDb();
  const conn = await db.select().from(bankConnections).where(eq(bankConnections.id, connectionId)).limit(1);
  if (!conn[0]) throw new Error(`Connection ${connectionId} not found`);
  // Skip non-active
  if (conn[0].status !== "active") return { fetched: 0, matched: 0, mismatched: 0, unmatched: 0 };

  const provider = getBankAccountDataProvider();
  const dateFrom = conn[0].lastSyncAt
    ? conn[0].lastSyncAt.toISOString().split("T")[0]
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]; // 90-day backfill (Pitfall 8)
  const transactions = await provider.getTransactions({ accountId: conn[0].externalAccountId!, dateFrom });

  const newOnes = await importBankStatements(connectionId, transactions); // dedup via UNIQUE
  const result = await processIncomingTransactions(conn[0].ownerId, newOnes);
  await db.update(bankConnections).set({ lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(bankConnections.id, connectionId));
  return { fetched: transactions.length, ...result };
}
```

**Conventions to maintain:**
- Service exports a single named async function returning a structured result object
- DB access via `getDb()` (no top-level singleton — must be re-fetched in each function call per `transactionMatcher.ts:78`)
- Log prefix `[BankSync]`
- This service is called from BOTH the worker (`paymentCheckWorker.ts` Phase B) AND the route `POST /:id/sync` (single source of truth, per RESEARCH Pattern 5)

---

### 11. `apps/api/src/services/bankStatementImporter.ts` (NEW)

**Analog:** `apps/api/src/services/transactionMatcher.ts` (batch over transactions, structured-communication normalization)

**Normalization pattern** (`transactionMatcher.ts:32-40`):

```typescript
// Normalize: strip non-digit characters, compare 12-digit Belgian OGM-VCS
const txDigits = tx.remittanceStructured.replace(/[^0-9]/g, "");
if (txDigits.length < 12) return null;
```

**Phase 9 importer shape:**
- Function: `importBankStatements(connectionId: string, transactions: IncomingTransaction[]): Promise<IncomingTransaction[]>` — returns ONLY the newly-inserted rows (dedup by UNIQUE constraint).
- For each transaction:
  - Encrypt `counterpartyName`, `counterpartyIban`, `rawPayload` JSON via `lib/encryption.ts` `encrypt()` — store ciphertext + IV + tag in separate columns
  - Normalize `structuredCommunication` to digits-only (matches matcher's lookup format)
  - INSERT with `ON DUPLICATE KEY UPDATE id = id` (no-op for dup) — or wrap in try/catch on UNIQUE violation
  - Default `matchStatus: "unmatched"`
- Log prefix `[BankStatementImporter]`

**Why a separate service:** Per RESEARCH Pattern 3 lines 241-279, raw audit table is THE dedup safety net. Persisting BEFORE matching ensures idempotency.

---

### 12. `apps/api/src/jobs/paymentCheckWorker.ts` (MODIFY — minimal Phase B extension)

**Analog:** self.

**Existing Phase B excerpt** (`paymentCheckWorker.ts:259-318`):

```typescript
if (activeConnections.length > 0) {
  const provider = getBankAccountDataProvider();
  // ...
  for (const conn of activeConnections) {
    try {
      const dateFrom = conn.lastSyncAt
        ? conn.lastSyncAt.toISOString().split("T")[0]
        : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const transactions = await provider.getTransactions({
        accountId: conn.externalAccountId!,
        dateFrom,
      });
      if (transactions.length > 0) {
        const result = await processIncomingTransactions(conn.ownerId, transactions);
        // ...
      }
      await db.update(bankConnections).set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(eq(bankConnections.id, conn.id));
    } catch (err) {
      console.error(`[PaymentCheck] Failed to poll bank connection ${conn.id}:`, err);
      await db.update(bankConnections).set({ errorMessage: String(err), updatedAt: new Date() })
        .where(eq(bankConnections.id, conn.id));
    }
  }
}
```

**Phase 9 changes (CONTEXT line 73-76):**
1. Replace inline loop body with a call to `syncBankConnection(conn.id)` — eliminate duplication between worker and `POST /:id/sync`.
2. Change `dateFrom` fallback from `3 days` to `90 days` (Pitfall 8 — first-sync backfill).
3. Persist via `importBankStatements` BEFORE matcher.

**Phase C (consent expiry warnings)** at lines 320-398 — NO changes needed; already correctly sources `consentExpiresAt` from row and sends warnings at 7-day/1-day thresholds.

**Conventions to maintain:**
- Log prefix `[PaymentCheck]`
- Per-iteration try/catch — never let one bad connection block the loop
- Store error message in `bank_connections.errorMessage` for UI surfacing (lines 304-309)
- Always update `lastSyncAt` (or `errorMessage`) in finally semantics

---

### 13. `apps/web/app/(dashboard)/bank-connections/page.tsx` (NEW — list view)

**Analog:** `apps/web/app/(dashboard)/mandates/page.tsx`

**Imports + state pattern** (`mandates/page.tsx:1-72`):

```typescript
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { FileSignature, Plus, Search, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MandateStatusBadge } from "@/components/MandateStatusBadge";

export default function MandatesPage() {
  const t = useTranslations("mandates");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const [mandates, setMandates] = useState<MandateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // ...
}
```

**Fetch + credentials pattern** (`mandates/page.tsx:85-108`):

```typescript
const fetchMandates = useCallback(async () => {
  setLoading(true);
  setError(false);
  try {
    const res = await fetch(`${apiUrl}/api/v1/gocardless/mandates?${params.toString()}`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      setMandates(data.data || []);
    } else {
      setError(true);
    }
  } catch { setError(true); } finally { setLoading(false); }
}, [apiUrl, statusFilter, debouncedSearch]);
```

**Empty state pattern** (`mandates/page.tsx:184-198`):

```tsx
{!loading && !error && mandates.length === 0 && (
  <Card className="py-12">
    <CardContent className="flex flex-col items-center text-center">
      <FileSignature className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{t("emptyTitle")}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">{t("emptyDescription")}</p>
      <Button onClick={() => setShowSetupModal(true)}>
        <Plus className="mr-2 h-4 w-4" />
        {t("newMandate")}
      </Button>
    </CardContent>
  </Card>
)}
```

**For Phase 9 empty state (CONTEXT line 153):** Explain the €4/account/month Ibanity cost up-front, link to ToS clause, then "Connect a bank account" CTA. Use `Banknote` icon instead of `FileSignature`.

**Responsive table-to-cards pattern** (`mandates/page.tsx:204-306`): hidden md:block desktop table + md:hidden mobile card list. Phase 9 list MUST mirror this exact pattern.

**Conventions to maintain:**
- `"use client"` directive at top
- `apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"` fallback
- `fetch(..., { credentials: "include" })` for cookie-based auth
- `useTranslations("bankConnections")` namespace
- `data.data || []` envelope (API returns `{ data: [...] }`)

---

### 14. `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx` (NEW — detail view)

**Analog:** partial — no exact analog (no existing detail page in the codebase per shell listing). Closest pattern is `mandates/page.tsx` page-header structure.

**Page header pattern** (`mandates/page.tsx:114-127`):

```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="text-2xl font-semibold">{t("title")}</h1>
    <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
  </div>
  <Button onClick={() => setShowSetupModal(true)}>
    <Plus className="mr-2 h-4 w-4" />
    {t("newMandate")}
  </Button>
</div>
```

**Phase 9 detail page should show:**
- IBAN, institution name, status badge
- `lastSyncAt`, `consentExpiresAt` (with countdown)
- Recent imported `bank_statements` rows (match status badges)
- Actions: "Sync now", "Renew consent", "Revoke connection"

**Use `useParams()` from `next/navigation` to read `[id]`.**

---

### 15. `apps/web/app/(dashboard)/bank-connections/connect/page.tsx` (NEW — institution picker)

**Analog:** `apps/web/components/MandateSetupModal.tsx` (multi-step selection flow)

**Multi-step state pattern** (`MandateSetupModal.tsx:53-63`):

```typescript
const [step, setStep] = useState<"select" | "confirm" | "success" | "error">(
  tenantId ? "confirm" : "select"
);
const [tenants, setTenants] = useState<TenantOption[]>([]);
const [selectedTenantId, setSelectedTenantId] = useState(tenantId || "");
const [sending, setSending] = useState(false);
const [errorMessage, setErrorMessage] = useState("");
```

**Phase 9 connect-page flow:**
1. Step "info" — explain €4/account/month Ibanity cost + ToS disclosure (CONTEXT line 41)
2. Step "select" — pick institution from `GET /bank-connections/institutions?country=BE`
3. Step "redirect" — call `POST /bank-connections` → receive `consentLink` → `window.location.href = consentLink`
4. Callback lands on `/bank-connections/callback` (success/error from query param)

**Conventions to maintain:**
- `"use client"`
- `useTranslations("bankConnections")`
- `fetch(..., { credentials: "include" })`
- Disclose third-party Ibanity contract before final CTA (CONTEXT line 98 — required ToS clause)

---

### 16. `apps/web/app/(dashboard)/bank-connections/callback/page.tsx` (NEW)

**Analog:** partial — thin display-only page. Use empty-state pattern from `mandates/page.tsx:184-198`.

**Read query params via `useSearchParams()` from `next/navigation`:**
- Success: `?success=1` or `?connectionId=...`
- Error: `?error=access_denied` or `?error=expired_state` (CONTEXT line 154)

**Display:** localized friendly message + "Back to bank connections" link. NO business logic on this page — actual token exchange happens server-side in `GET /api/v1/bank-connections/callback`.

---

### 17. `apps/web/app/(dashboard)/layout.tsx` (MODIFY)

**Analog:** self.

**Nav array pattern** (`layout.tsx:10-21`):

```typescript
const navigationItems = [
  { key: "properties" as const, href: "/properties", iconName: "Building2" as const },
  { key: "tenants" as const, href: "/tenants", iconName: "Users" as const },
  { key: "leases" as const, href: "/leases", iconName: "FileText" as const },
  { key: "payments" as const, href: "/payments", iconName: "CreditCard" as const },
  { key: "mandates" as const, href: "/mandates", iconName: "FileSignature" as const },
  { key: "indexation" as const, href: "/indexation", iconName: "TrendingUp" as const },
  // ...
];
```

**Visibility-gate pattern** (`layout.tsx:25-32`):

```typescript
const NAV_VISIBILITY: Record<string, string[]> = {
  settings: ["co_owner", "manager", "accountant", "viewer"], // owner only
  import: ["co_owner", "manager", "accountant", "viewer"], // owner only
  tenants: ["accountant"],
  // ...
};
```

**Phase 9 actions (per CONTEXT lines 45-47):**
1. Add entry between `payments` and `mandates`:
   ```typescript
   { key: "bankConnections" as const, href: "/bank-connections", iconName: "Banknote" as const },
   ```
2. Add `bankConnections: ["co_owner", "manager", "accountant", "viewer"]` to `NAV_VISIBILITY` (owner-only, matching settings/import).

**Conventions to maintain:**
- `as const` literal narrowing on `key` and `iconName`
- Icon must exist in `lucide-react` (DashboardSidebar/MobileNav components map iconName strings to actual icons)

---

### 18. `apps/web/components/BankConnectionStatusBadge.tsx` (NEW)

**Analog:** `apps/web/components/MandateStatusBadge.tsx`

**Full pattern excerpt** (`MandateStatusBadge.tsx:1-39`):

```typescript
"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

type MandateStatus = "active" | "pending" | "pending_submission" | "submitted" | "cancelled" | "failed" | "expired" | "unknown";

const statusStyles: Record<string, string> = {
  active: "bg-green-500 text-white hover:bg-green-500",
  pending: "bg-amber-500 text-white hover:bg-amber-500",
  cancelled: "bg-gray-500 text-white hover:bg-gray-500",
  failed: "bg-destructive text-destructive-foreground hover:bg-destructive",
  expired: "bg-destructive text-destructive-foreground hover:bg-destructive",
  unknown: "bg-gray-400 text-white hover:bg-gray-400",
};

export function MandateStatusBadge({ status }: { status: string }) {
  const t = useTranslations("mandates");
  const displayStatus = status === "pending_submission" || status === "submitted" ? "pending" : status;
  return (
    <Badge className={statusStyles[status] || statusStyles.unknown}>
      {t(`status.${displayStatus}`, { defaultMessage: displayStatus })}
    </Badge>
  );
}
```

**Phase 9 BankConnectionStatusBadge:**
- Statuses (from `bankConnections.status` enum): `pending`, `active`, `expired`, `revoked`, `error`
- Color map: active=green, pending=amber, expired=destructive, revoked=gray, error=destructive
- `useTranslations("bankConnections")` namespace

---

### 19. `apps/web/components/InstitutionPicker.tsx` (NEW)

**Analog:** `apps/web/components/MandateSetupModal.tsx` (searchable select with API-fetched options)

**Pattern:** State-driven async-loaded Select dropdown with search. Read `GET /bank-connections/institutions?country=BE`, store in state, render `Select` + filter by typed search.

**Conventions to maintain:**
- `"use client"`
- shadcn `Select` components from `@/components/ui/select`
- Logo display: small `<img>` next to bank name (use `Institution.logoUrl` if available)
- `useTranslations("bankConnections")`

---

### 20. `apps/web/messages/{en,nl,fr,de}/common.json` (MODIFY × 4)

**Analog:** self (existing `mandates` and `nav` namespaces).

**`nav` namespace pattern** (`messages/en/common.json:30-42`):

```json
"nav": {
  "properties": "Properties",
  "tenants": "Tenants",
  "leases": "Leases",
  "payments": "Payments",
  "indexation": "Indexation",
  "maintenance": "Maintenance",
  "communications": "Communications",
  "settings": "Settings",
  "managers": "Managers",
  "import": "Import",
  "mandates": "Mandates"
}
```

**`mandates` namespace pattern (full feature module)** (`messages/en/common.json:829-879`):

```json
"mandates": {
  "title": "Mandates",
  "subtitle": "Manage SEPA direct debit mandates for your tenants",
  "newMandate": "New Mandate",
  "filterByStatus": "Filter by status",
  "emptyTitle": "No mandates yet",
  "emptyDescription": "Set up a SEPA direct debit mandate...",
  "loadError": "Unable to load mandates. Please check your connection and try again.",
  "status": {
    "all": "All",
    "active": "Active",
    "pending": "Pending",
    "cancelled": "Cancelled",
    "failed": "Failed",
    "expired": "Expired",
    "unknown": "Unknown"
  }
}
```

**Phase 9 additions to each of en/nl/fr/de (per CONTEXT line 93 + RESEARCH line 830):**
- `nav.bankConnections` — sidebar label
- New `bankConnections.*` namespace mirroring `mandates.*` shape:
  - `title`, `subtitle`, `connectBank`, `noConnections`, `loadError`
  - `selectInstitution`, `searchBanks`, `connectingTo`
  - `callbackSuccess`, `callbackError`, `errorAccessDenied`, `errorExpiredState`, `errorUnknown`
  - `syncNow`, `revoke`, `renewConsent`, `expiresIn`, `lastSyncedAt`
  - `pricingDisclosure` (€4/account/month Ibanity cost statement — CONTEXT line 153)
  - `tosNotice` (third-party Ibanity contract clause — CONTEXT line 98)
  - `status.{pending,active,expired,revoked,error}` sub-namespace

**Conventions to maintain:**
- All 4 locales must receive the SAME key set (verify via grep before commit)
- No emojis (per global CLAUDE.md)
- Translations should be professionally accurate Belgian-context wording

---

### 21. `.env.example` (MODIFY)

**Analog:** self (existing GoCardless section).

**Existing pattern** (`.env.example:38-43`):

```
# ----- GoCardless -----
# https://manage.gocardless.com/developers
GOCARDLESS_ACCESS_TOKEN=
GOCARDLESS_ENVIRONMENT=sandbox
GOCARDLESS_WEBHOOK_SECRET=
```

**Phase 9 additions:**

```
# ----- Bank Data Provider (PSD2 / Open Banking) -----
# Provider selection: ponto | gocardless_bad
BANK_DATA_PROVIDER=ponto
# Redirect URL registered with the chosen provider (must be HTTPS in production)
BANK_CONNECTION_REDIRECT_URL=http://localhost:4000/api/v1/bank-connections/callback

# ----- Ponto Connect (Ibanity) -----
# https://documentation.ibanity.com/ponto-connect/api
PONTO_CLIENT_ID=
PONTO_CLIENT_SECRET=
PONTO_ENVIRONMENT=sandbox
# Optional override; defaults to BANK_CONNECTION_REDIRECT_URL
PONTO_REDIRECT_URI=

# ----- GoCardless Bank Account Data (fallback / reference) -----
# https://bankaccountdata.gocardless.com/
GOCARDLESS_BAD_SECRET_ID=
GOCARDLESS_BAD_SECRET_KEY=

# ----- Bank Statement Retention (Belgian tax law) -----
# Default 7 years per CONTEXT line 99
BANK_STATEMENTS_RETENTION_DAYS=2555
```

**Conventions to maintain:**
- Section header `# ----- Name -----` with URL comment
- Empty values on right of `=`
- Sandbox default for env-environment vars

---

### 22. `apps/api/src/__tests__/bankConnections.test.ts` (NEW)

**Analog:** `apps/api/src/routes/__tests__/settings.test.ts`

**Vitest mock pattern from analog:**

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  smtpSettings: {},
  communications: {},
  eq: vi.fn(),
}));

vi.mock("bullmq", () => {
  class MockQueue { add = vi.fn().mockResolvedValue({ id: "j" }); constructor() {} }
  class MockWorker { on = vi.fn(); constructor(..._args: unknown[]) {} }
  return { Queue: MockQueue, Worker: MockWorker };
});

describe("SMS template fields in follow-up settings (NTF-05)", () => {
  it("should have SMS template fields in DEFAULT_SETTINGS", async () => {
    const { DEFAULT_SETTINGS } = await import("../../services/paymentFollowUp");
    expect(DEFAULT_SETTINGS).toHaveProperty("smsEnabled");
  });
});
```

**Phase 9 test coverage (per RESEARCH lines 676-689):**
- BANK-01 list institutions (mock provider)
- BANK-02 initiate consent persists row (mock provider, mock db)
- BANK-02 callback verifies state, updates to active
- BANK-09 state token signature verified, expiry enforced
- Statement dedup via UNIQUE constraint logic

**Conventions to maintain:**
- vitest `describe`/`it` style
- `vi.mock("@rentular/db", ...)` to avoid real DB
- `vi.mock("bullmq", ...)` to avoid Redis
- Dynamic `await import(...)` inside tests for fresh module state

---

## Shared Patterns

### Authentication / Ownership

**Source:** `apps/api/src/lib/routeAuth.ts` (lines 14-30) + `apps/api/src/routes/gocardless.ts` (lines 196-209)

**Apply to:** Every route in `bankConnections.ts` (all 8 endpoints).

```typescript
// In every route handler:
const userId = getRequiredUserId(c);

// For routes touching a specific connection (GET/:id, POST/:id/sync, POST/:id/renew, DELETE/:id):
const conn = await db.select().from(bankConnections)
  .where(and(eq(bankConnections.id, id), eq(bankConnections.ownerId, userId)))
  .limit(1);
if (!conn[0]) return c.json({ error: "Connection not found" }, 404);
```

**Note:** Bank connections are owner-scoped (NOT property-scoped). Do NOT use `getUserPropertyRole()` or `hasMinimumRole()` here — they don't apply. The visibility gate in `NAV_VISIBILITY` already restricts UI to owners.

---

### Error Handling

**Source:** `apps/api/src/routes/gocardless.ts` (lines 234-239)

**Apply to:** Every route that calls into provider, encryption, or DB.

```typescript
try {
  // ... provider call or DB operation ...
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : "Failed to <operation>";
  console.error("[BankConnections] <operation> error:", err);
  return c.json({ error: message }, 500);
}
```

**Logging convention:** Always use `[BankConnections]` prefix for route logs, `[BankSync]` for service logs, `[Ponto]` for low-level Ponto REST calls, `[BankStatementImporter]` for importer, `[BankAccountData]` for provider class — matches existing context-prefix-in-brackets convention from CLAUDE.md.

---

### Input Validation

**Source:** `apps/api/src/routes/gocardless.ts` (lines 170-186), `apps/api/src/routes/bankAccounts.ts` (lines 27-39)

**Apply to:** All POST/DELETE routes with bodies; all GET routes with query params.

```typescript
zValidator("json", z.object({
  institutionId: z.string().min(1),
}))
// or
zValidator("query", z.object({
  country: z.string().length(2).default("BE"),
}))
```

**For IBAN columns (if needed):** Reuse the `ibanSchema` from `bankAccounts.ts:27-30` — already does mod-97 + format validation.

---

### Token Encryption at Rest

**Source:** `apps/api/src/lib/encryption.ts` (lines 11-32)

**Apply to:** Every write of `accessToken`, `refreshToken`, `counterpartyName`, `counterpartyIban`, `rawPayload` JSON.

```typescript
import { encrypt, decrypt } from "../lib/encryption";

// Write
const { encrypted, iv, tag } = encrypt(accessToken);
await db.insert(bankConnections).values({
  encryptedAccessToken: encrypted,
  tokenIv: iv,
  tokenAuthTag: tag,
  // ...
});

// Read
const decrypted = decrypt(row.encryptedAccessToken!, row.tokenIv!, row.tokenAuthTag!);
```

**Never:**
- Log a token (anywhere — `console.log`, error messages, etc.)
- Return raw tokens in API responses (sanitize all list/detail endpoints to strip token columns — CONTEXT line 66)
- Store tokens cleartext

---

### CSRF

**Source:** `apps/api/src/index.ts` (lines 73-80)

**Applies automatically** to all `/bank-connections/*` routes because:
1. They're not in the `/webhooks/` or `/stripe/webhook` exemption list
2. They're added to `protectedPrefixes` (auth required)
3. The CSRF middleware runs `*` (global) and gates POST/DELETE on origin allowlist

**Exception:** `GET /bank-connections/callback` is a GET (no CSRF) — relies on the signed state JWT for integrity. This is correct per RESEARCH Pattern 1.

---

### Response Envelope

**Source:** Codebase-wide convention (all existing routes).

**Apply to:** All route responses.

```typescript
// Success (list or detail)
return c.json({ data: result });
// Success with message
return c.json({ data: result, message: "Connection revoked" });
// Created
return c.json({ data: { id, consentLink }, ... }, 201);
// Error
return c.json({ error: "Connection not found" }, 404);
return c.json({ error: "Authentication required" }, 401);
return c.json({ error: "Connection not active (status=expired)" }, 409);
return c.json({ error: "Bank data provider not configured" }, 503);
```

**Status codes (verified across `gocardless.ts`):**
- 200 OK — success
- 201 Created — POST that creates
- 400 Bad Request — invalid input (zod auto-emits)
- 401 Unauthorized — missing auth (auto via `requireAuth`)
- 403 Forbidden — role check failed
- 404 Not Found — row missing
- 409 Conflict — state machine violation (e.g. sync on inactive connection)
- 500 Internal Server Error — caught exceptions
- 503 Service Unavailable — provider not configured

---

### i18n Namespace Convention

**Source:** `apps/web/messages/en/common.json` (existing `mandates`, `nav` namespaces).

**Apply to:** All Phase 9 UI strings.

- One top-level key per feature: `bankConnections.*`
- Nested `status.*` for status labels
- Same key set in EN/NL/FR/DE — verify via `node scripts/check-i18n.js bankConnections` (per RESEARCH line 689)
- Always reference via `useTranslations("bankConnections")` hook

---

## No Analog Found

| File | Role | Data Flow | Reason / Mitigation |
|------|------|-----------|---------------------|
| `apps/web/app/(dashboard)/bank-connections/[id]/page.tsx` | detail-view component | request-response | No existing detail page in the codebase. Use `mandates/page.tsx` header pattern + `useParams()` from `next/navigation`. |
| `apps/web/app/(dashboard)/bank-connections/callback/page.tsx` | thin display page | request-response | No existing post-redirect landing page. Use `useSearchParams()` + empty-state Card pattern. |
| `apps/api/src/lib/pontoConnect.ts` | OAuth REST client | request-response | No existing OAuth-PKCE-style client in the codebase (`gocardless.ts` uses a token-only SDK). Pattern derived from RESEARCH Pattern 1 + jose docs. |

**Mitigation:** Planner should reference the equivalent sections of `RESEARCH.md` (Pattern 1 lines 181-205 for state JWT, Code Examples lines 422-589 for full route shape) when scaffolding these three files.

---

## Metadata

**Analog search scope:**
- `apps/api/src/routes/` (all 18 files)
- `apps/api/src/lib/` (all 9 files)
- `apps/api/src/services/` (all 9 files)
- `apps/api/src/jobs/` (all 8 files)
- `apps/api/src/__tests__/` (1 file)
- `packages/db/src/schema/` (all 16 files)
- `packages/db/drizzle/` (existing migration)
- `apps/web/app/(dashboard)/` (mandates, layout, settings)
- `apps/web/components/` (15 components)
- `apps/web/messages/{en,nl,fr,de}/common.json`
- `.env.example`

**Files scanned:** ~30 core files (subset Read in full; index.ts, schema barrel, drizzle migration, mandates page, gocardless route, bankAccounts route, paymentCheckWorker, encryption helper, transactionMatcher, bankAccountData, mandates i18n, bankConnections schema, dashboard layout, MandateStatusBadge, MandateSetupModal opening, env.example)

**Pattern extraction date:** 2026-05-12
