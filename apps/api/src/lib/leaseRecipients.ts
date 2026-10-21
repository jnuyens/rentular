import { eq } from "drizzle-orm";
import { getDb, leaseTenants, tenants } from "@rentular/db";

export interface LeaseRecipientTenant {
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  language: "nl" | "fr" | "de" | "en" | null;
  preferredChannel: "email" | "sms" | "whatsapp" | null;
  isPrimary: boolean;
}

export interface LeaseEmailRecipients {
  /** The tenant the email is addressed to: greeting name, language, phone. */
  primary: LeaseRecipientTenant | null;
  /** The "to" address: the primary's email, else the first other tenant's. */
  to: string | null;
  /** Every other linked tenant's address, deduped, without the "to" address. */
  ccEmails: string[];
  /** ccEmails comma-joined for EmailOptions.cc, undefined when empty. */
  cc: string | undefined;
}

/**
 * Decide who receives a tenant email for a lease. The primary tenant (the
 * isPrimary row, else the first row) is the addressee and the source of the
 * name and language. Every other linked tenant with an email is copied, so
 * co-tenants see the same reminders and notices. Addresses are trimmed and
 * deduped case-insensitively, in lease_tenants order.
 */
export function pickLeaseRecipients(rows: LeaseRecipientTenant[]): LeaseEmailRecipients {
  const primary = rows.find((r) => r.isPrimary) ?? rows[0] ?? null;
  const clean = (e: string | null | undefined) => (e || "").trim();

  let to: string | null = primary ? clean(primary.email) || null : null;
  if (!to) {
    const other = rows.find((r) => r !== primary && clean(r.email));
    to = other ? clean(other.email) : null;
  }

  const seen = new Set<string>();
  if (to) seen.add(to.toLowerCase());
  const ccEmails: string[] = [];
  for (const r of rows) {
    const email = clean(r.email);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ccEmails.push(email);
  }

  return { primary, to, ccEmails, cc: ccEmails.length ? ccEmails.join(", ") : undefined };
}

/** Load the linked tenants of a lease and pick the email recipients. */
export async function getLeaseEmailRecipients(leaseId: string): Promise<LeaseEmailRecipients> {
  const db = getDb();
  const rows = await db
    .select({
      tenantId: tenants.id,
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      email: tenants.email,
      phone: tenants.phone,
      language: tenants.language,
      preferredChannel: tenants.preferredChannel,
      isPrimary: leaseTenants.isPrimary,
    })
    .from(leaseTenants)
    .innerJoin(tenants, eq(tenants.id, leaseTenants.tenantId))
    .where(eq(leaseTenants.leaseId, leaseId));
  return pickLeaseRecipients(rows);
}

/**
 * Merge comma-separated address lists into one cc value. Keeps the first
 * spelling of each address and drops duplicates case-insensitively. Returns
 * undefined when nothing is left.
 */
export function mergeCc(...parts: Array<string | null | undefined>): string | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.split(",")) {
      const email = raw.trim();
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out.length ? out.join(", ") : undefined;
}
