/**
 * Route tests for the landlord-chosen indexation start date (effectiveDate).
 *
 * The calculation itself is mocked: computeIndexationCore returns a fixed core
 * with four offered due dates. These tests check that the routes accept only
 * those dates, carry the chosen one into the letter, the indexation record and
 * the response, and store the legal anniversary as lastIndexationDate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const selectQueue: unknown[][] = [];
const insertValues: unknown[] = [];
const updateSets: unknown[] = [];

vi.mock("@rentular/db", () => {
  const table = (name: string) => new Proxy({ __table: name }, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : `${name}.${String(k)}`) });
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: async (v: unknown) => {
        insertValues.push(v);
        return [{ affectedRows: 1 }];
      },
    }),
    update: () => ({
      set: (s: unknown) => {
        updateSets.push(s);
        return { where: async () => [{ affectedRows: 1 }] };
      },
    }),
  };
  return {
    getDb: vi.fn(() => fakeDb),
    leases: table("leases"),
    properties: table("properties"),
    users: table("users"),
    indexationRecords: table("indexation_records"),
    healthIndexValues: table("health_index_values"),
    leaseTenants: table("lease_tenants"),
    tenants: table("tenants"),
    propertyManagers: table("property_managers"),
  };
});

vi.mock("drizzle-orm", () => {
  const passThrough = (...args: unknown[]) => ({ args });
  return {
    eq: vi.fn(passThrough),
    and: vi.fn(passThrough),
    desc: vi.fn(passThrough),
    gte: vi.fn(passThrough),
    lte: vi.fn(passThrough),
    inArray: vi.fn(passThrough),
    isNotNull: vi.fn(passThrough),
  };
});

vi.mock("../../lib/propertyAccess", () => ({
  ROLE_LEVEL: {},
  hasMinimumRole: vi.fn(() => true),
  requirePropertyAccess: vi.fn(),
  getAccessiblePropertyIds: vi.fn(async () => ["prop-1"]),
  getAccessiblePropertyIdsForRole: vi.fn(async () => ["prop-1"]),
  getUserPropertyRole: vi.fn(async () => "owner"),
  canAccessDomain: vi.fn(() => true),
}));

vi.mock("../../services/healthIndex", () => ({
  getLatestHealthIndex: vi.fn(async () => null),
  isHealthIndexStale: vi.fn(async () => false),
  findClosestHealthIndexMonth: vi.fn(async () => null),
}));

const core = {
  currentIndex: 135,
  currentIndexMonth: "2026-04",
  unrestrictedNewRent: 700,
  newRent: 700,
  epcIndexationFactor: 1,
  epcRestricted: false,
  correctionApplied: false,
  correctionMonth: null,
  formulaNote: undefined,
  effectiveDate: "2026-11-01",
  indexationDate: "2026-05-01",
  effectiveDateOptions: ["2026-11-01", "2026-10-01", "2026-09-01", "2026-08-01"],
  latestIndex: 135,
  latestIndexMonth: "2026-09",
  newRentAtLatest: 700,
  canApply: true,
  applicableFrom: "2020-05-01",
  nextAnniversary: "2027-05-01",
  currentIndexPublished: true,
};

vi.mock("../../services/indexationCalc", () => ({
  computeIndexationCore: vi.fn(async () => ({ ...core })),
}));

const generateDefaultIndexationEmail = vi.fn((_params: { effectiveDate: string }) => ({
  subject: "s",
  body: "b",
}));

vi.mock("../../services/indexationEmail", () => ({
  generateDefaultIndexationEmail: (params: { effectiveDate: string }) =>
    generateDefaultIndexationEmail(params),
  buildIndexationTemplateVars: vi.fn(() => ({})),
}));

vi.mock("../../lib/leaseRecipients", () => ({
  getLeaseEmailRecipients: vi.fn(async () => ({
    primary: { firstName: "A", lastName: "B", language: "nl" },
    to: "a@b.be",
    cc: [],
    ccEmails: [],
  })),
}));

const queueEmail = vi.fn(async () => "job-1");
vi.mock("../../jobs/emailQueueWorker", () => ({
  queueEmail: (...args: unknown[]) => queueEmail(...(args as [])),
}));

vi.mock("../../lib/email", () => ({
  renderTemplate: vi.fn((t: string) => t),
}));

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

const leaseRow = {
  id: "lease-1",
  ownerId: "owner-1",
  propertyId: "prop-1",
  type: "residential_long",
  region: "flanders",
  startDate: "2019-05-01",
  status: "active",
  indexationEnabled: true,
  indexationBaseMonth: "2019-04",
  indexationBaseIndex: "108.98",
  baseRent: "675.00",
  monthlyRent: "675.00",
  currentMonthlyRent: null,
  paymentDay: 1,
  signingDate: null,
  paymentMethod: null,
  lastIndexationDate: null,
};

const propertyRow = {
  id: "prop-1",
  name: "Home",
  epcLabel: "C",
  street: "Kerkstraat",
  streetNumber: "1",
  box: null,
  postalCode: "2000",
  city: "Antwerpen",
  country: "BE",
};

const ownerRow = { name: "Owner", email: "owner@example.be", whatsappNumber: null };

function queueLeaseRows(): void {
  selectQueue.push([leaseRow], [propertyRow], [ownerRow]);
}

async function buildApp() {
  const { indexationRouter } = await import("../indexation");
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId", "owner-1");
    await next();
  });
  app.route("/indexation", indexationRouter);
  return app;
}

function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const applyBody = { newRent: 700, subject: "s", body: "b", sendNotification: false };

beforeEach(() => {
  selectQueue.length = 0;
  insertValues.length = 0;
  updateSets.length = 0;
  generateDefaultIndexationEmail.mockClear();
  queueEmail.mockClear();
});

describe("POST /indexation/apply/:leaseId effectiveDate", () => {
  it("uses the chosen date for the record and keeps the anniversary on the lease", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/apply/lease-1", { ...applyBody, effectiveDate: "2026-09-01" });
    expect(res.status).toBe(200);
    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toMatchObject({ effectiveDate: "2026-09-01" });
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({ lastIndexationDate: "2026-05-01" });
    const json = (await res.json()) as { effectiveDate: string; indexationDate: string };
    expect(json.effectiveDate).toBe("2026-09-01");
    expect(json.indexationDate).toBe("2026-05-01");
  });

  it("falls back to the default date when none is chosen", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/apply/lease-1", applyBody);
    expect(res.status).toBe(200);
    expect(insertValues[0]).toMatchObject({ effectiveDate: "2026-11-01" });
    expect(updateSets[0]).toMatchObject({ lastIndexationDate: "2026-05-01" });
  });

  it("rejects a date outside the offered options without writing", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/apply/lease-1", { ...applyBody, effectiveDate: "2026-07-01" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("2026-11-01, 2026-10-01, 2026-09-01, 2026-08-01");
    expect(insertValues).toHaveLength(0);
    expect(updateSets).toHaveLength(0);
  });

  it("rejects a malformed date", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/apply/lease-1", { ...applyBody, effectiveDate: "not-a-date" });
    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
    expect(updateSets).toHaveLength(0);
  });

  it("puts the chosen date in the tenant letter", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/apply/lease-1", {
      ...applyBody,
      sendNotification: true,
      effectiveDate: "2026-10-01",
    });
    expect(res.status).toBe(200);
    expect(queueEmail).toHaveBeenCalledTimes(1);
    expect(insertValues[0]).toMatchObject({ effectiveDate: "2026-10-01" });
  });
});

describe("POST /indexation/preview/:leaseId effectiveDate", () => {
  it("passes the chosen date to the letter", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/preview/lease-1", { effectiveDate: "2026-10-01" });
    expect(res.status).toBe(200);
    expect(generateDefaultIndexationEmail).toHaveBeenCalledTimes(1);
    expect(generateDefaultIndexationEmail.mock.calls[0]![0].effectiveDate).toBe("2026-10-01");
    const json = (await res.json()) as { effectiveDate: string };
    expect(json.effectiveDate).toBe("2026-10-01");
  });

  it("rejects a date outside the offered options", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await post(app, "/indexation/preview/lease-1", { effectiveDate: "2026-07-01" });
    expect(res.status).toBe(400);
    expect(generateDefaultIndexationEmail).not.toHaveBeenCalled();
  });
});

describe("GET /indexation/calculate/:leaseId", () => {
  it("exposes the anniversary and the offered start dates", async () => {
    const app = await buildApp();
    queueLeaseRows();
    const res = await app.request("/indexation/calculate/lease-1");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { indexationDate: string; effectiveDateOptions: string[] };
    expect(json.indexationDate).toBe("2026-05-01");
    expect(json.effectiveDateOptions).toHaveLength(4);
  });
});
