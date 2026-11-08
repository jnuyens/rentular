/**
 * Tenant email about a contract carries the contract's reply address and a
 * Message-ID we can match replies on; landlord mail and mail without a lease
 * do not; nothing changes while the feature is off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdd, mockValues, mockReplyHeaders } = vi.hoisted(() => ({
  mockAdd: vi.fn().mockResolvedValue({ id: "job-1" }),
  mockValues: vi.fn().mockResolvedValue([]),
  mockReplyHeaders: vi.fn(),
}));

vi.mock("bullmq", () => {
  class MockQueue {
    add = mockAdd;
  }
  class MockWorker {
    on = vi.fn();
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock("@rentular/db", () => ({
  getDb: () => ({
    insert: () => ({ values: mockValues }),
    update: () => ({ set: () => ({ where: vi.fn().mockResolvedValue([]) }) }),
  }),
  communications: { id: "id" },
}));

vi.mock("../../lib/email", () => ({ sendEmail: vi.fn() }));

vi.mock("../../lib/replyAddress", () => ({ replyHeadersFor: mockReplyHeaders }));

import { queueEmail, isTenantContractEmail } from "../emailQueueWorker";

const enabled = (leaseId: string, commId: string) =>
  Promise.resolve({ replyTo: `reply+abcdefghijklmnopqrst.${commId.slice(0, 8)}@rentular.com`, messageId: `<${commId}@rentular.com>` });

describe("Reply-To on outgoing tenant email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReplyHeaders.mockImplementation(enabled);
  });

  for (const type of ["payment_reminder_friendly", "indexation_notification", "custom"] as const) {
    it(`${type} gets the contract reply address when enabled`, async () => {
      await queueEmail(
        { to: "t@x.be", subject: "S", body: "B" },
        undefined,
        { ownerId: "o1", leaseId: "lease-1", type, recipientName: "Tenant" },
      );
      expect(mockReplyHeaders).toHaveBeenCalledWith("lease-1", expect.any(String));
      const job = mockAdd.mock.calls[0]![1] as Record<string, string>;
      expect(job.replyTo).toMatch(/^reply\+abcdefghijklmnopqrst\.[0-9a-f]{8}@rentular\.com$/);
      expect(job.messageId).toBe(`<${job.communicationId}@rentular.com>`);
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ replyTo: job.replyTo, messageId: job.messageId }) }),
      );
    });
  }

  it("no Reply-To when the feature is off", async () => {
    mockReplyHeaders.mockResolvedValue(null);
    await queueEmail(
      { to: "t@x.be", subject: "S", body: "B" },
      undefined,
      { ownerId: "o1", leaseId: "lease-1", type: "custom", recipientName: "Tenant" },
    );
    const job = mockAdd.mock.calls[0]![1] as Record<string, unknown>;
    expect(job.replyTo).toBeUndefined();
    expect(job.messageId).toBeUndefined();
    const row = mockValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.metadata).toBeUndefined();
  });

  it("a resend gets fresh reply headers, not the original ones", async () => {
    mockReplyHeaders.mockResolvedValue(null);
    await queueEmail(
      { to: "t@x.be", subject: "S", body: "B" },
      undefined,
      {
        ownerId: "o1",
        leaseId: "lease-1",
        type: "custom",
        recipientName: "Tenant",
        metadata: { replyTo: "reply+old@rentular.com", messageId: "<old@rentular.com>", resendOf: "c0" },
      },
    );
    const row = mockValues.mock.calls[0]![0] as { metadata: Record<string, unknown> };
    expect(row.metadata).toEqual({ resendOf: "c0" });
  });

  it("landlord mail never gets the tenant reply address", async () => {
    for (const type of ["landlord_notification", "landlord_report", "indexation_alert"] as const) {
      await queueEmail(
        { to: "owner@x.be", subject: "S", body: "B" },
        undefined,
        { ownerId: "o1", leaseId: "lease-1", type, recipientName: "Owner" },
      );
    }
    expect(mockReplyHeaders).not.toHaveBeenCalled();
    for (const call of mockAdd.mock.calls) expect((call[1] as Record<string, unknown>).replyTo).toBeUndefined();
  });

  it("mail without a lease gets no reply address", () => {
    expect(isTenantContractEmail({ ownerId: "o1", type: "other", recipientName: "x" })).toBe(false);
    expect(isTenantContractEmail({ ownerId: "o1", leaseId: "l", type: "tenant_reply", recipientName: "x" })).toBe(false);
  });
});
