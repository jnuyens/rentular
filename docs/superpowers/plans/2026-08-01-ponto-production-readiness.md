# Ponto Connect Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Ponto Connect (Ibanity) bank integration from sandbox-only to production-ready: two applications (PPM for individuals, CPM for companies), hs2019 request signing on POST calls, and real financial-institutions auth.

**Architecture:** Introduce a `PontoModel = "ppm" | "cpm"` resolved to a per-model `PontoAppConfig` (clientId/secret + transport cert + signature cert), with the legacy single-app env vars kept as a sandbox fallback. The landlord's model is chosen at connect from a new `users.landlordType`, carried through the OAuth state JWT, persisted on `bank_connections.pontoModel`, and used for token refresh/revoke. POST calls (`/oauth2/token`, `/oauth2/revoke`, client-credentials) get an hs2019 `Signature` + `Digest` header signed with the model's signature certificate.

**Tech Stack:** Hono, Drizzle ORM (MySQL/MariaDB), `node:https` + `node:crypto`, `jose` (JWT), Next.js 15 (onboarding/settings UI), vitest.

## Global Constraints

- No em-dashes or en-dashes anywhere (prose, code, comments, commit messages). Use commas, periods, parentheses. Copied from user global rules.
- Preserve the existing stack: Next.js 15, Hono, Drizzle, MySQL/MariaDB. No new heavy dependencies (`node:crypto` covers signing).
- `pnpm lint` (tsc --noEmit) must stay green (0 errors) after every task.
- All Ibanity calls go through the existing `ibanityFetch` `node:https` helper with the mTLS agent (Node global fetch cannot present a client cert).
- Ship everything behind the sandbox fallback: when the per-model env vars are absent, behavior is identical to today (single app, no signing beyond what sandbox needs).
- Schema changes on the m1 MariaDB use hand-written idempotent DDL. `drizzle-kit push` is broken on that box (`checkConstraint` introspection error).
- Never log access/refresh tokens or private keys.
- Signature construction: hs2019, `Digest: SHA-512=<base64(sha512(body))>`, signature over the signing string with RSA-SHA256, `keyId` = the signature certificate UUID.

---

## File Structure

**New files:**
- `apps/api/src/lib/pontoSignature.ts` — hs2019 signing: `computeDigest`, `buildSignatureHeaders`.
- `apps/api/src/lib/__tests__/pontoSignature.test.ts` — offline round-trip + structural tests.
- `apps/api/src/lib/__tests__/pontoConfig.test.ts` — per-model config resolution tests.

**Modified:**
- `apps/api/src/lib/pontoConnect.ts` — `PontoModel`, `getPontoAppConfig`, per-model agent cache, signed POST helpers, `getClientAccessToken`, institutions auth fix. Model threaded through `exchangeAuthorizationCode`, `refreshAccessToken`, `revokeAccess`, `createPontoAuthorizationUrl` (redirect uri unchanged).
- `apps/api/src/lib/bankOAuthState.ts` — add `model` to `OAuthStatePayload`.
- `apps/api/src/lib/bankAccountData.ts` — `PontoConnectProvider` + `getBankAccountDataProvider` accept `model`.
- `apps/api/src/routes/bankConnections.ts` — resolve model at connect (from `users.landlordType`), persist `pontoModel` at callback, use it on renew/sync/revoke.
- `apps/api/src/services/bankConnectionSync.ts` — pass `pontoModel` to provider + refresh.
- `packages/db/src/schema/users.ts` — `landlordType`, `vatNumber`.
- `packages/db/src/schema/bankConnections.ts` — `pontoModel`.
- `apps/web/app/onboarding/page.tsx` — landlord-type radio.
- `apps/web/app/(dashboard)/settings/page.tsx` — landlord-type field.
- `.env.example` — per-model vars + fallback documentation.
- `apps/api/src/scripts/prod-ddl.sql` (or the existing DDL doc) — idempotent ALTERs.

---

## Task 1: hs2019 signature utility (offline, no Ponto account needed)

**Files:**
- Create: `apps/api/src/lib/pontoSignature.ts`
- Test: `apps/api/src/lib/__tests__/pontoSignature.test.ts`

