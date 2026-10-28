import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendWhatsApp } from "../whatsapp";

describe("sendWhatsApp", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.WHATSAPP_BRIDGE_URL = "http://bridge/send";
    process.env.WHATSAPP_BRIDGE_TOKEN = "t";
    process.env.WHATSAPP_SIGNATURE = "Eliza Berger";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, id: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentBody(): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  }

  it("sends plain text with the signature and no media field", async () => {
    const r = await sendWhatsApp({ to: "+32 470 00 00 00", body: "Hallo" });
    expect(r.id).toBe("abc");
    expect(sentBody()).toEqual({ to: "+32 470 00 00 00", message: "Hallo\n\nEliza Berger" });
  });

  it("passes a picture through with the text as caption", async () => {
    await sendWhatsApp({
      to: "32470000000",
      body: "De nieuwe keuken",
      media: { type: "image", url: "https://example.com/k.jpg", mimetype: "image/jpeg" },
    });
    expect(sentBody()).toEqual({
      to: "32470000000",
      message: "De nieuwe keuken\n\nEliza Berger",
      media: { type: "image", url: "https://example.com/k.jpg", mimetype: "image/jpeg" },
    });
  });

  it("sends a video without a caption when the text is empty", async () => {
    await sendWhatsApp({ to: "32470000000", body: "", media: { type: "video", base64: "AAAA" } });
    expect(sentBody()).toEqual({ to: "32470000000", message: "", media: { type: "video", base64: "AAAA" } });
  });

  it("refuses media without a url or content", async () => {
    await expect(
      sendWhatsApp({ to: "32470000000", body: "x", media: { type: "document" } }),
    ).rejects.toThrow("url or base64");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
