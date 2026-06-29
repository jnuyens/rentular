# Testing Patterns

**Analysis Date:** 2026-06-28

## Test Framework

**Runner:**
- Vitest 4.1.2
- Config: `apps/api/vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect` from `vitest`) — no separate assertion library

**Mock Library:**
- Vitest built-in (`vi.mock`, `vi.fn`, `vi.hoisted`, `vi.spyOn`)
- MSW 2.6.0 (`msw/node`) for HTTP boundary mocking in integration tests

**Run Commands:**
```bash
pnpm --filter=@rentular/api test          # Run all tests once
pnpm --filter=@rentular/api test:watch    # Watch mode (vitest)
```

**Vitest Config** (`apps/api/vitest.config.ts`):
```ts
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 10000,
  },
});
```

Note: `globals: true` means `describe`, `it`, `expect`, and `vi` are available globally — however all existing test files import them explicitly anyway.

## Test File Organization

**Location:** Co-located `__tests__/` directories inside each source subtree

**Structure:**
```
apps/api/
  src/
    __tests__/                   # Cross-cutting / schema validation tests
      bankStatementsSchema.test.ts
      i18n-completeness.test.ts
    jobs/
      __tests__/
        emailQueueWorker.test.ts
        smsQueueWorker.test.ts
    lib/
      __tests__/
        bankOAuthState.test.ts
        email.test.ts
        encryption.test.ts
        pontoConnect.test.ts
    routes/
      __tests__/
        bankConnections.test.ts
        settings.test.ts
    services/
      __tests__/
        bankStatementImporter.test.ts
        paymentFollowUp.test.ts
  test/
    fixtures/
      ponto/                    # JSON fixtures for Ponto OAuth / API responses
        accounts-list.json
        institutions-be.json
        oauth-token-success.json
        transactions-list.json
```

**Naming:**
- Test files: `{module-under-test}.test.ts`
- Fixtures: plain JSON named after the API response they represent

## Test Structure

**Suite Organization:**
```typescript
// Explicit imports — even with globals:true, all tests import explicitly
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

describe("Feature / ticket reference (NTF-01/02/03)", () => {
  // Factory functions defined at suite level
  function makePayment(overrides: Record<string, unknown> = {}) { ... }

  it("should describe expected behavior in plain English", () => {
    const result = functionUnderTest(input);
    expect(result).toBe(expectedValue);
  });

  it("should handle edge case", () => {
    expect(functionUnderTest(edgeInput)).toBeNull();
  });
});
```

**Describe block naming convention:**
- Pure unit tests: `"Feature name (TICKET-ID)"` — e.g., `"determineReminderLevel (NTF-01/02/03)"`, `"encrypt / decrypt round-trip (NTF-07)"`
- Integration / route tests: `"Phase XX-YY / module name"` — e.g., `"Phase 09-03 / bankConnections router"`
- i18n tests: `"i18n completeness — scope (TICKET-ID)"` — e.g., `"i18n completeness — communications keys (I18N-02)"`

**Test case naming convention:**
- All `it()` strings start with `"should ..."` for unit tests
- Route integration tests use uppercase ticket prefix: `"BANK-ROUTES: GET /institutions returns 503 when Ponto not configured"`

**Setup/teardown patterns:**
- `beforeAll`: one-time env var injection, MSW server `.listen()`, DB mock seeding
- `beforeEach`: reset mocks (`vi.clearAllMocks()`, `vi.resetModules()`), reset capture arrays (`insertCalls.length = 0`), set per-test env vars
- `afterAll`: MSW server `.close()`
- `afterEach`: `vi.restoreAllMocks()` (used in `email.test.ts`)

## Mocking

**Framework:** Vitest `vi.mock()` (module-level) + MSW for HTTP

**Module boundary mocking pattern (used in all route and job tests):**
```typescript
// Mock the DB module — vi.mock hoisted to top by Vitest
vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert.mockReturnValue({ values: mockValues }),
    update: mockUpdate.mockReturnValue({ set: mockSet.mockReturnValue({ where: mockWhere }) }),
  })),
  communications: { id: "id" },
  eq: vi.fn(),
}));

// Mock BullMQ — prevents Redis connection attempt on import
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
```