**Interfaces:**
- Produces:
  - `computeDigest(body: string): string` returning `"SHA-512=<base64>"`.
  - `buildSignatureHeaders(input: { method: string; url: string; body: string; keyId: string; privateKeyPem: string; passphrase?: string }): { Digest: string; Signature: string; "Signature-Created": string }` — returns the headers to merge into a signed request. (Only `Digest` and `Signature` are sent; `Signature-Created` is returned for test assertions and is not attached to requests.)

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/__tests__/pontoSignature.test.ts
import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify, createHash } from "node:crypto";
import { computeDigest, buildSignatureHeaders } from "../pontoSignature";

describe("computeDigest", () => {
  it("is SHA-512 base64 of the body, prefixed", () => {
    const body = "grant_type=refresh_token";
    const expected =
      "SHA-512=" + createHash("sha512").update(body, "utf8").digest("base64");
    expect(computeDigest(body)).toBe(expected);
  });
  it("hashes the empty string for empty bodies", () => {
    const expected =
      "SHA-512=" + createHash("sha512").update("", "utf8").digest("base64");
    expect(computeDigest("")).toBe(expected);
  });
});

describe("buildSignatureHeaders", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  it("produces a Signature header whose signature verifies against the public key", () => {
    const method = "POST";
    const url = "https://api.ibanity.com/ponto-connect/oauth2/token";
    const body = "grant_type=refresh_token&refresh_token=abc";
    const keyId = "11111111-2222-3333-4444-555555555555";

    const headers = buildSignatureHeaders({
      method,
      url,
      body,
      keyId,
      privateKeyPem: privateKey,
    });

    // Digest present and correct
    expect(headers.Digest).toBe(computeDigest(body));

    // Signature header well-formed
    expect(headers.Signature).toContain(`keyId="${keyId}"`);
    expect(headers.Signature).toContain('algorithm="hs2019"');
    expect(headers.Signature).toMatch(
      /headers="\(request-target\) host digest \(created\)"/,
    );

    // Reconstruct the signing string and verify the signature
    const created = headers["Signature-Created"];
    const signingString = [
      `(request-target): post /ponto-connect/oauth2/token`,
      `host: api.ibanity.com`,
      `digest: ${headers.Digest}`,
      `(created): ${created}`,
    ].join("\n");
    const sigB64 = /signature="([^"]+)"/.exec(headers.Signature)![1];
    const ok = createVerify("RSA-SHA256")
      .update(signingString)
      .verify(publicKey, Buffer.from(sigB64, "base64"));
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/pontoSignature.test.ts`
Expected: FAIL with "Cannot find module '../pontoSignature'".

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/lib/pontoSignature.ts
/**
 * Ibanity hs2019 HTTP request signing.
 *
 * Ponto Connect requires POST requests to be signed with the application's
 * signature certificate (separate from the mTLS transport certificate). Signed
 * headers: (request-target) host digest (created). Digest is SHA-512 over the
 * raw body. keyId is the signature certificate UUID from the Developer Portal.
 *
 * SECURITY: the private key never leaves this process and is never logged.
 */
import { createHash, createSign } from "node:crypto";

export function computeDigest(body: string): string {
  const hash = createHash("sha512").update(body ?? "", "utf8").digest("base64");
  return `SHA-512=${hash}`;
}

const SIGNED_HEADERS = "(request-target) host digest (created)";

export function buildSignatureHeaders(input: {
  method: string;
  url: string;
  body: string;
  keyId: string;
  privateKeyPem: string;
  passphrase?: string;
}): { Digest: string; Signature: string; "Signature-Created": string } {
  const u = new URL(input.url);
  const digest = computeDigest(input.body);
  // Unix seconds. NOTE: uses Date.now(); acceptable in app runtime (not a
  // GSD workflow script). Ibanity tolerates small clock skew on (created).
  const created = Math.floor(Date.now() / 1000).toString();
  const requestTarget = `${input.method.toLowerCase()} ${u.pathname}${u.search}`;

  const signingString = [
    `(request-target): ${requestTarget}`,
    `host: ${u.host}`,
    `digest: ${digest}`,
    `(created): ${created}`,
  ].join("\n");

  const signer = createSign("RSA-SHA256");
  signer.update(signingString);
  signer.end();
  const signature = signer.sign(
    input.passphrase
      ? { key: input.privateKeyPem, passphrase: input.passphrase }
      : input.privateKeyPem,
    "base64",
  );

  const signatureHeader =
    `keyId="${input.keyId}",created=${created},algorithm="hs2019",` +
    `headers="${SIGNED_HEADERS}",signature="${signature}"`;

  return { Digest: digest, Signature: signatureHeader, "Signature-Created": created };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/pontoSignature.test.ts`
Expected: PASS (all 4 assertions).

- [ ] **Step 5: Confirm the signed-header set against Ibanity before production**

This is a real-world verification, not a code step: when the production signature certificate is created in the Ibanity portal, the portal shows a step-by-step signing walkthrough, and Ibanity provides an HTTP Signature Generator. Confirm the exact signed-header list and `(created)` vs `date` usage match the `SIGNED_HEADERS` constant above; if Ibanity requires `Ibanity-Idempotency-Key` on POST, add it to both the request and `SIGNED_HEADERS`. Adjust the constant and re-run the test. Leave a comment in `pontoSignature.ts` noting the constant is the single place to change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/pontoSignature.ts apps/api/src/lib/__tests__/pontoSignature.test.ts
git commit -m "feat(ponto): hs2019 request-signing utility (digest + signature header)"
```

---

## Task 2: Per-model application config resolver

**Files:**
- Modify: `apps/api/src/lib/pontoConnect.ts` (add types + resolver near the top config helpers, around lines 30-66)
- Test: `apps/api/src/lib/__tests__/pontoConfig.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type PontoModel = "ppm" | "cpm";`
  - `export interface PontoAppConfig { clientId: string; clientSecret: string; transport: { cert?: string; key?: string; pfx?: string; passphrase?: string }; signature?: { privateKeyPem: string; keyId: string; passphrase?: string } }`
  - `export function getPontoAppConfig(model: PontoModel): PontoAppConfig`

Resolution order per field: model-specific var (`PONTO_PPM_*` / `PONTO_CPM_*`), then legacy fallback (`PONTO_*`). `signature` is `undefined` when no signing key is configured (sandbox), which makes signing a no-op.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/__tests__/pontoConfig.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPontoAppConfig } from "../pontoConnect";

const SAVE = { ...process.env };
beforeEach(() => { for (const k of Object.keys(process.env)) if (k.startsWith("PONTO_")) delete process.env[k]; });
afterEach(() => { process.env = { ...SAVE }; });

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
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/pontoConfig.test.ts`
Expected: FAIL (`getPontoAppConfig` is not exported).

- [ ] **Step 3: Implement in `pontoConnect.ts`**

Add near the configuration helpers (after `isPontoConfigured`, around line 38):

```ts
export type PontoModel = "ppm" | "cpm";

export interface PontoAppConfig {
  clientId: string;
  clientSecret: string;
  transport: { cert?: string; key?: string; pfx?: string; passphrase?: string };
  signature?: { privateKeyPem: string; keyId: string; passphrase?: string };
}

function envForModel(model: PontoModel, suffix: string): string | undefined {
  const prefix = model === "ppm" ? "PONTO_PPM_" : "PONTO_CPM_";
  return process.env[`${prefix}${suffix}`] ?? process.env[`PONTO_${suffix}`];
}

export function getPontoAppConfig(model: PontoModel): PontoAppConfig {
  const clientId = envForModel(model, "CLIENT_ID") ?? "";
  const clientSecret = envForModel(model, "CLIENT_SECRET") ?? "";
  const sigKey = envForModel(model, "SIG_KEY");
  const sigKeyId = envForModel(model, "SIG_KEY_ID");
  return {
    clientId,
    clientSecret,
    transport: {
      cert: envForModel(model, "TLS_CERT"),
      key: envForModel(model, "TLS_KEY"),
      pfx: envForModel(model, "TLS_PFX"),
      passphrase: envForModel(model, "TLS_PASSPHRASE"),
    },
    signature:
      sigKey && sigKeyId
        ? {
            privateKeyPem: sigKey.includes("BEGIN")
              ? sigKey
              : readFileSync(sigKey, "utf8"),
            keyId: sigKeyId,
            passphrase: envForModel(model, "SIG_PASSPHRASE"),
          }
        : undefined,
  };
}
```

(`readFileSync` is already imported at the top of the file.)

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/pontoConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pontoConnect.ts apps/api/src/lib/__tests__/pontoConfig.test.ts
git commit -m "feat(ponto): per-model (PPM/CPM) app config resolver with sandbox fallback"
```

---

## Task 3: Thread model + signing through the POST endpoints and per-model agent

**Files:**
- Modify: `apps/api/src/lib/pontoConnect.ts` (`getIbanityAgent`, `ibanityFetch`, `postTokenEndpoint`, `exchangeAuthorizationCode`, `refreshAccessToken`, `revokeAccess`)

**Interfaces:**
- Consumes: `PontoModel`, `getPontoAppConfig`, `buildSignatureHeaders`, `computeDigest`.
- Produces (changed signatures — later tasks depend on these):
  - `exchangeAuthorizationCode(code: string, model: PontoModel, redirectUri?: string): Promise<PontoTokenResponse>`
  - `refreshAccessToken(refreshToken: string, model: PontoModel): Promise<PontoTokenResponse>`
  - `revokeAccess(token: string, model: PontoModel): Promise<void>`

- [ ] **Step 1: Make the mTLS agent per-model**

Replace the single `cachedAgent` with a per-model cache and make `getIbanityAgent` take a config. Replace lines 84-122 region:

```ts
const agentCache = new Map<PontoModel, https.Agent | null>();

function getIbanityAgent(model: PontoModel): https.Agent | undefined {
  if (agentCache.has(model)) return agentCache.get(model) ?? undefined;
  const t = getPontoAppConfig(model).transport;
  let agent: https.Agent | null = null;
  try {
    if (t.pfx) {
      agent = new https.Agent({ pfx: readFileSync(t.pfx), passphrase: t.passphrase, keepAlive: true });
    } else if (t.cert && t.key) {
      agent = new https.Agent({ cert: loadPem(t.cert), key: loadPem(t.key), passphrase: t.passphrase, keepAlive: true });
    }
  } catch (err) {
    console.error("[Ponto] Failed to load mTLS client certificate:", (err as Error).message);
    agent = null;
  }
  agentCache.set(model, agent);
  return agent ?? undefined;
}
```

- [ ] **Step 2: Give `ibanityFetch` the model + optional signing**

Change `ibanityFetch` to accept `model` and, when `opts.method` is POST and the model has a signature config, merge signed headers:

```ts
function ibanityFetch(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; model: PontoModel },
): Promise<IbanityResponse> {
  const method = opts.method || "GET";
  let headers = opts.headers ?? {};
  const sig = getPontoAppConfig(opts.model).signature;
  if (method.toUpperCase() === "POST" && sig) {
    const signed = buildSignatureHeaders({
      method,
      url,
      body: opts.body ?? "",
      keyId: sig.keyId,
      privateKeyPem: sig.privateKeyPem,
      passphrase: sig.passphrase,
    });
    headers = { ...headers, Digest: signed.Digest, Signature: signed.Signature };
  }
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`, method, headers, agent: getIbanityAgent(opts.model) },
      // ...existing response handling unchanged...
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
```

Import `buildSignatureHeaders` at the top: `import { buildSignatureHeaders } from "./pontoSignature";`

- [ ] **Step 3: Thread model through token/exchange/refresh/revoke**

- `postTokenEndpoint(body, model)`: use `getPontoAppConfig(model)` for `clientId/clientSecret` (Basic auth) and pass `model` into `ibanityFetch`.
- `exchangeAuthorizationCode(code, model, redirectUri?)`, `refreshAccessToken(refreshToken, model)`, `revokeAccess(token, model)`: add `model`, forward it.
- All remaining `ibanityFetch` GET call sites (`getJson`, `listFinancialInstitutions`, `getFinancialInstitution`) must now pass a `model` (use the connection's model, or `"ppm"` as the default for the public institutions endpoint until Task 4).

- [ ] **Step 4: Update the config-test file compile + typecheck**

Run: `pnpm --filter @rentular/api lint`
Expected: 0 errors. (Callers in `bankConnections.ts` / `bankConnectionSync.ts` are updated in Tasks 7-8; if this task is executed in isolation, temporarily pass `"ppm"` at those call sites and let Task 7/8 finalize — note this in the commit.)

- [ ] **Step 5: Run the ponto tests**

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/`
Expected: PASS (signature + config tests still green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/pontoConnect.ts
git commit -m "feat(ponto): per-model mTLS agent + signed POST token/revoke calls"
```

---

## Task 4: client_credentials token for financial-institutions

**Files:**
- Modify: `apps/api/src/lib/pontoConnect.ts` (`postTokenEndpoint`, add `getClientAccessToken`, `listFinancialInstitutions`, `getFinancialInstitution`)

**Interfaces:**
- Produces: `getClientAccessToken(model: PontoModel): Promise<string>` (cached bearer). `listFinancialInstitutions(country, model)` and `getFinancialInstitution(id, model)` gain a `model` param.

- [ ] **Step 1: Add a cached client-credentials token**

```ts
const clientTokenCache = new Map<PontoModel, { token: string; expiresAt: number }>();

export async function getClientAccessToken(model: PontoModel): Promise<string> {
  const cached = clientTokenCache.get(model);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > nowSec) return cached.token;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await postTokenEndpoint(body, model); // signed POST, Basic auth, mTLS
  clientTokenCache.set(model, { token: res.accessToken, expiresAt: nowSec + res.expiresIn });
  return res.accessToken;
}
```

- [ ] **Step 2: Use it in the institutions calls**

In `listFinancialInstitutions(country, model)` and `getFinancialInstitution(id, model)`, replace the empty-header request with a bearer:

```ts
const token = await getClientAccessToken(model);
const res = await ibanityFetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, model });
```

Guard: if `getPontoAppConfig(model).clientId` is empty (sandbox with public access), fall back to the current no-auth request so sandbox still works. Add a short comment.

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @rentular/api lint && pnpm --filter @rentular/api exec vitest run src/lib/__tests__/`
Expected: 0 errors, tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/pontoConnect.ts
git commit -m "feat(ponto): client_credentials token for financial-institutions (prod auth)"
```

---

## Task 5: Schema — landlord classification + connection model

**Files:**
- Modify: `packages/db/src/schema/users.ts`, `packages/db/src/schema/bankConnections.ts`
- Create: `apps/api/src/scripts/prod-ddl-ponto.sql` (idempotent DDL for the m1 MariaDB)

**Interfaces:**
- Produces: `users.landlordType: "individual" | "company" | null`, `users.vatNumber: string | null`, `bankConnections.pontoModel: "ppm" | "cpm" | null`.

- [ ] **Step 1: Add the user columns**

In `users.ts`, add to the users table (after `locale`):

```ts
landlordType: mysqlEnum("landlord_type", ["individual", "company"]),
vatNumber: varchar("vat_number", { length: 32 }),
```

Ensure `mysqlEnum` and `varchar` are imported (varchar already is; add `mysqlEnum` if missing).

- [ ] **Step 2: Add the connection column**

In `bankConnections.ts`, add after `provider`:

```ts
pontoModel: mysqlEnum("ponto_model", ["ppm", "cpm"]),
```

- [ ] **Step 3: Write the idempotent DDL**

```sql
-- apps/api/src/scripts/prod-ddl-ponto.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS landlord_type ENUM('individual','company') NULL,
  ADD COLUMN IF NOT EXISTS vat_number VARCHAR(32) NULL;
ALTER TABLE bank_connections
  ADD COLUMN IF NOT EXISTS ponto_model ENUM('ppm','cpm') NULL;
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @rentular/api lint`
Expected: 0 errors (Drizzle types regenerate from the schema on import).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/users.ts packages/db/src/schema/bankConnections.ts apps/api/src/scripts/prod-ddl-ponto.sql
git commit -m "feat(db): landlord_type/vat_number on users, ponto_model on bank_connections"
```

Note for deploy (not a code step): apply `prod-ddl-ponto.sql` to the `rentular` DB after `mysqldump rentular` backup.

---

## Task 6: State JWT carries the model

**Files:**
- Modify: `apps/api/src/lib/bankOAuthState.ts`
- Test: `apps/api/src/lib/__tests__/bankOAuthState.test.ts` (create if absent)

**Interfaces:**
- Produces: `OAuthStatePayload` gains `model?: "ppm" | "cpm"`; `signOAuthState` accepts it; `verifyOAuthState` returns it.

- [ ] **Step 1: Write the failing round-trip test**

```ts
// apps/api/src/lib/__tests__/bankOAuthState.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { signOAuthState, verifyOAuthState } from "../bankOAuthState";

beforeAll(() => { process.env.AUTH_SECRET = "test-secret-please-change"; });

describe("OAuth state model round-trip", () => {
  it("preserves the ponto model through sign/verify", async () => {
    const token = await signOAuthState({ ownerId: "u1", institutionId: "inst", model: "cpm" });
    const payload = await verifyOAuthState(token);
    expect(payload.ownerId).toBe("u1");
    expect(payload.model).toBe("cpm");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (type error: `model` not on payload)

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/bankOAuthState.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `model` to the payload**

In `bankOAuthState.ts`: add `model?: "ppm" | "cpm";` to `OAuthStatePayload`; include `model: payload.model` is carried automatically via `{ ...fullPayload }`; in `verifyOAuthState` return `model: payload.model === "cpm" ? "cpm" : payload.model === "ppm" ? "ppm" : undefined`.

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @rentular/api exec vitest run src/lib/__tests__/bankOAuthState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/bankOAuthState.ts apps/api/src/lib/__tests__/bankOAuthState.test.ts
git commit -m "feat(ponto): carry ponto model in the OAuth state JWT"
```

---

## Task 7: Route wiring — select, persist, and use the model

**Files:**
- Modify: `apps/api/src/routes/bankConnections.ts`

**Interfaces:**
- Consumes: `getPontoAppConfig`, `exchangeAuthorizationCode(code, model)`, `revokeAccess(token, model)`, `signOAuthState({..., model})`, `users.landlordType`, `bankConnections.pontoModel`.

- [ ] **Step 1: Add a model helper**

At the top of the route file:

```ts
import { users } from "@rentular/db";
type PontoModelT = "ppm" | "cpm";
async function resolveModel(db: ReturnType<typeof getDb>, ownerId: string): Promise<PontoModelT> {
  const row = await db.query.users.findFirst({ where: eq(users.id, ownerId), columns: { landlordType: true } });
  return row?.landlordType === "company" ? "cpm" : "ppm";
}
```

- [ ] **Step 2: Connect route (around line 116-126)** — resolve and embed the model:

```ts
const model = await resolveModel(getDb(), userId);
const state = await signOAuthState({ ownerId: userId, institutionId, model });
```

- [ ] **Step 3: Callback route (around line 182-192)** — read model from state, use it for exchange, persist on insert:

```ts
payload = await verifyOAuthState(state);
const model = payload.model ?? "ppm";
const tokens = await exchangeAuthorizationCode(code, model);
// ...in the bank_connections insert object, add:  pontoModel: model,
```

- [ ] **Step 4: Renew route (around line 422)** — carry the existing connection's model:

```ts
const state = await signOAuthState({ ownerId: userId, connectionId: conn.id, institutionId: conn.institutionId, model: conn.pontoModel ?? "ppm" });
```

- [ ] **Step 5: Revoke route (delete, around line 439)** — pass the model to `revokeAccess(token, conn.pontoModel ?? "ppm")`.

- [ ] **Step 6: Typecheck + existing route tests**

Run: `pnpm --filter @rentular/api lint && pnpm --filter @rentular/api exec vitest run src/routes/__tests__/bankConnections.test.ts`
Expected: 0 errors, tests PASS (update the test's mocked signatures if the compiler flags them).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/bankConnections.ts apps/api/src/routes/__tests__/bankConnections.test.ts
git commit -m "feat(ponto): select/persist/use ponto model across connect, callback, renew, revoke"
```

---

## Task 8: Provider + sync service model param

**Files:**
- Modify: `apps/api/src/lib/bankAccountData.ts`, `apps/api/src/services/bankConnectionSync.ts`

**Interfaces:**
- Consumes: `PontoModel`, `refreshAccessToken(token, model)`.
- Produces: `getBankAccountDataProvider({ accessToken, refreshToken, model })`; `PontoConnectProvider` stores model and uses it for any refresh.

- [ ] **Step 1: Add model to provider + factory**

In `bankAccountData.ts`, add `model?: PontoModel` to the `PontoConnectProvider` constructor tokens object and to `getBankAccountDataProvider`'s argument; default `"ppm"`.

- [ ] **Step 2: Pass model from sync**

In `bankConnectionSync.ts` (around line 137), load `pontoModel` in the connection query and pass it: `const provider = getBankAccountDataProvider({ accessToken, refreshToken, model: connection.pontoModel ?? "ppm" });`. Wherever `refreshAccessToken` is called, pass the model.

- [ ] **Step 3: Typecheck + sync/matcher tests**

Run: `pnpm --filter @rentular/api lint && pnpm --filter @rentular/api exec vitest run`
Expected: 0 errors, full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/bankAccountData.ts apps/api/src/services/bankConnectionSync.ts
git commit -m "feat(ponto): thread ponto model through provider + sync refresh"
```

---

## Task 9: Landlord-type UI + env docs

**Files:**
- Modify: `apps/web/app/onboarding/page.tsx`, `apps/web/app/(dashboard)/settings/page.tsx`, `.env.example`
- Modify (i18n): `apps/web/messages/{en,nl,fr,de}/common.json`

**Interfaces:**
- Consumes: an API field to persist `landlordType`/`vatNumber` (reuse the existing user/profile update endpoint; if none accepts these, extend `settings`/`auth` profile PATCH to accept `landlordType` + `vatNumber`).

- [ ] **Step 1: Persist path**

Confirm the endpoint that updates the user profile (search `routes/settings.ts` / `routes/auth.ts` for a user PATCH). Add `landlordType` (`"individual" | "company"`) and `vatNumber` (optional string) to its Zod schema and update. If onboarding writes user fields directly, extend that path.

- [ ] **Step 2: Onboarding radio**

In `apps/web/app/onboarding/page.tsx`, add a radio group on step 1: "I am renting as" → Individual / Company. When Company, reveal an optional VAT number input. Persist via the endpoint from Step 1. Use existing shadcn form components and the `t("onboarding.landlordType.*")` i18n keys.

- [ ] **Step 3: Settings field**

In `apps/web/app/(dashboard)/settings/page.tsx` profile tab, show the same landlord-type control so it can be changed later.

- [ ] **Step 4: i18n keys**

Add `onboarding.landlordType.{label,individual,company,vat}` (and settings equivalents) to all four locale files with translated values (EN/NL/FR/DE). No raw keys may render.

- [ ] **Step 5: `.env.example`**

Document the per-model vars and the fallback:

```
# Ponto Connect — two applications (PPM = individuals billed via Rentular, CPM = companies pay Isabel).
# If the per-model vars are unset, the legacy single-app PONTO_* vars are used for both (sandbox).
PONTO_ENVIRONMENT=production
PONTO_PPM_CLIENT_ID=
PONTO_PPM_CLIENT_SECRET=
PONTO_PPM_TLS_PFX=
PONTO_PPM_TLS_PASSPHRASE=
PONTO_PPM_SIG_KEY=
PONTO_PPM_SIG_KEY_ID=
PONTO_CPM_CLIENT_ID=
PONTO_CPM_CLIENT_SECRET=
PONTO_CPM_TLS_PFX=
PONTO_CPM_TLS_PASSPHRASE=
PONTO_CPM_SIG_KEY=
PONTO_CPM_SIG_KEY_ID=
```

- [ ] **Step 6: Build + i18n test**

Run: `pnpm --filter @rentular/web build && pnpm --filter @rentular/api exec vitest run src/__tests__/i18n-completeness.test.ts`
Expected: web build succeeds; i18n completeness test PASS (0 missing keys).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/onboarding/page.tsx "apps/web/app/(dashboard)/settings/page.tsx" apps/web/messages .env.example apps/api/src/routes
git commit -m "feat(ponto): capture landlord type (individual/company) in onboarding + settings"
```

---

## Final verification

- [ ] `pnpm lint` → 0 errors (api + web).
- [ ] `pnpm --filter @rentular/api exec vitest run` → all green.
- [ ] `pnpm --filter @rentular/web build` → success.
- [ ] Sandbox regression: with only legacy `PONTO_*` set, a sandbox connection still completes end-to-end (unchanged behavior — the fallback path).
- [ ] Production smoke (after operator prereqs: two apps + certs created, DDL applied, env wired, `PONTO_ENVIRONMENT=production`): one individual (PPM) and one company (CPM) connection each import statements.

## Self-review notes

- **Spec coverage:** two-app config (T2/T3), signing (T1/T3), institutions auth (T4), model propagation (T6/T7/T8), landlord classification (T5/T9), schema (T5), sandbox fallback (T2, final verification). All spec sections mapped.
- **Known unconfirmed detail:** the exact hs2019 signed-header set (T1 Step 5) — isolated to the `SIGNED_HEADERS` constant, verified against Ibanity's generator before production, with an offline round-trip test that holds regardless.
- **Type consistency:** `PontoModel`/`model` names, `getPontoAppConfig`, `pontoModel` column, and the changed `exchangeAuthorizationCode`/`refreshAccessToken`/`revokeAccess` signatures are used consistently across T3, T7, T8.
