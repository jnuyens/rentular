import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { readFileSync } from "fs";
import { join } from "path";

import {
  isPontoConfigured,
  createPontoAuthorizationUrl,
  exchangeAuthorizationCode,
  listAccounts,
  listTransactions,
  listFinancialInstitutions,
} from "../pontoConnect";

const FIXTURES_DIR = join(__dirname, "..", "..", "..", "test", "fixtures", "ponto");

const tokenFixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "oauth-token-success.json"), "utf8")
);
const accountsFixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "accounts-list.json"), "utf8")
);
const transactionsFixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "transactions-list.json"), "utf8")
);
const institutionsFixture = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "institutions-be.json"), "utf8")
);

// MSW handlers — match by URL suffix so sandbox/production base URLs both hit.
const handlers = [
  http.post(/oauth2\/token$/, () => HttpResponse.json(tokenFixture)),
  http.get(/financial-institutions(\?|$)/, () =>
    HttpResponse.json(institutionsFixture)
  ),
  http.get(/\/accounts\/[^/]+\/transactions(\?|$)/, () =>
    HttpResponse.json(transactionsFixture)
  ),
  http.get(/\/accounts(\?|$)/, () => HttpResponse.json(accountsFixture)),
];

const server = setupServer(...handlers);

beforeAll(() => {
  process.env.PONTO_CLIENT_ID = "test-client";
  process.env.PONTO_CLIENT_SECRET = "test-secret";
  process.env.PONTO_ENVIRONMENT = "sandbox";
  process.env.BANK_CONNECTION_REDIRECT_URL =
    "http://localhost:4000/api/v1/bank-connections/callback";
  server.listen({ onUnhandledRequest: "error" });
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  server.resetHandlers(...handlers);
});

describe("pontoConnect REST/OAuth client (Phase 9 / 09-02)", () => {
  it("isPontoConfigured returns true when both env vars are set", () => {
    expect(isPontoConfigured()).toBe(true);
  });

  it("createPontoAuthorizationUrl builds a sandbox URL with required params", () => {
    const url = createPontoAuthorizationUrl({ state: "abc.def.ghi" });
    expect(url.startsWith("https://authorization.myponto.com")).toBe(true);
    expect(url).toContain("client_id=test-client");
    expect(url).toContain("state=abc.def.ghi");
    expect(url).toContain("response_type=code");
  });

  it("exchangeAuthorizationCode parses the OAuth token response", async () => {
    const result = await exchangeAuthorizationCode("dummy-code");
    expect(result.accessToken).toBe("fixture-access-token-AAAA1111");
    expect(result.refreshToken).toBe("fixture-refresh-token-BBBB2222");
    expect(result.expiresIn).toBe(1799);
  });

  it("listFinancialInstitutions returns the 6 BE banks", async () => {
    const list = await listFinancialInstitutions("BE");
    expect(list).toHaveLength(6);
    for (const inst of list) {
      expect(typeof inst.name).toBe("string");
      expect(typeof inst.bic).toBe("string");
    }
  });

  it("listAccounts returns the single fixture account with the IBAN populated", async () => {
    const accounts = await listAccounts({ accessToken: "fixture-access-token-AAAA1111" });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].iban).toBe("BE71096123456769");
  });

  it("listTransactions returns the 2 fixture transactions with structured remittance preserved", async () => {
    const txs = await listTransactions({
      accessToken: "fixture-access-token-AAAA1111",
      accountId: "fixture-account-id-CCCC3333",
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].remittanceInformation).toContain("001/2345/67890");
  });
});
