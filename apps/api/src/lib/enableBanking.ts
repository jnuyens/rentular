/**
 * Enable Banking (https://enablebanking.com) client and bank-data provider.
 *
 * Each landlord brings their own Enable Banking application ("restricted
 * mode"): they register a production application in the Enable Banking
 * Control Panel, activate it by linking their own bank account(s) there, and
 * give Rentular the application id and the RSA private key. Every API call is
 * authorised with a short-lived JWT (RS256) signed with that key.
 *
 * Flow:
 *   GET  /aspsps                 bank list (with maximum_consent_validity)
 *   POST /auth                   start authorisation, returns the bank login url
 *   POST /sessions {code}        after the redirect: session id + accounts
 *   GET  /accounts/{uid}/transactions   paged with continuation_key
 *   DELETE /sessions/{id}        revoke
 *
 * Bank notes: KBC wants the PSU headers (Psu-Ip-Address, Psu-User-Agent) and
 * Enable Banking accepts all of them or none, so both are sent on calls made
 * while the landlord is present. Unattended fetches may be capped by the bank
 * at 4 per day per account. KBC allows at most 180 days of consent.
 *
 * This module never touches the database; credentials are passed in.
 */

import { createHash, createPrivateKey, type KeyObject } from "crypto";
import { SignJWT } from "jose";
import { validateStructuredCommunication } from "@rentular/shared";
import type {
  BankAccountDataProvider,
  BankAccountInfo,
  ConsentResult,
  IncomingTransaction,
} from "./bankAccountData";

export const ENABLE_BANKING_API_BASE = "https://api.enablebanking.com";

/** JWT lifetime. Enable Banking accepts at most 24 hours. */
export const JWT_TTL_SECONDS = 3600;

/** Longest consent Rentular asks for, whatever the bank allows. */
export const MAX_CONSENT_SECONDS = 180 * 24 * 60 * 60;

export type PsuType = "personal" | "business";

export interface EnableBankingCredentials {
  applicationId: string;
  privateKeyPem: string;
}

/** The landlord's browser, for calls made while they are present. */
export interface PsuContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  psu_types?: string[];
  maximum_consent_validity?: number; // seconds
  beta?: boolean;
  bic?: string;
}

export interface EnableBankingAccount {
  uid: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  currency?: string;
  product?: string;
  details?: string;
}

export interface EnableBankingSession {
  session_id: string;
  accounts: EnableBankingAccount[];
  access?: { valid_until?: string };
  aspsp?: { name?: string; country?: string };
  psu_type?: string;
}

export interface EnableBankingTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount?: { amount?: string | number; currency?: string };
  credit_debit_indicator?: "CRDT" | "DBIT" | string;
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  debtor?: { name?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  creditor?: { name?: string | null } | null;
  creditor_account?: { iban?: string | null } | null;
  remittance_information?: string[] | null;
}

/** An error answered by the Enable Banking API, with its HTTP status. */
export class EnableBankingApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "EnableBankingApiError";
    this.status = status;
    this.code = code;
  }

  /** The application itself is rejected (wrong key, wrong id, clock off). */
  get isAppError(): boolean {
    return this.status === 401 && /jwt|token|application|signature|kid/i.test(this.message);
  }

  /** The bank session is gone or expired: the landlord has to log in again. */
  get isConsentError(): boolean {
    if (this.status === 401 || this.status === 403) return !this.isAppError;
    return /expired|revoked|closed|session/i.test(this.message) && this.status === 422;
  }
}

// ---------- JWT ----------

/** Parse a PEM private key (PKCS#8 or PKCS#1). Throws a readable error. */
export function parsePrivateKey(pem: string): KeyObject {
  const text = pem.trim();
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(text)) {
    throw new Error("This is not a PEM private key (expected -----BEGIN PRIVATE KEY-----)");
  }
  try {
    const key = createPrivateKey({ key: text, format: "pem" });
    if (key.asymmetricKeyType !== "rsa") {
      throw new Error(`Expected an RSA key, got ${key.asymmetricKeyType}`);
    }
    return key;
  } catch (err) {
    throw new Error(`Could not read the private key: ${(err as Error).message}`);
  }
}

