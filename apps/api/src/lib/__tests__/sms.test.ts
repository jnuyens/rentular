import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The provider is created lazily and cached per module load, so each test uses a
// fresh module (resetModules) with its own env and a stubbed global fetch.
describe("smsgateway provider", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("SMS_")) delete process.env[k];
    }
    // These tests check raw provider output; disable the sender prefix.
    process.env.SMS_SENDER_PREFIX = "";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POSTs the default sms-gate.app body with basic auth", async () => {
    process.env.SMS_PROVIDER = "smsgateway";
    process.env.SMS_GATEWAY_URL = "http://phone.local:8080/message";
    process.env.SMS_GATEWAY_USERNAME = "sms";
    process.env.SMS_GATEWAY_PASSWORD = "pw";

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "abc123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendSms } = await import("../sms");
    const res = await sendSms({ to: "+32470123456", body: "Hello" });

    expect(res.messageId).toBe("abc123");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("http://phone.local:8080/message");
    const headers = call[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("sms:pw").toString("base64")
    );
    expect(JSON.parse(call[1].body as string)).toEqual({
      message: "Hello",
      phoneNumbers: ["+32470123456"],
    });
  });

  it("prepends the sender prefix by default", async () => {
    delete process.env.SMS_SENDER_PREFIX; // fall back to the default prefix
    process.env.SMS_PROVIDER = "smsgateway";
    process.env.SMS_GATEWAY_URL = "http://phone.local:8080/message";
    process.env.SMS_GATEWAY_USERNAME = "sms";
    process.env.SMS_GATEWAY_PASSWORD = "pw";

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "x" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendSms } = await import("../sms");
    await sendSms({ to: "+32470123456", body: "Hello" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(call[1].body as string).message).toBe("[Rentular] Hello");
  });

  it("supports a custom template + api-key header (httpSMS style) and escapes JSON", async () => {
    process.env.SMS_PROVIDER = "smsgateway";
    process.env.SMS_GATEWAY_URL = "https://api.httpsms.com/v1/messages/send";
    process.env.SMS_GATEWAY_API_KEY = "KEY";
    process.env.SMS_GATEWAY_API_KEY_HEADER = "x-api-key";
    process.env.SMS_GATEWAY_FROM = "+32480000000";
    process.env.SMS_GATEWAY_BODY_TEMPLATE =
      '{"content":{{message}},"from":{{from}},"to":{{to}}}';

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { id: "h1" } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { sendSms } = await import("../sms");
    const res = await sendSms({ to: "+32470123456", body: 'He said "hi"\nbye' });

    expect(res.messageId).toBe("h1");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("KEY");
    // Quotes/newlines in the message must not break the JSON body.
    expect(JSON.parse(call[1].body as string)).toEqual({
      content: 'He said "hi"\nbye',
      from: "+32480000000",
      to: "+32470123456",
    });
  });

  it("throws on a non-2xx response", async () => {
    process.env.SMS_PROVIDER = "smsgateway";
    process.env.SMS_GATEWAY_URL = "http://x/y";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );
    const { sendSms } = await import("../sms");
    await expect(sendSms({ to: "+32470123456", body: "x" })).rejects.toThrow(
      /SMS gateway error: 500/
    );
  });
});
