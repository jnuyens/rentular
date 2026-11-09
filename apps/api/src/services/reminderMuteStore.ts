import crypto from "crypto";
import { eq, inArray } from "drizzle-orm";
import { communications, getDb, leases, users } from "@rentular/db";
import { formatShortDate } from "../lib/belgianFormat";
import { isMuteActive, muteOf } from "./reminderMute";
import { dueDateForMonth } from "./monthReceived";

type Db = ReturnType<typeof getDb>;

/** A contract's reminder mute, as the web app shows it. */
export type MuteView = {
  until: string;
  note: string | null;
  by: string | null;
  byName: string | null;
  at: string | null;
  /** True while reminders are muted (today is before the end date). */
  active: boolean;
};

type MuteColumns = {
  remindersMutedUntil: string | null;
  remindersMutedNote: string | null;
  remindersMutedBy: string | null;
  remindersMutedAt: Date | string | null;
};

/** The contract's mute while it is active, else null. */
export function muteView(lease: MuteColumns, today: string, names: Map<string, string>): MuteView | null {
  const mute = muteOf(lease);
  if (!mute || !isMuteActive(mute, today)) return null;
  const at = lease.remindersMutedAt ? new Date(lease.remindersMutedAt) : null;
  return {
    until: mute.until,
    note: lease.remindersMutedNote || null,
    by: lease.remindersMutedBy,
    byName: lease.remindersMutedBy ? names.get(lease.remindersMutedBy) ?? null : null,
    at: at && !isNaN(at.getTime()) ? at.toISOString() : null,
    active: true,
  };
}

/**
 * The due date of the lease's next rent after today: what "next rent" fills
 * in when the landlord mutes the reminders.
 */
export function nextRentDueDate(paymentDay: number | null | undefined, today: string): string {
  const month = today.slice(0, 7);
  const thisMonth = dueDateForMonth(month, paymentDay);
  if (thisMonth > today) return thisMonth;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return dueDateForMonth(next, paymentDay);
}

/** Display names of the people who set mutes. */
export async function muteNames(db: Db, rows: Array<{ remindersMutedBy: string | null }>): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.remindersMutedBy).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  for (const p of people) names.set(p.id, p.name || p.email);
  return names;
}

/** A lease with what the mute routes need, or null when it does not exist. */
export async function loadLeaseForMute(db: Db, leaseId: string) {
  const rows = await db
    .select({
      id: leases.id,
      ownerId: leases.ownerId,
      propertyId: leases.propertyId,
      paymentDay: leases.paymentDay,
      remindersMutedUntil: leases.remindersMutedUntil,
      remindersMutedNote: leases.remindersMutedNote,
      remindersMutedBy: leases.remindersMutedBy,
      remindersMutedAt: leases.remindersMutedAt,
    })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  return rows[0] ?? null;
}

export type LoadedLease = NonNullable<Awaited<ReturnType<typeof loadLeaseForMute>>>;

/**
 * Add an internal note to the contract history. Never sent to anyone, kept
 * out of the 7-day message counter.
 */
async function logMuteNote(
  db: Db,
  input: {
    lease: LoadedLease;
    userId: string;
    action: "set" | "changed" | "removed";
    until: string | null;
    previousUntil: string | null;
    note: string | null;
  },
): Promise<void> {
  const person = (
    await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, input.userId)).limit(1)
  )[0];
  const who = person?.name || person?.email || input.userId;
  const body =
    input.action === "removed"
      ? `Internal note: late payment reminders are no longer muted (were muted until ${formatShortDate(String(input.previousUntil))}).`
      : `Internal note: late payment reminders muted until ${formatShortDate(String(input.until))}.` +
        (input.note ? `\nNote: ${input.note}` : "");
  try {
    await db.insert(communications).values({
      id: crypto.randomUUID(),
      ownerId: input.lease.ownerId,
      leaseId: input.lease.id,
      channel: "internal",
      type: "internal_note",
      recipientName: who,
      body,
      status: "sent",
      sentAt: new Date(),
      metadata: {
        kind: "reminder_mute",
        action: input.action,
        until: input.until,
        previousUntil: input.previousUntil,
        note: input.note,
        trigger: "manual",
        triggeredBy: input.userId,
      },
    });
  } catch (err) {
    console.error("[ReminderMute] history note failed:", err);
  }
}

/** Mute (or change the mute of) a contract's late-payment reminders, noted in the history. */
export async function saveMute(
  db: Db,
  input: { lease: LoadedLease; userId: string; until: string; note: string | null; today: string },
): Promise<void> {
  const current = muteOf(input.lease);
  const previousUntil = current && isMuteActive(current, input.today) ? current.until : null;
  await db
    .update(leases)
    .set({
      remindersMutedUntil: input.until,
      remindersMutedNote: input.note,
      remindersMutedBy: input.userId,
      remindersMutedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(leases.id, input.lease.id));
  console.log(
    `[ReminderMute] user ${input.userId} muted reminders on lease ${input.lease.id} until ${input.until} (was ${previousUntil ?? "not muted"})`,
  );
  await logMuteNote(db, {
    lease: input.lease,
    userId: input.userId,
    action: previousUntil ? "changed" : "set",
    until: input.until,
    previousUntil,
    note: input.note,
  });
}

/**
 * Unmute: reminders run as usual again from the next evening, on the normal
 * ladder of each amount (nothing restarts, since the mute end date is gone).
 */
export async function removeMute(
  db: Db,
  input: { lease: LoadedLease; userId: string; today: string },
): Promise<boolean> {
  const current = muteOf(input.lease);
  if (!current || !isMuteActive(current, input.today)) return false;
  await db
    .update(leases)
    .set({
      remindersMutedUntil: null,
      remindersMutedNote: null,
      remindersMutedBy: null,
      remindersMutedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(leases.id, input.lease.id));
  console.log(`[ReminderMute] user ${input.userId} unmuted reminders on lease ${input.lease.id}`);
  await logMuteNote(db, {
    lease: input.lease,
    userId: input.userId,
    action: "removed",
    until: null,
    previousUntil: current.until,
    note: null,
  });
  return true;
}