/**
 * Sign the bearer JWT for one application: header {typ, alg RS256, kid =
 * application id}, claims {iss enablebanking.com, aud api.enablebanking.com,
 * iat, exp} with a one-hour lifetime.
 */
export async function signEnableBankingJwt(
  creds: EnableBankingCredentials,
  now: Date = new Date(),
): Promise<string> {
  const key = parsePrivateKey(creds.privateKeyPem);
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: creds.applicationId })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(iat)
    .setExpirationTime(iat + JWT_TTL_SECONDS)
    .sign(key);
}

// ---------- Request helpers ----------

/**
 * PSU headers for a call made while the landlord is present. Enable Banking
 * accepts all of them or none, so a half-filled context sends nothing.
 */
export function psuHeaders(psu?: PsuContext | null): Record<string, string> {
  const ip = psu?.ipAddress?.trim();
  const ua = psu?.userAgent?.trim();
  if (!ip || !ua) return {};
  return { "Psu-Ip-Address": ip, "Psu-User-Agent": ua };
}

/**
 * Consent end date: now plus the bank's maximum consent validity, never more
 * than 180 days. A bank without a published maximum gets 180 days.
 */
export function computeValidUntil(
  maximumConsentValiditySeconds: number | null | undefined,
  now: Date = new Date(),
): Date {
  const bankMax =
    typeof maximumConsentValiditySeconds === "number" && maximumConsentValiditySeconds > 0
      ? maximumConsentValiditySeconds
      : MAX_CONSENT_SECONDS;
  const seconds = Math.min(bankMax, MAX_CONSENT_SECONDS);
  return new Date(now.getTime() + seconds * 1000);
}

export interface AuthRequestBody {
  access: { valid_until: string };
  aspsp: { name: string; country: string };
  state: string;
  redirect_url: string;
  psu_type: PsuType;
}

export function buildAuthRequestBody(params: {
  aspspName: string;
  country: string;
  psuType: PsuType;
  state: string;
  redirectUrl: string;
  validUntil: Date;
}): AuthRequestBody {
  return {
    access: { valid_until: params.validUntil.toISOString() },
    aspsp: { name: params.aspspName, country: params.country },
    state: params.state,
    redirect_url: params.redirectUrl,
    psu_type: params.psuType,
  };
}

// ---------- Transaction mapping ----------

const OGM_PATTERN = /(?:\+{3}|\*{3})?\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*(?:\+{3}|\*{3})?/;
const TWELVE_DIGITS = /(?<!\d)(\d{12})(?!\d)/g;

/**
 * Find a Belgian structured communication in free remittance text: the
 * +++xxx/xxxx/xxxxx+++ form (also with *** or without the markers), or a bare
 * run of 12 digits, as long as the check digits are valid. Returned in the
 * +++xxx/xxxx/xxxxx+++ form.
 */
export function findStructuredCommunication(text: string): string | undefined {
  const format = (d: string) => `+++${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7)}+++`;
  const m = OGM_PATTERN.exec(text);
  if (m) {
    const digits = `${m[1]}${m[2]}${m[3]}`;
    if (validateStructuredCommunication(digits)) return format(digits);
  }
  for (const hit of text.matchAll(TWELVE_DIGITS)) {
    const digits = hit[1]!;
    if (validateStructuredCommunication(digits)) return format(digits);
  }
  return undefined;
}

/**
 * Stable id for a transaction without entry_reference, so a re-fetch of the
 * same window is recognised as a duplicate by the importer.
 */
