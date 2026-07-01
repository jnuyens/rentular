import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcrypt";

import { createOwnerIfMissing } from "../bootstrap";

// A minimal fake Drizzle handle that mirrors the query surface used by
// createOwnerIfMissing:  db.select(...).from(...).where(...).limit(...)  and
// db.insert(...).values(...). The select chain resolves to `existingRows`.
function makeFakeDb(existingRows: Array<{ id: string }>) {
  const limit = vi.fn(() => Promise.resolve(existingRows));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const values = vi.fn(() => Promise.resolve(undefined));
  const insert = vi.fn(() => ({ values }));

  return { db: { select, insert } as any, select, insert, values };
}

describe("createOwnerIfMissing (D-08 bootstrap)", () => {
  it("Test 1: performs NO insert and reports skipped when the owner already exists", async () => {
    const { db, insert } = makeFakeDb([{ id: "existing-owner-id" }]);

    const result = await createOwnerIfMissing(db, {
      email: "owner@example.com",
      password: "correct horse battery",
    });

    expect(result.created).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("Test 2: inserts exactly once with a bcrypt-hashed password and a UUID id when missing", async () => {
    const { db, insert, values } = makeFakeDb([]);
    const plaintext = "correct horse battery";

    const result = await createOwnerIfMissing(db, {
      email: "Owner@Example.com",
      password: plaintext,
    });

    expect(result.created).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);

    const inserted = values.mock.calls[0][0] as {
      id: string;
      email: string;
      passwordHash: string;
    };

    // Password must be hashed, never persisted in plaintext.
    expect(inserted.passwordHash).not.toBe(plaintext);
    expect(await bcrypt.compare(plaintext, inserted.passwordHash)).toBe(true);

    // Email normalized (lowercased/trimmed) per auth.ts.
    expect(inserted.email).toBe("owner@example.com");

    // Id is a crypto.randomUUID() v4 string.
    expect(inserted.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("Test 3: throws a descriptive error before any DB call when email or password is missing", async () => {
    const { db, select, insert } = makeFakeDb([]);

    await expect(
      createOwnerIfMissing(db, { email: "", password: "correct horse battery" })
    ).rejects.toThrow(/ADMIN_EMAIL/);

    await expect(
      createOwnerIfMissing(db, { email: "owner@example.com", password: "" })
    ).rejects.toThrow(/ADMIN_PASSWORD/);

    expect(select).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
