/**
 * Ponto Connect (Ibanity) REST + OAuth client.
 *
 * No first-party Node SDK exists (RESEARCH line 102) — this module wraps
 * the public REST endpoints behind typed helpers so the PontoConnectProvider
 * class (and the callback route in Plan 03) never have to deal with the
 * JSON:API envelope or the URL-encoded token endpoint directly.
 *
 * Trust boundary: outbound HTTPS to api.ibanity.com (T-09-02-07 mitigation —
 * base URLs are hardcoded, not user-supplied).
 *
 * SECURITY: NEVER interpolate accessToken or refreshToken into a log line
 * (T-09-02-03 mitigation). If a diagnostic is unavoidable, log only the first
 * 4 chars + ellipsis.
 */

import https from "node:https";
import { readFileSync } from "node:fs";
import { buildSignatureHeaders } from "./pontoSignature";

// Ponto Connect API/token host is the same for both environments — the client
// certificate selects sandbox vs production (verified via Ibanity's Postman
// collection + live probes; no `/sandbox` path segment). The browser-facing
// AUTHORIZATION host DOES differ: sandbox uses sandbox-authorization.myponto.com
// (redirects to the sandbox login portal), production uses authorization.myponto.com.
const SANDBOX_API_BASE = "https://api.ibanity.com/ponto-connect";
const PRODUCTION_API_BASE = "https://api.ibanity.com/ponto-connect";
const SANDBOX_AUTH_BASE = "https://sandbox-authorization.myponto.com";
const PRODUCTION_AUTH_BASE = "https://authorization.myponto.com";

const DEFAULT_SCOPES = ["ai", "pi", "name", "offline_access"];

// ---------- Configuration helpers ----------

export function isPontoConfigured(): boolean {
  return (
    !!process.env.PONTO_CLIENT_ID && !!process.env.PONTO_CLIENT_SECRET
  );
}

// ---------- Two-application (PPM/CPM) configuration ----------
//
// Isabel sets an application to either PPM (individuals billed via Rentular) or
// CPM (companies pay Isabel directly), never both, so production needs two apps
// with their own clientId/secret + certificates. Resolution per field: the
// model-specific var (PONTO_PPM_* / PONTO_CPM_*), then the legacy PONTO_* var as
// a sandbox fallback so single-app dev/sandbox keeps working unchanged.

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

export function getPontoBaseUrls(): { apiBase: string; authBase: string } {
  const isProduction = process.env.PONTO_ENVIRONMENT === "production";
  return {
    apiBase: isProduction ? PRODUCTION_API_BASE : SANDBOX_API_BASE,
    authBase: isProduction ? PRODUCTION_AUTH_BASE : SANDBOX_AUTH_BASE,
  };
}

export function getRedirectUri(): string {
  const override = process.env.PONTO_REDIRECT_URI;
  if (override) return override;
  return (
    process.env.BANK_CONNECTION_REDIRECT_URL ||
    "http://localhost:4000/api/v1/bank-connections/callback"
  );
}

function requireClientCredentials(
  model: PontoModel = "ppm"
): { id: string; secret: string } {
  const cfg = getPontoAppConfig(model);
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      "[Ponto] client id and secret must be set (PONTO_[PPM_|CPM_]CLIENT_ID / _CLIENT_SECRET)"
    );
  }
  return { id: cfg.clientId, secret: cfg.clientSecret };
}

// ---------- mTLS client certificate (Ibanity requires mutual TLS) ----------
//
// Every call to api.ibanity.com/(sandbox/)ponto-connect requires a client
// certificate at the TLS layer — without it the handshake fails with
// "tlsv13 alert certificate required". Ibanity issues the certificate
// (sandbox: generated for you behind a passphrase; production: after go-live).
// The transport certificate is needed for every call. Request SIGNING (the
// separate signature certificate) is required for POST requests in production
// (Ibanity support, 2026-07-31); GET reads may stay unsigned. See ibanityFetch.
//
// Config is per model (PONTO_PPM_* / PONTO_CPM_*), falling back to legacy
// PONTO_* for sandbox (see getPontoAppConfig):
//   *_TLS_CERT        client certificate (PEM path or inline)
//   *_TLS_KEY         client private key (PEM, may be passphrase-encrypted)
//   *_TLS_PASSPHRASE  passphrase for the key / pfx
//   *_TLS_PFX         alternative: PKCS#12 bundle path (instead of cert+key)

const agentCache = new Map<PontoModel, https.Agent | null>();

function loadPem(value: string): string | Buffer {
  // inline PEM (contains a BEGIN header) vs. a filesystem path
  return value.includes("BEGIN") ? value : readFileSync(value);
}