export function fallbackTransactionId(tx: EnableBankingTransaction): string {
  const signed = signedAmount(tx);
  const iban =
    tx.credit_debit_indicator === "DBIT"
      ? tx.creditor_account?.iban || ""
      : tx.debtor_account?.iban || "";
  const remittance = (tx.remittance_information || []).join(" ");
  const key = [tx.booking_date || tx.value_date || "", signed.toFixed(2), iban, remittance].join("|");
  return `eb-${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

function signedAmount(tx: EnableBankingTransaction): number {
  const raw = Math.abs(Number(tx.transaction_amount?.amount ?? 0)) || 0;
  return tx.credit_debit_indicator === "DBIT" ? -raw : raw;
}

/**
 * Map one Enable Banking transaction to Rentular's IncomingTransaction. Only
 * booked (BOOK) transactions are imported; pending ones return null. Credits
 * are positive, debits negative.
 */
export function mapEnableBankingTransaction(
  tx: EnableBankingTransaction,
): IncomingTransaction | null {
  if (tx.status && tx.status !== "BOOK") return null;
  const isDebit = tx.credit_debit_indicator === "DBIT";
  const remittance = (tx.remittance_information || []).filter(Boolean).join(" ").trim();
  const structured = remittance ? findStructuredCommunication(remittance) : undefined;
  const counterpartName = isDebit ? tx.creditor?.name : tx.debtor?.name;
  const counterpartIban = isDebit ? tx.creditor_account?.iban : tx.debtor_account?.iban;
  return {
    transactionId: tx.entry_reference || fallbackTransactionId(tx),
    amount: signedAmount(tx),
    currency: tx.transaction_amount?.currency || "EUR",
    bookingDate: tx.booking_date || tx.value_date || tx.transaction_date || "",
    remittanceStructured: structured,
    remittanceUnstructured: remittance || undefined,
    debtorName: counterpartName || undefined,
    debtorIban: counterpartIban ? counterpartIban.replace(/\s+/g, "").toUpperCase() : undefined,
  };
}

// ---------- Client ----------

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface EnableBankingClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/** Safety stop for transaction paging. */
const MAX_PAGES = 100;

export class EnableBankingClient {
  private readonly creds: EnableBankingCredentials;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(creds: EnableBankingCredentials, opts: EnableBankingClientOptions = {}) {
    this.creds = creds;
    this.baseUrl = (opts.baseUrl || ENABLE_BANKING_API_BASE).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl || ((url, init) => fetch(url, init));
    this.now = opts.now || (() => new Date());
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | undefined>; body?: unknown; psu?: PsuContext | null } = {},
  ): Promise<T> {
    const jwt = await signEnableBankingJwt(this.creds, this.now());
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query || {})) {
      if (v !== undefined && v !== "") qs.set(k, v);
    }
    const url = `${this.baseUrl}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
      ...psuHeaders(opts.psu),
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const j = (json || {}) as { message?: string; error?: string; code?: string | number; detail?: unknown };
      const detail =
        typeof j.detail === "string" ? j.detail : j.detail ? JSON.stringify(j.detail) : "";
      const message = [j.message || j.error || res.statusText || "Request failed", detail]
        .filter(Boolean)
        .join(": ");
      throw new EnableBankingApiError(
        res.status,
        `Enable Banking ${res.status}: ${message}`,
        j.code !== undefined ? String(j.code) : undefined,
      );
    }
    return json as T;
  }

  /** Banks available in a country, optionally for one PSU type. */
  async listAspsps(country = "BE", psuType?: PsuType): Promise<Aspsp[]> {
    const r = await this.request<{ aspsps?: Aspsp[] }>("GET", "/aspsps", {
      query: { country, psu_type: psuType },
    });
    return r?.aspsps || [];
  }

  /** Start the bank login. Returns the url to send the landlord to. */
  async startAuthorization(
    body: AuthRequestBody,
    psu?: PsuContext | null,
  ): Promise<{ url: string; authorization_id: string }> {
    return this.request("POST", "/auth", { body, psu });
  }

  /** Exchange the code from the redirect for a session with its accounts. */
  async createSession(code: string, psu?: PsuContext | null): Promise<EnableBankingSession> {
    return this.request("POST", "/sessions", { body: { code }, psu });
  }

  async getSession(sessionId: string): Promise<{
    accounts?: string[];
    status?: string;
    access?: { valid_until?: string };
    aspsp?: { name?: string; country?: string };
  }> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  async getAccountDetails(accountUid: string): Promise<EnableBankingAccount> {
    return this.request("GET", `/accounts/${encodeURIComponent(accountUid)}/details`);
  }

  async getBalances(accountUid: string, psu?: PsuContext | null): Promise<unknown> {
    return this.request("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`, { psu });
  }

  /** All transactions in the window, following continuation_key until the last page. */
  async listTransactions(
    accountUid: string,
    params: { dateFrom?: string; dateTo?: string; psu?: PsuContext | null } = {},
  ): Promise<EnableBankingTransaction[]> {
    const all: EnableBankingTransaction[] = [];
    let continuationKey: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await this.request<{
        transactions?: EnableBankingTransaction[];
        continuation_key?: string | null;
      }>("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions`, {
        query: {
          date_from: params.dateFrom,
          date_to: params.dateTo,
          continuation_key: continuationKey,
        },
        psu: params.psu,
      });
      all.push(...(r?.transactions || []));
      continuationKey = r?.continuation_key || undefined;
      if (!continuationKey) break;
    }
    return all;
  }
}

