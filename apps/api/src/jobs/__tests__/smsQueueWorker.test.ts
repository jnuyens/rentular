import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdd, mockInsert, mockUpdate, mockValues, mockSet, mockWhere } = vi.hoisted(() => {
  return {
    mockAdd: vi.fn().mockResolvedValue({ id: "sms-job-456" }),
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

vi.mock("../../lib/sms", () => ({
  sendSms: vi.fn().mockResolvedValue({ messageId: "sms-ext-1" }),
  normalizePhoneNumber: vi.fn((p: string) => p),
}));

vi.mock("../emailQueueWorker", () => ({
  queueEmail: vi.fn(),
}));

describe("queueSms with CommunicationMeta (NTF-06)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should insert a communications record when meta is provided", async () => {
    const { queueSms } = await import("../smsQueueWorker");

    await queueSms(
      { to: "+32471000000", body: "Pay your rent" },
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
        channel: "sms",
        type: "payment_reminder_friendly",
        recipientName: "Jan",
        recipientPhone: "+32471000000",
        status: "queued",
      }),
    );
  });

  it("should add job to BullMQ SMS queue", async () => {
    const { queueSms } = await import("../smsQueueWorker");

    await queueSms(
      { to: "+32471000000", body: "Reminder" },
      undefined,
      {
        ownerId: "owner-1",
        type: "payment_reminder_formal",
        recipientName: "Jan",
      },
    );

    expect(mockAdd).toHaveBeenCalledWith(
      "send-sms",
      expect.objectContaining({
        to: "+32471000000",
        body: "Reminder",
      }),
      expect.any(Object),
    );
  });

  it("should work without meta (backward compatible)", async () => {
    const { queueSms } = await import("../smsQueueWorker");

    const jobId = await queueSms({ to: "+32471000000", body: "Hello" });
    expect(jobId).toBe("sms-job-456");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("should update externalId after job is queued", async () => {
    const { queueSms } = await import("../smsQueueWorker");

    await queueSms(
      { to: "+32471000000", body: "Test" },
      undefined,
      {
        ownerId: "owner-1",
        type: "custom",
        recipientName: "Test",
      },
    );

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ externalId: "sms-job-456" }));
  });
});
