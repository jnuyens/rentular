import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@rentular/db", () => ({ getDb: () => null }));

const { mockProcess } = vi.hoisted(() => ({ mockProcess: vi.fn() }));
vi.mock("../../services/inboundEmail", () => ({
  processInboundEmail: mockProcess,
  defaultInboundDeps: () => ({}),
}));

import { createInboundRouter, resetInboundRateLimit, secretMatches } from "../inbound";

const RAW = "From: a@b.be\r\nTo: reply+abcdefghijklmnopqrst@rentular.com\r\n\r\nhi\r\n";

function post(headers: Record<string, string>, body: string = RAW) {
  return createInboundRouter(() => ({}) as never).request("/email", {
    method: "POST",
    headers: { "content-type": "message/rfc822", ...headers },
    body,
  });
}

describe("POST /inbound/email", () => {
  const prev = process.env.INBOUND_WEBHOOK_SECRET;
  beforeEach(() => {
    process.env.INBOUND_WEBHOOK_SECRET = "s3cret";
    resetInboundRateLimit();
    mockProcess.mockReset();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.INBOUND_WEBHOOK_SECRET;
    else process.env.INBOUND_WEBHOOK_SECRET = prev;
  });

  it("refuses a bad or missing secret with 401", async () => {
    expect((await post({ "x-inbound-secret": "wrong" })).status).toBe(401);
    expect((await post({})).status).toBe(401);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("is off (404) without a configured secret", async () => {
    delete process.env.INBOUND_WEBHOOK_SECRET;
    expect((await post({ "x-inbound-secret": "s3cret" })).status).toBe(404);
  });

  it("passes the raw message and the envelope to the service", async () => {
    mockProcess.mockResolvedValue({ status: 200, outcome: "stored", communicationId: "c1", forwarded: true });
    const res = await post({
      "x-inbound-secret": "s3cret",
      "x-inbound-recipient": "reply+abcdefghijklmnopqrst@rentular.com",
      "x-inbound-sender": "a@b.be",
    });
    expect(res.status).toBe(200);
    const [raw, envelope] = mockProcess.mock.calls[0]!;
    expect((raw as Buffer).toString()).toBe(RAW);
    expect(envelope).toEqual({ to: "reply+abcdefghijklmnopqrst@rentular.com", from: "a@b.be" });
  });

  it("answers 502 when the forward failed and 500 when processing threw", async () => {
    mockProcess.mockResolvedValueOnce({ status: 502, outcome: "forward_failed" });
    expect((await post({ "x-inbound-secret": "s3cret" })).status).toBe(502);
    mockProcess.mockRejectedValueOnce(new Error("db down"));
    expect((await post({ "x-inbound-secret": "s3cret" })).status).toBe(500);
  });

  it("rate limits per client address", async () => {
    mockProcess.mockResolvedValue({ status: 200, outcome: "duplicate" });
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await post({ "x-inbound-secret": "s3cret", "x-real-ip": "1.2.3.4" })).status;
    expect(last).toBe(429);
    expect((await post({ "x-inbound-secret": "s3cret", "x-real-ip": "5.6.7.8" })).status).toBe(200);
  });

  it("compares secrets without leaking length", () => {
    expect(secretMatches("a", "a")).toBe(true);
    expect(secretMatches("a", "ab")).toBe(false);
    expect(secretMatches(undefined, "a")).toBe(false);
  });
});