**`vi.hoisted()` for cross-mock-sharing:**
```typescript
// Use vi.hoisted() when mock fn refs must be accessible both inside vi.mock factories
// AND in test assertions (vi.mock factories run before module scope).
const { mockAdd, mockInsert, mockValues } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: "job-123" }),
  mockInsert: vi.fn(),
  mockValues: vi.fn().mockResolvedValue([]),
}));
// Used in: apps/api/src/jobs/__tests__/emailQueueWorker.test.ts
//          apps/api/src/jobs/__tests__/smsQueueWorker.test.ts
```

**MSW for HTTP boundary (Ponto OAuth):**
```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const handlers = [
  http.post(/oauth2\/token$/, () => HttpResponse.json(tokenFixture)),
  http.get(/\/accounts(\?|$)/, () => HttpResponse.json(accountsFixture)),
];
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers(...handlers)); // restore defaults between tests
// Used in: apps/api/src/lib/__tests__/pontoConnect.test.ts
```

**Hono app harness for route integration tests:**
```typescript
// Build a wrapper Hono app that injects userId to bypass authMiddleware
async function buildApp(userId: string | null) {
  const { bankConnectionsRouter } = await import("../bankConnections");
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (userId) c.set("userId", userId);
    await next();
  });
  app.route("/bank-connections", bankConnectionsRouter);
  return app;
}
// Used in: apps/api/src/routes/__tests__/bankConnections.test.ts
```

**Call capture arrays for DB assertions:**
```typescript
// Capture insert calls without a real DB
const insertCalls: Array<{ table: unknown; row: Record<string, unknown> }> = [];

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return [{ insertId: 1 }];
      },
    }),
  })),
}));
// Used in: apps/api/src/routes/__tests__/bankConnections.test.ts
//          apps/api/src/services/__tests__/bankStatementImporter.test.ts
```

**What to Mock:**
- `@rentular/db` — always mock; prevents real MySQL connections during tests
- `bullmq` — always mock; prevents Redis connection attempts when importing workers
- External HTTP APIs — use MSW handlers; never let real network calls through
- `../lib/encryption`, `../lib/pontoConnect`, `../lib/bankOAuthState`, `../lib/email`, `../lib/sms` — mock at module boundaries in route/job tests
- `drizzle-orm` query helpers (`eq`, `and`, `desc`) — mock as `vi.fn(() => "EQ")` when the value is only passed through

**What NOT to Mock:**
- The module under test itself
- Core Node.js crypto (`crypto` module) — `encryption.test.ts` uses real AES-256-GCM to verify round-trips
- `jose` JWT library — `bankOAuthState.test.ts` uses the real implementation for sign/verify
- JSON fixture files — always loaded with `readFileSync` at test setup

## Fixtures and Factories

**JSON fixtures** (for MSW handlers):
```typescript
// Load once at module level using readFileSync
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "test", "fixtures", "ponto");
const tokenFixture = JSON.parse(readFileSync(join(FIXTURES_DIR, "oauth-token-success.json"), "utf8"));
// Fixtures: accounts-list.json, institutions-be.json, oauth-token-success.json, transactions-list.json
// Location: apps/api/test/fixtures/ponto/
```

**Factory functions** (for domain object construction):
```typescript
// Minimal factory with override spread — reduces boilerplate across test cases
function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: "pay-1",
    leaseId: "lease-1",
    amount: 850,
    dueDate: "2026-03-01",
    daysPastDue: 5,
    tenantName: "Jan Janssens",
    tenantEmail: "jan@example.com",
    // ... all required fields with Belgian-realistic defaults
    ...overrides,
  };
}
// Used in: apps/api/src/services/__tests__/paymentFollowUp.test.ts
```