function getIbanityAgent(model: PontoModel): https.Agent | undefined {
  if (agentCache.has(model)) return agentCache.get(model) ?? undefined;
  const t = getPontoAppConfig(model).transport;
  let agent: https.Agent | null = null;
  try {
    if (t.pfx) {
      agent = new https.Agent({
        pfx: readFileSync(t.pfx),
        passphrase: t.passphrase,
        keepAlive: true,
      });
    } else if (t.cert && t.key) {
      agent = new https.Agent({
        cert: loadPem(t.cert),
        key: loadPem(t.key),
        passphrase: t.passphrase,
        keepAlive: true,
      });
    }
  } catch (err) {
    console.error(
      "[Ponto] Failed to load mTLS client certificate:",
      (err as Error).message
    );
    agent = null;
  }
  agentCache.set(model, agent);
  return agent ?? undefined;
}

export function isPontoMtlsConfigured(): boolean {
  return (
    !!process.env.PONTO_TLS_PFX ||
    (!!process.env.PONTO_TLS_CERT && !!process.env.PONTO_TLS_KEY)
  );
}

interface IbanityResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Node's global fetch() cannot present a client certificate, so every
 * api.ibanity.com call goes through this node:https helper with the mTLS agent
 * attached. Mirrors the subset of the fetch Response API the callers use.
 */
function ibanityFetch(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    model: PontoModel;
  }
): Promise<IbanityResponse> {
  const method = opts.method || "GET";
  let headers = opts.headers ?? {};
  // Ponto Connect requires POST requests to be signed in production. When the
  // model has a signature certificate configured, attach the hs2019 headers.
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
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method,
        headers,
        agent: getIbanityAgent(opts.model),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: res.statusMessage || "",
            json: async () => JSON.parse(buf.toString("utf8")),
            text: async () => buf.toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ---------- Public types ----------

export interface PontoTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
}

export interface PontoAccount {
  id: string;
  iban: string;
  currency: string;
  holderName?: string;
  authorizationExpirationExpectedAt?: string;
}

export interface PontoTransaction {
  id: string;
  valueDate?: string;
  executionDate?: string;
  amount: number;
  currency: string;
  counterpartName?: string;
  counterpartReference?: string;
  remittanceInformation?: string;
  remittanceInformationType?: string;
  description?: string;
  raw: Record<string, unknown>;
}

export interface PontoInstitution {
  id: string;
  name: string;
  bic: string;
  country: string;
  logoUrl?: string;
}

// ---------- OAuth authorization URL ----------

export function createPontoAuthorizationUrl(params: {
  state: string;
  redirectUri?: string;
  scopes?: string[];
  model?: PontoModel;
}): string {
  const { id } = requireClientCredentials(params.model ?? "ppm");
  const { authBase } = getPontoBaseUrls();
  const redirectUri = params.redirectUri || getRedirectUri();
  const scopes = params.scopes || DEFAULT_SCOPES;

  const qs = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    state: params.state,
  });

  return `${authBase}/oauth2/auth?${qs.toString()}`;
}

// ---------- OAuth token endpoint ----------

async function postTokenEndpoint(
  body: URLSearchParams,
  model: PontoModel
): Promise<PontoTokenResponse> {
  const { id, secret } = requireClientCredentials(model);
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}/oauth2/token`;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await ibanityFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    model,
  });

  if (!res.ok) {
    throw new Error(
      `[Ponto] POST /oauth2/token failed: ${res.status} ${res.statusText}`
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    tokenType: json.token_type,
    scope: json.scope,
  };
}

export async function exchangeAuthorizationCode(
  code: string,
  model: PontoModel = "ppm",
  redirectUri?: string
): Promise<PontoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri || getRedirectUri(),
  });
  return postTokenEndpoint(body, model);
}

export async function refreshAccessToken(
  refreshToken: string,
  model: PontoModel = "ppm"
): Promise<PontoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postTokenEndpoint(body, model);
}

export async function revokeAccess(
  token: string,
  model: PontoModel = "ppm"
): Promise<void> {
  const { id, secret } = requireClientCredentials(model);
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}/oauth2/revoke`;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const body = new URLSearchParams({ token });

  const res = await ibanityFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    model,
  });

  if (!res.ok) {
    throw new Error(
      `[Ponto] POST /oauth2/revoke failed: ${res.status} ${res.statusText}`
    );
  }
}

// ---------- client_credentials service token (financial-institutions) ----------
//
// The financial-institutions endpoints need a real bearer in production. We mint
// a client_credentials access token per model and cache it until shortly before
// expiry. In sandbox with no client credentials configured, callers skip auth
// (institutionsAuthHeaders returns {}), preserving the public-endpoint behavior.

const clientTokenCache = new Map<
  PontoModel,
  { token: string; expiresAt: number }
>();

export async function getClientAccessToken(model: PontoModel): Promise<string> {
  const cached = clientTokenCache.get(model);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > nowSec) return cached.token;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await postTokenEndpoint(body, model);
  clientTokenCache.set(model, {
    token: res.accessToken,
    expiresAt: nowSec + res.expiresIn,
  });
  return res.accessToken;
}

async function institutionsAuthHeaders(
  model: PontoModel
): Promise<Record<string, string>> {
  const cfg = getPontoAppConfig(model);
  // Sandbox / no credentials: the public endpoint is reachable without auth.
  if (!cfg.clientId || !cfg.clientSecret) return {};
  return { Authorization: `Bearer ${await getClientAccessToken(model)}` };
}

