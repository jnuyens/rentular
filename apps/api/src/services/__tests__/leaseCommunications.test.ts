/**
 * Shape of one logged message in the contract history: who triggered it, who
 * got it (CC included) and whether it went to the tenant or the landlord.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getDb: () => null }));

import { toPastCommunication, loadPastCommunications } from "../leaseCommunications";

const base = {
  id: "c1",
  channel: "email",
  type: "payment_reminder_friendly",
  recipientName: "Tenant",
  recipientEmail: "tenant@example.com",
  recipientPhone: null,
  subject: "Reminder",
  body: "Hello",
  status: "sent",
  errorMessage: null,
  queuedAt: new Date("2026-11-04T10:00:00Z"),
  sentAt: new Date("2026-11-04T10:00:05Z"),
  createdAt: new Date("2026-11-04T10:00:00Z"),
};

describe("toPastCommunication", () => {
  it("a manual friendly reminder with the lawyer in CC", () => {
    const names = new Map([["user-1", "Jasper Nuyens"]]);
    const out = toPastCommunication(
      {
        ...base,
        metadata: { trigger: "manual", triggeredBy: "user-1", paymentId: "pay-1", cc: ["lawyer@example.be"] },
      },
      names,
    );
    expect(out).toMatchObject({
      audience: "tenant",
      trigger: "manual",
      triggeredByName: "Jasper Nuyens",
      paymentId: "pay-1",
      cc: ["lawyer@example.be"],
      sentAt: "2026-11-04T10:00:05.000Z",
    });
  });

  it("landlord notices are flagged apart", () => {
    const out = toPastCommunication(
      { ...base, type: "landlord_notification", metadata: JSON.stringify({ kind: "final_pending" }) },
      new Map(),
    );
    expect(out).toMatchObject({ audience: "landlord", kind: "final_pending", trigger: null, cc: [] });
  });

  it("old rows without metadata still show", () => {
    const out = toPastCommunication({ ...base, metadata: null, status: "failed", errorMessage: "SMTP 550" }, new Map());
    expect(out).toMatchObject({ trigger: null, triggeredByName: null, status: "failed", errorMessage: "SMTP 550" });
    expect(out).toMatchObject({ direction: "outbound", senderKnown: null, attachments: [] });
  });

  it("a tenant reply shows as inbound with sender, attachments and the unknown-sender flag", () => {
    const out = toPastCommunication(
      {
        ...base,
        type: "tenant_reply",
        direction: "inbound",
        recipientName: "Advocaat",
        recipientEmail: "someone@else.be",
        status: "delivered",
        metadata: {
          senderKnown: false,
          matchedCommunicationId: "c0",
          attachments: [{ name: "brief.pdf", size: 1234, type: "application/pdf" }],
        },
      },
      new Map(),
    );
    expect(out).toMatchObject({
      audience: "tenant",
      direction: "inbound",
      senderKnown: false,
      auto: false,
      matchedCommunicationId: "c0",
      attachments: [{ name: "brief.pdf", size: 1234, type: "application/pdf" }],
      recipientEmail: "someone@else.be",
    });
  });
});

describe("loadPastCommunications", () => {
  it("returns inbound rows in past, and counts only outbound tenant messages in the last 7 days", async () => {
    const rows = [
      { ...base, id: "in1", type: "tenant_reply", direction: "inbound", status: "delivered", metadata: { senderKnown: true } },
      { ...base, id: "out1", direction: "outbound", metadata: null },
    ];
    let totalsSql = "";
    const db = {
      select: (cols?: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            if (cols && "recent" in cols) {
              totalsSql = ((cols.recent as { queryChunks: Array<{ value?: unknown }> }).queryChunks).map((ch) => (Array.isArray(ch.value) ? ch.value.join("") : "")).join(" ");
              return Promise.resolve([{ total: 2, recent: 1 }]);
            }
            return { orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(rows) }) }) };
          },
        }),
      }),
    };
    const out = await loadPastCommunications(db as never, "lease-1", { limit: 100, offset: 0 });
    expect(out.items.map((i) => [i.id, i.direction])).toEqual([
      ["in1", "inbound"],
      ["out1", "outbound"],
    ]);
    expect(out.lastSevenDays).toBe(1);
    expect(totalsSql).toContain("'outbound'");
    // Internal notes (agreements) never count as a message to the tenant.
    expect(totalsSql).toContain("'internal_note'");
  });
});

describe("internal notes about muted reminders", () => {
  it("show as internal, with the mute end date, the note and who recorded it", () => {
    const names = new Map([["user-1", "Jasper Nuyens"]]);
    const out = toPastCommunication(
      {
        ...base,
        channel: "internal",
        type: "internal_note",
        recipientName: "Jasper Nuyens",
        recipientEmail: null,
        subject: null,
        body: "Internal note: late payment reminders muted until 04/12/2026.",
        metadata: {
          kind: "reminder_mute",
          action: "set",
          until: "2026-12-04",
          previousUntil: null,
          note: "pays with December",
          trigger: "manual",
          triggeredBy: "user-1",
        },
      },
      names,
    );
    expect(out.audience).toBe("internal");
    expect(out.triggeredByName).toBe("Jasper Nuyens");
    expect(out.mute).toEqual({
      action: "set",
      until: "2026-12-04",
      previousUntil: null,
      note: "pays with December",
    });
  });

  it("a normal message has no mute note", () => {
    expect(toPastCommunication({ ...base, metadata: null }, new Map()).mute).toBeNull();
  });
});