// ---------- Provider ----------

/**
 * BankAccountDataProvider over one landlord's Enable Banking application.
 * The "requisition id" of the generic interface is the Enable Banking session
 * id; the institution id is the bank (ASPSP) name.
 */
export class EnableBankingProvider implements BankAccountDataProvider {
  readonly name = "enable_banking";
  private readonly client: EnableBankingClient;
  private readonly opts: {
    country: string;
    psuType: PsuType;
    maximumConsentValidity?: number | null;
    psu?: PsuContext | null;
  };

  constructor(
    client: EnableBankingClient,
    opts: {
      country?: string;
      psuType?: PsuType;
      maximumConsentValidity?: number | null;
      psu?: PsuContext | null;
    } = {},
  ) {
    this.client = client;
    this.opts = {
      country: opts.country || "BE",
      psuType: opts.psuType || "personal",
      maximumConsentValidity: opts.maximumConsentValidity,
      psu: opts.psu,
    };
  }

  async createConsent(params: {
    institutionId: string;
    redirectUrl: string;
    reference?: string;
  }): Promise<ConsentResult> {
    const validUntil = computeValidUntil(this.opts.maximumConsentValidity);
    const body = buildAuthRequestBody({
      aspspName: params.institutionId,
      country: this.opts.country,
      psuType: this.opts.psuType,
      state: params.reference || crypto.randomUUID(),
      redirectUrl: params.redirectUrl,
      validUntil,
    });
    const r = await this.client.startAuthorization(body, this.opts.psu);
    return { requisitionId: r.authorization_id, consentLink: r.url, expiresAt: validUntil };
  }

  async listAccounts(sessionId: string): Promise<BankAccountInfo[]> {
    const session = await this.client.getSession(sessionId);
    const out: BankAccountInfo[] = [];
    for (const uid of session.accounts || []) {
      const d = await this.client.getAccountDetails(uid);
      out.push({
        accountId: uid,
        iban: d.account_id?.iban || "",
        institutionId: session.aspsp?.name || "",
        institutionName: session.aspsp?.name || "",
        status: session.status || "unknown",
      });
    }
    return out;
  }

  async getTransactions(params: {
    accountId: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<IncomingTransaction[]> {
    const raw = await this.client.listTransactions(params.accountId, {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      psu: this.opts.psu,
    });
    const out: IncomingTransaction[] = [];
    for (const tx of raw) {
      const mapped = mapEnableBankingTransaction(tx);
      if (mapped) out.push(mapped);
    }
    return out;
  }

  async renewConsent(_sessionId: string): Promise<Date | null> {
    // A new consent always needs the landlord to log in at the bank again.
    return null;
  }

  async revokeConsent(sessionId: string): Promise<void> {
    await this.client.deleteSession(sessionId);
  }
}

// ---------- Configuration ----------

/**
 * The redirect url to register in the Enable Banking application. Override
 * with ENABLE_BANKING_REDIRECT_URL; otherwise derived from the Ponto callback
 * (BANK_CONNECTION_REDIRECT_URL) or the public web url, since /api/v1 is served
 * on the same host.
 */
export function getEnableBankingRedirectUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ENABLE_BANKING_REDIRECT_URL?.trim();
  if (override) return override;
  const ponto = env.BANK_CONNECTION_REDIRECT_URL?.trim();
  if (ponto && /\/bank-connections\/callback\/?$/.test(ponto)) {
    return ponto.replace(/\/bank-connections\/callback\/?$/, "/bank-connections/enable-banking/callback");
  }
  const web = (env.WEB_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${web}/api/v1/bank-connections/enable-banking/callback`;
}
