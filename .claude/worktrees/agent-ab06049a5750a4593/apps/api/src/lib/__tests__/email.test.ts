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
      expect(result.fromName).toBeUndefined();
    });

    it("should fall back to default when ownerId has no custom SMTP settings", async () => {
      const { getTransportForOwner, clearTransportCache } = await import("../email");
      // Ensure cache is empty
      clearTransportCache("owner-no-smtp");
      const result = await getTransportForOwner("owner-no-smtp");
      expect(result.fromAddress).toBe("platform@rentular.com");
    });
  });

  describe("clearTransportCache", () => {
    it("should not throw when clearing a non-existent cache entry", async () => {
      const { clearTransportCache } = await import("../email");
      expect(() => clearTransportCache("non-existent-owner")).not.toThrow();
    });
  });
});
