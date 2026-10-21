import { describe, it, expect, vi } from "vitest";

vi.mock("@rentular/db", () => ({
  getDb: vi.fn(),
  leaseTenants: {},
  tenants: {},
}));

import { pickLeaseRecipients, mergeCc, type LeaseRecipientTenant } from "../leaseRecipients";

function tenant(overrides: Partial<LeaseRecipientTenant>): LeaseRecipientTenant {
  return {
    tenantId: "t",
    firstName: "First",
    lastName: "Last",
    email: null,
    phone: null,
    language: null,
    preferredChannel: null,
    isPrimary: false,
    ...overrides,
  };
}

describe("pickLeaseRecipients", () => {
  it("sends to the primary and copies the other linked tenant", () => {
    const rec = pickLeaseRecipients([
      tenant({ tenantId: "1", lastName: "Akpinar", email: "a@x.be", isPrimary: true, language: "nl" }),
      tenant({ tenantId: "2", lastName: "Vandebroek", email: "r@law.be" }),
    ]);
    expect(rec.primary?.lastName).toBe("Akpinar");
    expect(rec.to).toBe("a@x.be");
    expect(rec.ccEmails).toEqual(["r@law.be"]);
    expect(rec.cc).toBe("r@law.be");
  });

  it("dedupes cc case-insensitively, trims, and leaves out the primary address", () => {
    const rec = pickLeaseRecipients([
      tenant({ tenantId: "1", email: "a@x.be", isPrimary: true }),
      tenant({ tenantId: "2", email: "A@X.BE" }),
      tenant({ tenantId: "3", email: " r@law.be " }),
      tenant({ tenantId: "4", email: "r@law.be" }),
      tenant({ tenantId: "5", email: "" }),
      tenant({ tenantId: "6", email: null }),
    ]);
    expect(rec.to).toBe("a@x.be");
    expect(rec.ccEmails).toEqual(["r@law.be"]);
    expect(rec.cc).toBe("r@law.be");
  });

  it("uses the first row as primary when no row is flagged primary", () => {
    const rec = pickLeaseRecipients([
      tenant({ tenantId: "1", lastName: "First", email: "f@x.be", language: "fr" }),
      tenant({ tenantId: "2", lastName: "Second", email: "s@x.be" }),
    ]);
    expect(rec.primary?.lastName).toBe("First");
    expect(rec.primary?.language).toBe("fr");
    expect(rec.to).toBe("f@x.be");
    expect(rec.ccEmails).toEqual(["s@x.be"]);
  });

  it("falls back to another tenant's address when the primary has none", () => {
    const rec = pickLeaseRecipients([
      tenant({ tenantId: "1", lastName: "Akpinar", email: null, isPrimary: true, language: "nl" }),
      tenant({ tenantId: "2", lastName: "Vandebroek", email: "r@law.be" }),
      tenant({ tenantId: "3", lastName: "Other", email: "o@x.be" }),
    ]);
    expect(rec.primary?.lastName).toBe("Akpinar");
    expect(rec.primary?.language).toBe("nl");
    expect(rec.to).toBe("r@law.be");
    expect(rec.ccEmails).toEqual(["o@x.be"]);
  });

  it("returns no recipient when nobody has an email", () => {
    const rec = pickLeaseRecipients([
      tenant({ tenantId: "1", isPrimary: true }),
      tenant({ tenantId: "2", email: "  " }),
    ]);
    expect(rec.to).toBeNull();
    expect(rec.ccEmails).toEqual([]);
    expect(rec.cc).toBeUndefined();
  });

  it("handles a lease without tenants", () => {
    const rec = pickLeaseRecipients([]);
    expect(rec.primary).toBeNull();
    expect(rec.to).toBeNull();
    expect(rec.ccEmails).toEqual([]);
  });
});

describe("mergeCc", () => {
  it("merges comma lists, keeps the first spelling, and drops duplicates", () => {
    expect(mergeCc("x@a.be, y@b.be", undefined, "Y@B.BE, z@c.be")).toBe("x@a.be, y@b.be, z@c.be");
  });

  it("returns undefined when nothing usable remains", () => {
    expect(mergeCc()).toBeUndefined();
    expect(mergeCc(null, "", " , ")).toBeUndefined();
  });
});
