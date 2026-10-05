import { describe, it, expect } from "vitest";
import { createApiClient, readEnvConfig } from "../httpClient.js";
import type { ApiClient, ApiResult } from "../tools/types.js";
// These modules are implemented in Task 2; this test is RED until then.
import { readTools } from "../tools/read.js";
import { writeTools } from "../tools/write.js";

interface RecordedCall {
  method: "GET" | "POST";
  path: string;
  tool: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

function fakeApi(result: ApiResult): { api: ApiClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const api: ApiClient = {
    async get(path, tool, query) {
      calls.push({ method: "GET", path, tool, query });
      return result;
    },
    async post(path, tool, body) {
      calls.push({ method: "POST", path, tool, body });
      return result;
    },
  };
  return { api, calls };
}

const OK: ApiResult = { ok: true, status: 200, text: '{"ok":true}' };

describe("tool registry shape", () => {
  it("exposes exactly the seven read tools from CONTEXT", () => {
    expect(readTools.map((t) => t.name).sort()).toEqual(
      [
        "get_property",
        "indexation_status",
        "lease_ledger",
        "list_leases",
        "list_properties",
        "list_tenants",
        "payment_overview",
      ].sort(),
    );
  });

  it("exposes exactly the four write tools from CONTEXT", () => {
    expect(writeTools.map((t) => t.name).sort()).toEqual(
      ["apply_indexation", "mark_rent_paid", "record_ledger_payment", "send_reminder"].sort(),
    );
  });
});

describe("read tool -> endpoint map", () => {
  const cases: Array<{
    name: string;
    args: Record<string, unknown>;
    path: string;
    query?: Record<string, string | number | undefined>;
  }> = [
    { name: "list_properties", args: {}, path: "/properties" },
    { name: "get_property", args: { propertyId: "p1" }, path: "/properties/p1" },
    { name: "list_leases", args: {}, path: "/leases" },
    { name: "list_tenants", args: {}, path: "/tenants" },
    { name: "payment_overview", args: {}, path: "/payments/dashboard" },
    { name: "lease_ledger", args: { leaseId: "l1", months: 6 }, path: "/ledger/l1", query: { months: 6 } },
    { name: "indexation_status", args: { leaseId: "l1" }, path: "/indexation/calculate/l1" },
  ];

  for (const tc of cases) {
    it(`${tc.name} issues GET ${tc.path} with tool header`, async () => {
      const tool = readTools.find((t) => t.name === tc.name);
      expect(tool, `read tool ${tc.name} must exist`).toBeDefined();
      const { api, calls } = fakeApi(OK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await tool!.handler(tc.args as any, api);
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("GET");
      expect(calls[0].path).toBe(tc.path);
      expect(calls[0].tool).toBe(tc.name);
      if (tc.query) {
        expect(calls[0].query).toEqual(tc.query);
      }
      expect(res.isError).toBeFalsy();
    });
  }
});

describe("write tool -> endpoint map", () => {
  it("mark_rent_paid posts to /payments/mark-month-paid", async () => {
    const tool = writeTools.find((t) => t.name === "mark_rent_paid")!;
    const { api, calls } = fakeApi(OK);
    await tool.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { leaseId: "l1", month: "2026-01", method: "cash" } as any,
      api,
    );
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe("/payments/mark-month-paid");
    expect(calls[0].tool).toBe("mark_rent_paid");
    expect(calls[0].body).toMatchObject({ leaseId: "l1", month: "2026-01", method: "cash" });
  });

  it("send_reminder posts to /payments/send-reminder", async () => {
    const tool = writeTools.find((t) => t.name === "send_reminder")!;
    const { api, calls } = fakeApi(OK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tool.handler({ leaseId: "l1", month: "2026-01", level: "friendly" } as any, api);
    expect(calls[0].path).toBe("/payments/send-reminder");
    expect(calls[0].body).toMatchObject({ leaseId: "l1", month: "2026-01", level: "friendly" });
  });

  it("record_ledger_payment posts to /ledger/:leaseId/record-payment with periodMonth and amount", async () => {
    const tool = writeTools.find((t) => t.name === "record_ledger_payment")!;
    const { api, calls } = fakeApi(OK);
    await tool.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { leaseId: "l1", periodMonth: "2026-01", amount: 950 } as any,
      api,
    );
    expect(calls[0].path).toBe("/ledger/l1/record-payment");
    expect(calls[0].body).toMatchObject({ periodMonth: "2026-01", amount: 950 });
    // leaseId is a path param, not a body field
    expect((calls[0].body as Record<string, unknown>).leaseId).toBeUndefined();
  });

  it("apply_indexation posts to /indexation/apply/:leaseId with sendNotification defaulting to true", async () => {
    const tool = writeTools.find((t) => t.name === "apply_indexation")!;
    const { api, calls } = fakeApi(OK);
    await tool.handler(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { leaseId: "l1", newRent: 1000, subject: "Rent indexation", body: "Your rent is indexed." } as any,
      api,
    );
    expect(calls[0].path).toBe("/indexation/apply/l1");
    expect(calls[0].body).toMatchObject({
      newRent: 1000,
      subject: "Rent indexation",
      body: "Your rent is indexed.",
      sendNotification: true,
    });
  });
});

describe("error surfacing", () => {
  const forbidden: ApiResult = { ok: false, status: 403, text: "Token is read-only" };

  it("read tools surface a non-ok response as isError", async () => {
    const tool = readTools.find((t) => t.name === "list_properties")!;
    const { api } = fakeApi(forbidden);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await tool.handler({} as any, api);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("read-only");
  });

  it("write tools surface a 403 as isError with the API error text", async () => {
    for (const tool of writeTools) {
      const { api } = fakeApi(forbidden);
      const sample: Record<string, unknown> = {
        leaseId: "l1",
        month: "2026-01",
        level: "friendly",
        periodMonth: "2026-01",
        amount: 100,
        newRent: 1000,
        subject: "s",
        body: "b",
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await tool.handler(sample as any, api);
      expect(res.isError, `${tool.name} should surface 403 as isError`).toBe(true);
      expect(res.content[0].text).toContain("read-only");
    }
  });
});

describe("tool descriptions", () => {
  it("every write tool description mentions manager", () => {
    for (const tool of writeTools) {
      expect(tool.description.toLowerCase(), `${tool.name} description`).toContain("manager");
    }
  });

  it("send_reminder is described as channel-aware, not email only", () => {
    const tool = writeTools.find((t) => t.name === "send_reminder")!;
    expect(tool.description).toContain("preferred channel");
    expect(tool.description.toLowerCase()).not.toContain("email only");
  });
});

describe("createApiClient", () => {
  function stubFetch(capture: { url?: string; headers?: Record<string, string> }): typeof fetch {
    return (async (url: string | URL, init?: RequestInit) => {
      capture.url = String(url);
      capture.headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
  }

  it("sends Bearer + X-Rentular-Tool and builds /api/v1 from a bare base URL", async () => {
    const capture: { url?: string; headers?: Record<string, string> } = {};
    const client = createApiClient({
      baseUrl: "https://host/",
      token: "rtl_test",
      fetchImpl: stubFetch(capture),
    });
    await client.get("/properties", "list_properties");
    expect(capture.url).toBe("https://host/api/v1/properties");
    expect(capture.headers?.Authorization).toBe("Bearer rtl_test");
    expect(capture.headers?.["X-Rentular-Tool"]).toBe("list_properties");
  });

  it("does not double-prefix when the base URL already ends in /api/v1", async () => {
    const capture: { url?: string; headers?: Record<string, string> } = {};
    const client = createApiClient({
      baseUrl: "https://host/api/v1",
      token: "rtl_test",
      fetchImpl: stubFetch(capture),
    });
    await client.get("/properties", "list_properties");
    expect(capture.url).toBe("https://host/api/v1/properties");
  });

  it("returns ok false, status 0 when fetch rejects", async () => {
    const client = createApiClient({
      baseUrl: "https://host",
      token: "rtl_test",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const res = await client.get("/properties", "list_properties");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
    expect(res.text).toContain("unreachable");
  });
});

describe("readEnvConfig", () => {
  it("throws when RENTULAR_PAT lacks the rtl_ prefix", () => {
    const prev = { url: process.env.RENTULAR_API_URL, pat: process.env.RENTULAR_PAT };
    process.env.RENTULAR_API_URL = "https://host";
    process.env.RENTULAR_PAT = "nope_123";
    try {
      expect(() => readEnvConfig()).toThrow(/rtl_/);
    } finally {
      if (prev.url === undefined) delete process.env.RENTULAR_API_URL;
      else process.env.RENTULAR_API_URL = prev.url;
      if (prev.pat === undefined) delete process.env.RENTULAR_PAT;
      else process.env.RENTULAR_PAT = prev.pat;
    }
  });
});
