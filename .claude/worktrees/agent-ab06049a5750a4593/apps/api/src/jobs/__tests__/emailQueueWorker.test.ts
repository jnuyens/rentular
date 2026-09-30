import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdd, mockInsert, mockUpdate, mockValues, mockSet, mockWhere } = vi.hoisted(() => {
  return {
    mockAdd: vi.fn().mockResolvedValue({ id: "job-123" }),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockValues: vi.fn().mockResolvedValue([]),
    mockSet: vi.fn(),
    mockWhere: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("bullmq", () => {
  class MockQueue {
    add = mockAdd;
    constructor() {}
  }
  class MockWorker {
    on = vi.fn();
    constructor(..._args: unknown[]) {}
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert.mockReturnValue({ values: mockValues }),
    update: mockUpdate.mockReturnValue({ set: mockSet.mockReturnValue({ where: mockWhere }) }),
  })),
  communications: { id: "id" },
  eq: vi.fn(),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  renderTemplate: vi.fn((tpl: string) => tpl),
}));

describe("queueEmail with CommunicationMeta (NTF-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should insert a communications record when meta is provided", async () => {
    const { queueEmail } = await import("../emailQueueWorker");

    await queueEmail(
      { to: "tenant@example.com", subject: "Reminder", body: "Pay up" },
      undefined,
      {
        ownerId: "owner-1",
        leaseId: "lease-1",
        type: "payment_reminder_friendly",
        recipientName: "Jan",
      },
    );

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        leaseId: "lease-1",
        channel: "email",
        type: "payment_reminder_friendly",
        recipientName: "Jan",
        recipientEmail: "tenant@example.com",
        status: "queued",
      }),
    );
  });

  it("should add job to BullMQ queue", async () => {
    const { queueEmail } = await import("../emailQueueWorker");

    await queueEmail(
      { to: "tenant@example.com", subject: "Reminder", body: "Pay up" },
      undefined,
      {
        ownerId: "owner-1",
        type: "payment_reminder_friendly",
        recipientName: "Jan",
      },
    );

    expect(mockAdd).toHaveBeenCalledWith(
      "send-email",
      expect.objectContaining({
        to: "tenant@example.com",
        subject: "Reminder",
        ownerId: "owner-1",
      }),
      expect.any(Object),
    );
  });

  it("should work without meta (backward compatible)", async () => {
    const { queueEmail } = await import("../emailQueueWorker");

    const jobId = await queueEmail({
      to: "tenant@example.com",
      subject: "Hello",
      body: "Test",
    });

    expect(jobId).toBe("job-123");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("should update communications record with job externalId", async () => {
    const { queueEmail } = await import("../emailQueueWorker");

    await queueEmail(
      { to: "t@example.com", subject: "Test", body: "Body" },
      undefined,
      {
        ownerId: "owner-1",
        type: "custom",
        recipientName: "Test",
      },
    );

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ externalId: "job-123" }));
  });
});
