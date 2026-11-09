/**
 * Daily re-login warnings for bank connections, and the guard that holds back
 * automatic tenant reminders while the bank data behind a lease is stale.
 *
 * The landlord who owns the connection is emailed at 14, 7, 3 and 1 day(s)
 * before the consent ends and once on the day it expired (or the moment a
 * sync finds the session gone). Every warning is logged in communications as
 * a landlord_notification with metadata.kind "bank_reauth_warning".
 */

import { and, eq, inArray } from "drizzle-orm";
import { getDb, bankConnections, bankAccounts, users } from "@rentular/db";
import { queueEmail } from "../jobs/emailQueueWorker";
import { getScheduleTimezone } from "../lib/timezone";
import {
  buildReauthEmail,
  dueReauthStage,
  formatDateInZone,
  leaseReceivingIban,
  maskIban,
  normalizeIban,
  shouldSendReauthWarning,
  staleMonitoredIbans,
  isConnectionStale,
  type ReauthStage,
} from "./bankReauth";

type Db = ReturnType<typeof getDb>;
type ConnectionRow = typeof bankConnections.$inferSelect;

function webBase(): string {
  return (process.env.WEB_URL || "https://www.rentular.com").replace(/\/$/, "");
}

export function reloginUrl(connectionId: string): string {
  return `${webBase()}/bank-connections/${connectionId}?relogin=1`;
}

/** Email one warning stage for a connection and remember it was sent. */
export async function sendReauthWarning(
  conn: ConnectionRow,
  stage: ReauthStage,
  now: Date = new Date(),
  db: Db = getDb(),
): Promise<boolean> {
  const owner = (
    await db
      .select({ email: users.email, name: users.name, locale: users.locale })
      .from(users)
      .where(eq(users.id, conn.ownerId))
      .limit(1)
  )[0];
  if (!owner?.email) return false;

  const tz = getScheduleTimezone();
  const bankName = conn.institutionName || conn.institutionId || "your bank";
  const { subject, body } = buildReauthEmail(owner.locale, {
    name: owner.name,
    bankName,
    ibanMasked: maskIban(conn.iban),
    expiryDate: formatDateInZone(conn.consentExpiresAt ?? now, tz),
    stage,
    url: reloginUrl(conn.id),
  });

  // Stamp first: a failure to queue is logged, and the job does not retry the
  // same stage in a loop every morning.
  await db
    .update(bankConnections)
    .set({ reauthWarnStage: stage, reauthWarnedAt: now })
    .where(eq(bankConnections.id, conn.id));

  await queueEmail({ to: owner.email, subject, body }, undefined, {
    ownerId: conn.ownerId,
    type: "landlord_notification",
    recipientName: owner.name || owner.email,
    metadata: {
      kind: "bank_reauth_warning",
      trigger: "schedule",
      connectionId: conn.id,
      provider: conn.provider,
      stage,
    },
  });
  console.log(
    `[BankReauth] Warning stage ${stage} queued for connection ${conn.id} (${conn.provider})`,
  );
  return true;
}

/** The daily run: send every stage that is due and not sent yet. */
export async function runReauthWarnings(now: Date = new Date()): Promise<{ sent: number }> {
  const db = getDb();
  const tz = getScheduleTimezone();
  const rows = await db
    .select()
    .from(bankConnections)
    .where(inArray(bankConnections.status, ["active", "expired", "error"]));
  let sent = 0;
  for (const conn of rows) {
    try {
      const due = dueReauthStage(conn, now, tz);
      if (!shouldSendReauthWarning(due, conn.reauthWarnStage)) continue;
      if (await sendReauthWarning(conn, due!, now, db)) sent++;
    } catch (err) {
      console.error(`[BankReauth] Warning failed for connection ${conn.id}:`, err);
    }
  }
  console.log(`[BankReauth] ${sent} re-login warning(s) queued`);
  return { sent };
}

/** Send the "expired" warning right away (once), e.g. after a sync found the session gone. */
export async function warnConnectionNow(connectionId: string): Promise<void> {
  const db = getDb();
  const conn = (
    await db.select().from(bankConnections).where(eq(bankConnections.id, connectionId)).limit(1)
  )[0];
  if (!conn) return;
  if (!shouldSendReauthWarning(0, conn.reauthWarnStage)) return;
  await sendReauthWarning(conn, 0, new Date(), db);
}

export interface StaleMonitoring {
  connectionId: string;
  bankName: string;
  iban: string;
}

/**
 * A per-run guard: for a lease, the stale bank connection its rent is
 * monitored through, or null when its bank data is fine (or not monitored at
 * all). Results are cached per landlord for the run.
 */
export function createMonitoringGuard(db: Db = getDb(), now: Date = new Date()) {
  const cache = new Map<
    string,
    Promise<{ stale: Set<string>; conns: ConnectionRow[]; accounts: Array<typeof bankAccounts.$inferSelect> }>
  >();
  const load = (ownerId: string) => {
    let p = cache.get(ownerId);
    if (!p) {
      p = (async () => {
        const conns = await db
          .select()
          .from(bankConnections)
          .where(
            and(
              eq(bankConnections.ownerId, ownerId),
              inArray(bankConnections.status, ["active", "expired", "error"]),
            ),
          );
        const accounts = conns.length
          ? await db.select().from(bankAccounts).where(eq(bankAccounts.ownerId, ownerId))
          : [];
        return { stale: staleMonitoredIbans(conns, now), conns, accounts };
      })();
      cache.set(ownerId, p);
    }
    return p;
  };

  return async (lease: { ownerId: string; bankAccountId: string | null }): Promise<StaleMonitoring | null> => {
    const { stale, conns, accounts } = await load(lease.ownerId);
    if (stale.size === 0) return null;
    const iban = leaseReceivingIban(lease, accounts);
    if (!iban || !stale.has(iban)) return null;
    const conn = conns.find((c) => normalizeIban(c.iban) === iban && isConnectionStale(c, now));
    if (!conn) return null;
    return {
      connectionId: conn.id,
      bankName: conn.institutionName || conn.institutionId,
      iban,
    };
  };
}
