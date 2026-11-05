/**
 * Shape of one logged message in the contract history: who triggered it, who
 * got it (CC included) and whether it went to the tenant or the landlord.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({ getDb: () => null }));

import { toPastCommunication } from "../leaseCommunications";

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
  });
});
