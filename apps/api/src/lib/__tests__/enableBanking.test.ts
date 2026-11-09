import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "crypto";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import {
  EnableBankingApiError,
  EnableBankingClient,
  EnableBankingProvider,
  MAX_CONSENT_SECONDS,
  buildAuthRequestBody,
  computeValidUntil,
  fallbackTransactionId,
  findStructuredCommunication,
  getEnableBankingRedirectUrl,
  mapEnableBankingTransaction,
  parsePrivateKey,
  psuHeaders,
  signEnableBankingJwt,
  type EnableBankingTransaction,
} from "../enableBanking";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PKCS1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const APP_ID = "0f8c7c4e-1111-2222-3333-444455556666";
const creds = { applicationId: APP_ID, privateKeyPem: PKCS8 };

describe("signEnableBankingJwt", () => {
  it("signs RS256 with kid = application id and the Enable Banking claims", async () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const jwt = await signEnableBankingJwt(creds, now);
    const header = decodeProtectedHeader(jwt);
    expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: APP_ID });
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe("enablebanking.com");
    expect(claims.aud).toBe("api.enablebanking.com");
    expect(claims.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(86400);
    expect(claims.exp! - claims.iat!).toBe(3600);
    const verified = await jwtVerify(jwt, publicKey, {
      issuer: "enablebanking.com",
      audience: "api.enablebanking.com",
      currentDate: now,
    });
    expect(verified.protectedHeader.kid).toBe(APP_ID);
  });

  it("accepts a PKCS#1 RSA key too", async () => {
    const jwt = await signEnableBankingJwt({ applicationId: APP_ID, privateKeyPem: PKCS1 });
    expect(decodeProtectedHeader(jwt).alg).toBe("RS256");
  });

  it("rejects something that is not a private key", () => {
    expect(() => parsePrivateKey("hello")).toThrow(/not a PEM private key/);
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => parsePrivateKey(pub)).toThrow();
  });
});

describe("PSU headers", () => {
  it("sends both or none", () => {
    expect(psuHeaders({ ipAddress: "1.2.3.4", userAgent: "Mozilla" })).toEqual({
      "Psu-Ip-Address": "1.2.3.4",
      "Psu-User-Agent": "Mozilla",
    });
    expect(psuHeaders({ ipAddress: "1.2.3.4" })).toEqual({});
    expect(psuHeaders({ userAgent: "Mozilla" })).toEqual({});
    expect(psuHeaders(null)).toEqual({});
  });
});

describe("consent validity", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  it("uses the bank maximum when shorter than 180 days", () => {
    const ninety = 90 * 86400;
    expect(computeValidUntil(ninety, now).getTime() - now.getTime()).toBe(ninety * 1000);
  });
  it("caps at 180 days", () => {
    expect(computeValidUntil(400 * 86400, now).getTime() - now.getTime()).toBe(MAX_CONSENT_SECONDS * 1000);
    expect(computeValidUntil(null, now).getTime() - now.getTime()).toBe(MAX_CONSENT_SECONDS * 1000);
  });
  it("builds the /auth body", () => {
    const validUntil = computeValidUntil(180 * 86400, now);
    expect(
      buildAuthRequestBody({
        aspspName: "KBC",
        country: "BE",
        psuType: "personal",
        state: "st",
        redirectUrl: "https://x/cb",
        validUntil,
      }),
    ).toEqual({
      access: { valid_until: validUntil.toISOString() },
      aspsp: { name: "KBC", country: "BE" },
      state: "st",
      redirect_url: "https://x/cb",
      psu_type: "personal",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("EnableBankingClient", () => {
  it("POST /auth carries bearer JWT and PSU headers, capped valid_until", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/aspsps")) return jsonResponse({ aspsps: [] });
      return jsonResponse({ url: "https://bank/login", authorization_id: "auth-1" });
    });
    const client = new EnableBankingClient(creds, { fetchImpl });
    const provider = new EnableBankingProvider(client, {
      psuType: "personal",
      maximumConsentValidity: 400 * 86400,
      psu: { ipAddress: "9.9.9.9", userAgent: "UA" },
    });
    const before = Date.now();
    const r = await provider.createConsent({ institutionId: "KBC", redirectUrl: "https://x/cb", reference: "s" });
    expect(r.consentLink).toBe("https://bank/login");
    expect(r.requisitionId).toBe("auth-1");
    const authCall = calls.find((c) => c.url.endsWith("/auth"))!;
    const headers = authCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer ey/);
    expect(headers["Psu-Ip-Address"]).toBe("9.9.9.9");
    expect(headers["Psu-User-Agent"]).toBe("UA");
    const body = JSON.parse(String(authCall.init.body));
    const validMs = new Date(body.access.valid_until).getTime() - before;
    expect(validMs).toBeLessThanOrEqual(MAX_CONSENT_SECONDS * 1000 + 5000);
    expect(validMs).toBeGreaterThan(MAX_CONSENT_SECONDS * 1000 - 5000);
  });

  it("omits PSU headers when only one value is known", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ session_id: "s", accounts: [] }));
    const client = new EnableBankingClient(creds, { fetchImpl });
    await client.createSession("code", { ipAddress: "1.1.1.1" });
    const headers = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["Psu-Ip-Address"]).toBeUndefined();
    expect(headers["Psu-User-Agent"]).toBeUndefined();
  });

  it("pages transactions with continuation_key until the last page", async () => {
    const urls: string[] = [];
    const pages = [
      { transactions: [{ entry_reference: "a", status: "BOOK" }], continuation_key: "k1" },
      { transactions: [{ entry_reference: "b", status: "BOOK" }], continuation_key: "k2" },
      { transactions: [{ entry_reference: "c", status: "BOOK" }] },
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse(pages.shift());
    });
    const client = new EnableBankingClient(creds, { fetchImpl });
    const txs = await client.listTransactions("uid-1", { dateFrom: "2026-10-01" });
    expect(txs.map((t) => t.entry_reference)).toEqual(["a", "b", "c"]);
    expect(urls[0]).toContain("date_from=2026-10-01");
    expect(urls[0]).not.toContain("continuation_key");
    expect(urls[1]).toContain("continuation_key=k1");
    expect(urls[2]).toContain("continuation_key=k2");
  });

  it("turns error answers into EnableBankingApiError", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "Invalid JWT" }, 401));
    const client = new EnableBankingClient(creds, { fetchImpl });
    const err = await client.listAspsps().catch((e) => e);
    expect(err).toBeInstanceOf(EnableBankingApiError);
    expect(err.status).toBe(401);
    expect(err.message).toContain("Invalid JWT");
    expect(err.isAppError).toBe(true);
    expect(err.isConsentError).toBe(false);

    const expired = new EnableBankingApiError(401, "Enable Banking 401: Session expired");
    expect(expired.isConsentError).toBe(true);
    expect(new EnableBankingApiError(403, "Forbidden").isConsentError).toBe(true);
    expect(new EnableBankingApiError(500, "boom").isConsentError).toBe(false);
  });
});