// ---------- Authenticated API helpers ----------

async function getJson<T>(
  path: string,
  accessToken: string,
  model: PontoModel
): Promise<T> {
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}${path}`;
  const res = await ibanityFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    model,
  });
  if (!res.ok) {
    throw new Error(
      `[Ponto] GET ${path} failed: ${res.status} ${res.statusText}`
    );
  }
  return (await res.json()) as T;
}

interface JsonApiItem<TAttrs> {
  type: string;
  id: string;
  attributes: TAttrs;
}

interface JsonApiList<TAttrs> {
  data: Array<JsonApiItem<TAttrs>>;
}

interface AccountAttrs {
  reference?: string;
  referenceType?: string;
  description?: string;
  currency?: string;
  subtype?: string;
  holderName?: string;
  authorizationExpirationExpectedAt?: string;
}

interface TransactionAttrs {
  valueDate?: string;
  executionDate?: string;
  amount?: number;
  currency?: string;
  counterpartName?: string;
  counterpartReference?: string;
  remittanceInformation?: string;
  remittanceInformationType?: string;
  description?: string;
}

interface InstitutionAttrs {
  name?: string;
  bic?: string;
  country?: string;
  logoUrl?: string;
}

export async function listAccounts(params: {
  accessToken: string;
  model?: PontoModel;
}): Promise<PontoAccount[]> {
  const json = await getJson<JsonApiList<AccountAttrs>>(
    "/accounts",
    params.accessToken,
    params.model ?? "ppm"
  );
  return (json.data || []).map((item) => ({
    id: item.id,
    iban:
      (item.attributes?.referenceType || "").toUpperCase() === "IBAN"
        ? item.attributes?.reference || ""
        : item.attributes?.reference || "",
    currency: item.attributes?.currency || "EUR",
    holderName: item.attributes?.holderName,
    authorizationExpirationExpectedAt:
      item.attributes?.authorizationExpirationExpectedAt,
  }));
}

export async function listTransactions(params: {
  accessToken: string;
  accountId: string;
  dateFrom?: string;
  model?: PontoModel;
}): Promise<PontoTransaction[]> {
  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set("filter[executionDate][gte]", params.dateFrom);
  const path =
    `/accounts/${encodeURIComponent(params.accountId)}/transactions` +
    (qs.toString() ? `?${qs.toString()}` : "");
  const json = await getJson<JsonApiList<TransactionAttrs>>(
    path,
    params.accessToken,
    params.model ?? "ppm"
  );
  return (json.data || []).map((item) => ({
    id: item.id,
    valueDate: item.attributes?.valueDate,
    executionDate: item.attributes?.executionDate,
    amount: Number(item.attributes?.amount ?? 0),
    currency: item.attributes?.currency || "EUR",
    counterpartName: item.attributes?.counterpartName,
    counterpartReference: item.attributes?.counterpartReference,
    remittanceInformation: item.attributes?.remittanceInformation,
    remittanceInformationType: item.attributes?.remittanceInformationType,
    description: item.attributes?.description,
    raw: item as unknown as Record<string, unknown>,
  }));
}

export async function listFinancialInstitutions(
  country: string,
  model: PontoModel = "ppm"
): Promise<PontoInstitution[]> {
  const { apiBase } = getPontoBaseUrls();
  const qs = new URLSearchParams({ "filter[country]": country });
  const url = `${apiBase}/financial-institutions?${qs.toString()}`;
  const res = await ibanityFetch(url, {
    method: "GET",
    headers: { ...(await institutionsAuthHeaders(model)), Accept: "application/json" },
    model,
  });
  if (!res.ok) {
    throw new Error(
      `[Ponto] GET /financial-institutions failed: ${res.status} ${res.statusText}`
    );
  }
  const json = (await res.json()) as JsonApiList<InstitutionAttrs>;
  return (json.data || []).map((item) => ({
    id: item.id,
    name: item.attributes?.name || "",
    bic: item.attributes?.bic || "",
    country: item.attributes?.country || country,
    logoUrl: item.attributes?.logoUrl,
  }));
}

export async function getFinancialInstitution(
  id: string,
  model: PontoModel = "ppm",
): Promise<PontoInstitution | null> {
  if (!id) return null;
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}/financial-institutions/${encodeURIComponent(id)}`;
  const res = await ibanityFetch(url, {
    method: "GET",
    headers: { ...(await institutionsAuthHeaders(model)), Accept: "application/json" },
    model,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `[Ponto] GET /financial-institutions/${id} failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as { data?: JsonApiItem<InstitutionAttrs> };
  const item = json.data;
  if (!item) return null;
  return {
    id: item.id,
    name: item.attributes?.name || "",
    bic: item.attributes?.bic || "",
    country: item.attributes?.country || "",
    logoUrl: item.attributes?.logoUrl,
  };
}
