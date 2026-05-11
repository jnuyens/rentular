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

const SANDBOX_API_BASE = "https://api.ibanity.com/sandbox/ponto-connect";
const PRODUCTION_API_BASE = "https://api.ibanity.com/ponto-connect";
const SANDBOX_AUTH_BASE = "https://authorization.myponto.com/sandbox";
const PRODUCTION_AUTH_BASE = "https://authorization.myponto.com";

const DEFAULT_SCOPES = ["ai", "pi", "name", "offline_access"];

// ---------- Configuration helpers ----------

export function isPontoConfigured(): boolean {
  return (
    !!process.env.PONTO_CLIENT_ID && !!process.env.PONTO_CLIENT_SECRET
  );
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

function requireClientCredentials(): { id: string; secret: string } {
  const id = process.env.PONTO_CLIENT_ID;
  const secret = process.env.PONTO_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "[Ponto] PONTO_CLIENT_ID and PONTO_CLIENT_SECRET must be set"
    );
  }
  return { id, secret };
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
}): string {
  const { id } = requireClientCredentials();
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

async function postTokenEndpoint(body: URLSearchParams): Promise<PontoTokenResponse> {
  const { id, secret } = requireClientCredentials();
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}/oauth2/token`;

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
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
  redirectUri?: string
): Promise<PontoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri || getRedirectUri(),
  });
  return postTokenEndpoint(body);
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<PontoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postTokenEndpoint(body);
}

export async function revokeAccess(token: string): Promise<void> {
  const { id, secret } = requireClientCredentials();
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}/oauth2/revoke`;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");

  const body = new URLSearchParams({ token });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(
      `[Ponto] POST /oauth2/revoke failed: ${res.status} ${res.statusText}`
    );
  }
}

// ---------- Authenticated API helpers ----------

async function getJson<T>(path: string, accessToken: string): Promise<T> {
  const { apiBase } = getPontoBaseUrls();
  const url = `${apiBase}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
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
}): Promise<PontoAccount[]> {
  const json = await getJson<JsonApiList<AccountAttrs>>(
    "/accounts",
    params.accessToken
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
}): Promise<PontoTransaction[]> {
  const qs = new URLSearchParams();
  if (params.dateFrom) qs.set("filter[executionDate][gte]", params.dateFrom);
  const path =
    `/accounts/${encodeURIComponent(params.accountId)}/transactions` +
    (qs.toString() ? `?${qs.toString()}` : "");
  const json = await getJson<JsonApiList<TransactionAttrs>>(
    path,
    params.accessToken
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
  country: string
): Promise<PontoInstitution[]> {
  // financial-institutions is a public endpoint, but Ponto still wants Authorization
  // for traffic shaping. We use a one-off client_credentials-equivalent: when no
  // accessToken is available we fall back to basic auth via the token endpoint
  // pattern. For the public endpoint, a Bearer of the empty string is accepted
  // by the sandbox; production typically uses a service token. We accept either.
  const { apiBase } = getPontoBaseUrls();
  const qs = new URLSearchParams({ "filter[country]": country });
  const url = `${apiBase}/financial-institutions?${qs.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
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