describe("transaction mapping", () => {
  const credit: EnableBankingTransaction = {
    entry_reference: "ref-1",
    transaction_amount: { amount: "850.00", currency: "EUR" },
    credit_debit_indicator: "CRDT",
    status: "BOOK",
    booking_date: "2026-11-02",
    debtor: { name: "Jan Peeters" },
    debtor_account: { iban: "be68 5390 0754 7034" },
    remittance_information: ["+++090/9337/55493+++"],
  };

  it("maps a booked credit with structured communication", () => {
    expect(mapEnableBankingTransaction(credit)).toEqual({
      transactionId: "ref-1",
      amount: 850,
      currency: "EUR",
      bookingDate: "2026-11-02",
      remittanceStructured: "+++090/9337/55493+++",
      remittanceUnstructured: "+++090/9337/55493+++",
      debtorName: "Jan Peeters",
      debtorIban: "BE68539007547034",
    });
  });

  it("makes debits negative and uses the creditor as counterpart", () => {
    const m = mapEnableBankingTransaction({
      ...credit,
      credit_debit_indicator: "DBIT",
      creditor: { name: "Water" },
      creditor_account: { iban: "BE00 1111 2222 3333" },
    })!;
    expect(m.amount).toBe(-850);
    expect(m.debtorName).toBe("Water");
    expect(m.debtorIban).toBe("BE00111122223333");
  });

  it("skips pending transactions", () => {
    expect(mapEnableBankingTransaction({ ...credit, status: "PDNG" })).toBeNull();
  });

  it("finds the structured communication in free text or as 12 digits", () => {
    expect(findStructuredCommunication("Huur nov 090/9337/55493 dank")).toBe("+++090/9337/55493+++");
    expect(findStructuredCommunication("ref 090933755493")).toBe("+++090/9337/55493+++");
    expect(findStructuredCommunication("***090/9337/55493***")).toBe("+++090/9337/55493+++");
    // Wrong check digits: not a structured communication.
    expect(findStructuredCommunication("090933755400")).toBeUndefined();
    expect(findStructuredCommunication("rent november")).toBeUndefined();
  });

  it("gives a stable id when entry_reference is missing", () => {
    const noRef = { ...credit, entry_reference: null };
    const a = mapEnableBankingTransaction(noRef)!.transactionId;
    const b = mapEnableBankingTransaction({ ...noRef })!.transactionId;
    expect(a).toBe(b);
    expect(a).toMatch(/^eb-[0-9a-f]{40}$/);
    expect(fallbackTransactionId({ ...noRef, booking_date: "2026-11-03" })).not.toBe(a);
  });
});

describe("redirect url", () => {
  it("can be set explicitly", () => {
    expect(getEnableBankingRedirectUrl({ ENABLE_BANKING_REDIRECT_URL: "https://a/cb" } as NodeJS.ProcessEnv)).toBe(
      "https://a/cb",
    );
  });
  it("follows the Ponto callback host", () => {
    expect(
      getEnableBankingRedirectUrl({
        BANK_CONNECTION_REDIRECT_URL: "https://rent.example.org/api/v1/bank-connections/callback",
      } as NodeJS.ProcessEnv),
    ).toBe("https://rent.example.org/api/v1/bank-connections/enable-banking/callback");
  });
  it("falls back to the web url", () => {
    expect(getEnableBankingRedirectUrl({ WEB_URL: "https://www.rentular.com/" } as NodeJS.ProcessEnv)).toBe(
      "https://www.rentular.com/api/v1/bank-connections/enable-banking/callback",
    );
  });
});
