import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @rentular/db before importing the module under test
vi.mock("@rentular/db", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockLimit = vi.fn();

  // Chain: db.select().from(smtpSettings).where(...).limit(1)
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  // Default: no custom SMTP settings found
  mockLimit.mockResolvedValue([]);

  return {
    getDb: vi.fn(() => ({
      select: mockSelect,
      from: mockFrom,
    })),
    smtpSettings: { ownerId: "ownerId" },
    // expose mocks for per-test manipulation
    __mockLimit: mockLimit,
  };
});

// Mock nodemailer
vi.mock("nodemailer", () => {
  const mockSendMail = vi.fn().mockResolvedValue({ messageId: "test-id" });
  const mockTransport = { sendMail: mockSendMail };
  return {
    createTransport: vi.fn(() => mockTransport),
  };
});

// Mock encryption (not the focus of this test)
vi.mock("../encryption", () => ({
  decrypt: vi.fn(() => "decrypted-password"),
}));

describe("email module (NTF-07)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SMTP_HOST = "mail.test.com";
    process.env.SMTP_PORT = "587";
    process.env.EMAIL_FROM = "platform@rentular.com";
    delete process.env.EMAIL_FROM_NAME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("renderTemplate", () => {
    it("should replace all placeholders with provided values", async () => {
      const { renderTemplate } = await import("../email");
      const template = "Dear {{tenantName}}, your rent of {{amount}} for {{propertyName}} is due.";
      const vars = {
        tenantName: "Jan Janssens",
        amount: "EUR850.00",
        propertyName: "Apartment 2B",
      };
      const result = renderTemplate(template, vars);
      expect(result).toBe("Dear Jan Janssens, your rent of EUR850.00 for Apartment 2B is due.");
    });

    it("should replace missing placeholders with empty string", async () => {
      const { renderTemplate } = await import("../email");
      const template = "Hello {{name}}, total: {{total}}";
      const result = renderTemplate(template, { name: "Alice" });
      expect(result).toBe("Hello Alice, total: ");
    });

    it("should return template unchanged when no placeholders exist", async () => {
      const { renderTemplate } = await import("../email");
      const template = "No placeholders here.";
      expect(renderTemplate(template, { foo: "bar" })).toBe("No placeholders here.");
    });
  });

  describe("getTransportForOwner", () => {
    it("should return default transport and platform from-address when no ownerId given", async () => {
      const { getTransportForOwner } = await import("../email");
      const result = await getTransportForOwner(undefined);
      expect(result.fromAddress).toBe("platform@rentular.com");
      // Transport is the default nodemailer transport (exists)
      expect(result.transport).toBeDefined();
      expect(result.fromName).toBe("Rentular");
    });

    it("should fall back to default when ownerId has no custom SMTP settings", async () => {
      const { getTransportForOwner, clearTransportCache } = await import("../email");
      // Ensure cache is empty
      clearTransportCache("owner-no-smtp");
      const result = await getTransportForOwner("owner-no-smtp");
      expect(result.fromAddress).toBe("platform@rentular.com");
    });
  });

  describe("sender display name", () => {
    async function lastFrom(): Promise<unknown> {
      const nodemailer = await import("nodemailer");
      const transport = (nodemailer.createTransport as unknown as () => {
        sendMail: ReturnType<typeof vi.fn>;
      })();
      const calls = transport.sendMail.mock.calls;
      return (calls[calls.length - 1]![0] as { from: unknown }).from;
    }

    it("defaults to Rentular <noreply@rentular.com> on the platform transport", async () => {
      delete process.env.EMAIL_FROM;
      const { sendEmail } = await import("../email");
      await sendEmail({ to: "t@example.com", subject: "s", body: "b" });
      expect(await lastFrom()).toEqual({ name: "Rentular", address: "noreply@rentular.com" });
    });

    it("uses the platform sender name when the owner has no custom SMTP", async () => {
      delete process.env.EMAIL_FROM;
      const { sendEmail, clearTransportCache } = await import("../email");
      clearTransportCache("owner-no-smtp-2");
      await sendEmail({ to: "t@example.com", subject: "s", body: "b", ownerId: "owner-no-smtp-2" });
      expect(await lastFrom()).toEqual({ name: "Rentular", address: "noreply@rentular.com" });
    });

    it("honours EMAIL_FROM_NAME", async () => {
      process.env.EMAIL_FROM_NAME = "Rentular Belgium";
      const { getPlatformSender, sendEmail } = await import("../email");
      expect(getPlatformSender()).toEqual({
        fromAddress: "platform@rentular.com",
        fromName: "Rentular Belgium",
      });
      await sendEmail({ to: "t@example.com", subject: "s", body: "b" });
      expect(await lastFrom()).toEqual({ name: "Rentular Belgium", address: "platform@rentular.com" });
    });

    it("passes an EMAIL_FROM that already has a display name through unchanged", async () => {
      process.env.EMAIL_FROM = "Rentular Ops <ops@rentular.com>";
      const { getPlatformSender, sendEmail } = await import("../email");
      expect(getPlatformSender()).toEqual({ fromAddress: "Rentular Ops <ops@rentular.com>" });
      await sendEmail({ to: "t@example.com", subject: "s", body: "b" });
      expect(await lastFrom()).toBe("Rentular Ops <ops@rentular.com>");
    });

    it("keeps the owner's own from name and address for custom SMTP", async () => {
      const db = (await import("@rentular/db")) as unknown as {
        __mockLimit: ReturnType<typeof vi.fn>;
      };
      db.__mockLimit.mockResolvedValueOnce([
        {
          host: "smtp.owner.be",
          port: 587,
          username: "u",
          passwordEncrypted: "x",
          passwordIv: "y",
          passwordTag: "z",
          fromAddress: "verhuur@owner.be",
          fromName: "Verhuur Janssens",
        },
      ]);
      const { sendEmail, clearTransportCache } = await import("../email");
      clearTransportCache("owner-with-smtp");
      await sendEmail({ to: "t@example.com", subject: "s", body: "b", ownerId: "owner-with-smtp" });
      expect(await lastFrom()).toEqual({ name: "Verhuur Janssens", address: "verhuur@owner.be" });
    });
  });

  describe("clearTransportCache", () => {
    it("should not throw when clearing a non-existent cache entry", async () => {
      const { clearTransportCache } = await import("../email");
      expect(() => clearTransportCache("non-existent-owner")).not.toThrow();
    });
  });
});
