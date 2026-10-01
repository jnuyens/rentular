import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, propertyManagers, users } from "@rentular/db";

// Roles that are expected to actually manage a property's day-to-day (and so
// should receive the rent notices). The plain owner is CC'd as a backstop.
const MANAGING_ROLES = new Set(["co_owner", "manager", "accountant"]);

/**
 * Who should receive a landlord rent notice for a property. The property's
 * managing people are the primary recipients and the owner is in CC, so the
 * person who actually manages the property acts on it. When there are no
 * managers, the owner is the sole recipient.
 *
 * Returns comma-joined strings suitable for nodemailer's `to`/`cc`.
 */
export async function getLandlordNotificationRecipients(
  propertyId: string,
  ownerEmail: string | null | undefined,
): Promise<{ to: string; cc?: string }> {
  const db = getDb();
  const rows = await db
    .select({
      role: propertyManagers.role,
      email: users.email,
      invitationEmail: propertyManagers.invitationEmail,
    })
    .from(propertyManagers)
    .leftJoin(users, eq(users.id, propertyManagers.userId))
    .where(
      and(
        eq(propertyManagers.propertyId, propertyId),
        isNotNull(propertyManagers.acceptedAt),
      ),
    );

  const owner = (ownerEmail || "").trim().toLowerCase();
  const managerEmails: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!MANAGING_ROLES.has(r.role)) continue;
    const email = (r.email || r.invitationEmail || "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (key === owner) continue; // owner goes in CC, not the primary list
    if (seen.has(key)) continue;
    seen.add(key);
    managerEmails.push(email);
  }

  if (managerEmails.length > 0) {
    return { to: managerEmails.join(", "), cc: ownerEmail || undefined };
  }
  // No managers: the owner is the recipient.
  return { to: ownerEmail || "" };
}
