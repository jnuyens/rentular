import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { users } from "@rentular/db";

// Mirrors apps/api/src/routes/auth.ts register path.
const PASSWORD_SALT_ROUNDS = 12;

export interface OwnerCredentials {
  email: string;
  password: string;
}

export interface CreateOwnerResult {
  created: boolean;
  email: string;
}

/**
 * D-08 first-run bootstrap: create the initial owner/landlord account if it does
 * not already exist. Idempotent — a second call with the same email is a no-op.
 *
 * The DB handle is passed in (not imported here) so the logic is unit-testable
 * against a stub. Never logs or persists the password in plaintext (T-10-02-01/03).
 */
export async function createOwnerIfMissing(
  db: {
    select: (...args: any[]) => any;
    insert: (...args: any[]) => any;
  },
  { email, password }: OwnerCredentials
): Promise<CreateOwnerResult> {
  if (!email || !email.trim()) {
    throw new Error("[Bootstrap] ADMIN_EMAIL is required to create the initial owner");
  }
  if (!password) {
    throw new Error("[Bootstrap] ADMIN_PASSWORD is required to create the initial owner");
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (existing[0]) {
    console.log(`[Bootstrap] Owner ${normalizedEmail} already exists — skipping`);
    return { created: false, email: normalizedEmail };
  }

  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

  await db.insert(users).values({
    id: userId,
    email: normalizedEmail,
    name: "Owner",
    passwordHash,
    onboardingComplete: true,
  });

  console.log(`[Bootstrap] Created initial owner ${normalizedEmail}`);
  return { created: true, email: normalizedEmail };
}
