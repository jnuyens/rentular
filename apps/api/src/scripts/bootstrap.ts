import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { getDb, users } from "@rentular/db";

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

/**
 * Apply the DB schema by shelling out to drizzle-kit push for @rentular/db.
 * drizzle-kit is a devDependency, so this only works from the deploy build tree
 * (a stage that retains devDeps) — never from the slim prod runner image
 * (10-RESEARCH § Pitfall 5). DB_* are inherited from the container environment.
 */
function pushSchema(): void {
  console.log("[Bootstrap] Applying schema via drizzle-kit push…");
  const result = spawnSync(
    "pnpm",
    ["--filter", "@rentular/db", "exec", "drizzle-kit", "push"],
    { stdio: "inherit", env: process.env }
  );
  if (result.status !== 0) {
    throw new Error(
      `[Bootstrap] drizzle-kit push failed (exit ${result.status ?? "unknown"})`
    );
  }
  console.log("[Bootstrap] Schema applied.");
}

/**
 * One-off, idempotent first-run entrypoint (D-08): (1) push the schema, then
 * (2) create the initial owner from ADMIN_EMAIL/ADMIN_PASSWORD. Safe to re-run
 * on every deploy — the owner-create step is a no-op once the owner exists.
 */
async function main(): Promise<void> {
  pushSchema();

  const email = process.env.ADMIN_EMAIL ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";

  const result = await createOwnerIfMissing(getDb(), { email, password });
  console.log(
    result.created
      ? `[Bootstrap] Owner ${result.email} created.`
      : `[Bootstrap] Owner ${result.email} already present — nothing to do.`
  );
  process.exit(0);
}

// Only run main() when this module is the process entrypoint, so importing it
// from the unit test never triggers a schema push or DB connection.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[Bootstrap] Failed:", err);
    process.exit(1);
  });
}
