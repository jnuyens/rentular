/**
 * Every outgoing message is one communications row: queued before the send,
 * then sent or failed. Signed landlord action links never reach the log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  sendWhatsApp: vi.fn<(...a: unknown[]) => Promise<{ id: string }>>(),
}));

vi.mock("@rentular/db", () => ({
  communications: { id: "id" },
  getDb: () => ({
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        h.inserts.push(v);
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          h.updates.push(s);
        },
      }),
    }),
  }),
}));
vi.mock("drizzle-orm", () => ({ eq: () => null }));
vi.mock("../whatsapp", () => ({ sendWhatsApp: (...a: unknown[]) => h.sendWhatsApp(...a) }));
vi.mock("../email", () => ({ sendEmail: vi.fn() }));

import { sendWhatsAppLogged } from "../communicationLog";
import { redactActionLinks } from "../../services/landlordLateEmail";

const log = {
  ownerId: "owner-1",
  leaseId: "lease-1",
  type: "payment_reminder_formal" as const,
  recipientName: "Tenant",
  metadata: { trigger: "schedule", paymentId: "pay-1" },
};

beforeEach(() => {
  h.inserts = [];
  h.updates = [];
  h.sendWhatsApp.mockReset();
});

describe("sendWhatsAppLogged", () => {
  it("logs one queued row on the lease, then marks it sent with the bridge id", async () => {
    h.sendWhatsApp.mockResolvedValue({ id: "wa-1" });
    await sendWhatsAppLogged({ to: "+32470000000", body: "Hello" }, log);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      channel: "whatsapp",
      leaseId: "lease-1",
      recipientPhone: "+32470000000",
      body: "Hello",
      status: "queued",
      metadata: { trigger: "schedule", paymentId: "pay-1" },
    });
    expect(h.updates).toEqual([
      expect.objectContaining({ status: "sent", externalId: "wa-1", errorMessage: null }),
    ]);
  });

  it("records the error and rethrows when the send fails", async () => {
    h.sendWhatsApp.mockRejectedValue(new Error("bridge down"));
    await expect(sendWhatsAppLogged({ to: "+32470000000", body: "Hello" }, log)).rejects.toThrow(
      "bridge down",
    );
    expect(h.inserts).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({ status: "failed", errorMessage: "Error: bridge down" });
  });
});

describe("redactActionLinks", () => {
  it("removes signed landlord action links and keeps the rest", () => {
    const body =
      "Mark as paid: https://www.rentular.com/api/v1/landlord-action/eyJhbGciOi.J9-abc_def\n" +
      "Record it: https://www.rentular.com/payments";
    expect(redactActionLinks(body)).toBe("Mark as paid: [link]\nRecord it: https://www.rentular.com/payments");
  });
});