```typescript
// Typed factory for IncomingTransaction
function buildTransaction(overrides: Partial<IncomingTransaction> = {}): IncomingTransaction {
  return {
    transactionId: "tx-001",
    amount: 850.0,
    currency: "EUR",
    bookingDate: "2026-05-01",
    remittanceStructured: "+++001/2345/67890+++",
    debtorName: "Jan Janssens",
    debtorIban: "BE71096123456769",
    ...overrides,
  };
}
// Used in: apps/api/src/services/__tests__/bankStatementImporter.test.ts
```

**Location of fixtures:**
- JSON API response fixtures: `apps/api/test/fixtures/ponto/`
- Test data factories: inline in the test file that uses them

## Coverage

**Requirements:** None enforced (no coverage threshold in `vitest.config.ts`)

**View Coverage:**
```bash
pnpm --filter=@rentular/api test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: single exported function or small set of related functions
- Files: `apps/api/src/lib/__tests__/encryption.test.ts`, `apps/api/src/lib/__tests__/bankOAuthState.test.ts`, `apps/api/src/services/__tests__/paymentFollowUp.test.ts`
- Approach: call function directly with controlled inputs; assert return value or thrown error

**Integration Tests (route-level):**
- Scope: full Hono router with all dependencies mocked at module boundary
- Files: `apps/api/src/routes/__tests__/bankConnections.test.ts`, `apps/api/src/routes/__tests__/settings.test.ts`
- Approach: `buildApp()` harness injects userId; uses `app.request()` to make HTTP calls; asserts status codes and JSON shape

**Integration Tests (HTTP client):**
- Scope: lib functions that make real HTTP calls (Ponto OAuth)
- Files: `apps/api/src/lib/__tests__/pontoConnect.test.ts`
- Approach: MSW intercepts HTTP calls; fixture JSON substitutes real API responses

**Schema Validation Tests:**
- Scope: Drizzle schema object shape (confirms DB columns are exported)
- Files: `apps/api/src/__tests__/bankStatementsSchema.test.ts`
- Approach: `Object.keys(bankStatements)` enumeration against required column list

**i18n Completeness Tests:**
- Scope: All four locale message files have matching keys
- Files: `apps/api/src/__tests__/i18n-completeness.test.ts`
- Approach: `flattenKeys()` on each locale JSON, diff against English reference

**E2E Tests:** Not detected (no Playwright test config or test files, though Playwright is a dependency used for the Smovin scraper)

## Common Patterns

**Async Testing:**
```typescript
it("should parse the OAuth token response", async () => {
  const result = await exchangeAuthorizationCode("dummy-code");
  expect(result.accessToken).toBe("fixture-access-token-AAAA1111");
});
```

**Error / rejection testing:**
```typescript
it("rejects a token signed with a different secret", async () => {
  await expect(verifyOAuthState(badToken)).rejects.toThrow();
});

it("should throw when tag is tampered with", () => {
  expect(() => decrypt(encrypted, iv, tamperedTag)).toThrow();
});
```

**Module reset for isolated dynamic imports:**
```typescript
// When the module under test initializes state on import (e.g. queue singletons),
// use vi.resetModules() in beforeEach and dynamic import inside each test.
beforeEach(() => {
  vi.resetModules();
});

it("should insert a communications record when meta is provided", async () => {
  const { queueEmail } = await import("../emailQueueWorker");
  // ...
});
```

**Partial assertion with expect.objectContaining:**
```typescript
expect(mockValues).toHaveBeenCalledWith(
  expect.objectContaining({
    ownerId: "owner-1",
    channel: "email",
    status: "queued",
  }),
);
```

**Environment variable injection:**
```typescript
// Inject env vars in beforeAll (stable across suite) or beforeEach (needs reset)
beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-encryption-suite";
});

beforeEach(() => {
  process.env.SMTP_HOST = "mail.test.com";
  process.env.WEB_URL = "http://localhost:3000";
});
```

**Error code simulation (MySQL ER_DUP_ENTRY):**
```typescript
// Simulate typed database errors by attaching .code to Error instances
const err = new Error("ER_DUP_ENTRY: ...") as Error & { code?: string };
err.code = "ER_DUP_ENTRY";
throw err;
// Used in: apps/api/src/services/__tests__/bankStatementImporter.test.ts
```

---

*Testing analysis: 2026-06-28*
